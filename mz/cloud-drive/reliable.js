// mz/cloud-drive/reliable —— 应用层可靠消息投递通道（纯模块，无 /nos / DOM 依赖）
//
// 解决 noneos-core sendToService「尽力投递」的静默丢包问题：ACK 确认 + 超时重发
// （复用同一 msgId）+ 接收端 msgId 去重 + 同一目标串行发送。规范来源：
// noneos-core-docs「应用层可靠消息投递」。
//
// 传输层通过依赖注入解耦，便于单元测试模拟丢包：
//   const channel = new ReliableChannel({
//     send: async (envelope) => boolean,   // 把信封交给传输通道，返回是否受理
//     onData: (payload, envelope) => {},   // 收到去重后的业务数据
//   });
// 传输层收到信封后调用 channel.handle(envelope) 交回本模块。

const ACK_TIMEOUT = 3000; // 单次等待 ACK 的毫秒数
const MAX_RETRY = 5; // 最大重发次数（含首发）
const MAX_PAYLOAD = 112 * 1024; // 安全上限（中继硬限 256KB，为加密/序列化留余量）
const SEEN_TTL = 5 * 60 * 1000; // 去重记录保留时长
const SEEN_MAX = 2000; // 去重记录容量上限

let msgSeq = 0;

const genMsgId = () =>
  `m-${Date.now().toString(36)}-${(++msgSeq).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/** 测量 payload 的序列化字节数（对象按 JSON 估算，留安全余量） */
export function measurePayloadSize(payload) {
  if (payload == null) return 0;
  if (typeof payload === "string") return payload.length;
  if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload))
    return payload.byteLength;
  return JSON.stringify(payload).length;
}

export class ReliableChannel {
  constructor({
    send,
    onData,
    timeout = ACK_TIMEOUT,
    maxRetry = MAX_RETRY,
    maxPayload = MAX_PAYLOAD,
    channelId = "ch",
  } = {}) {
    if (typeof send !== "function")
      throw new Error("ReliableChannel requires a send function");
    this._send = send;
    this.onData = onData;
    this._timeout = timeout;
    this._maxRetry = maxRetry;
    this._maxPayload = maxPayload;
    this._id = channelId;

    this._pending = new Map(); // msgId -> { resolve, reject, timer, tries }
    this._seen = new Map(); // msgId -> 首次接收时间戳
    this._queueTail = Promise.resolve(); // 串行发送队列（一条一 ACK）
  }

  /**
   * 发送一条需要对方确认的业务数据。
   * 排入串行队列：上一条 ACK（或失败）后才发下一条。
   * @returns {Promise<void>} ACK 到达时 resolve；重试耗尽时 reject
   */
  send(payload) {
    const size = measurePayloadSize(payload);
    if (size > this._maxPayload) {
      return Promise.reject(
        new Error(`payload too large: ${size} bytes (max ${this._maxPayload})`)
      );
    }
    const task = () => this._sendReliable(payload);
    const next = this._queueTail.then(task, task);
    this._queueTail = next.catch(() => {}); // 失败不阻断后续队列
    return next;
  }

  /** 传输层把收到的信封交回这里（数据消息与 ACK 都走这里） */
  async handle(envelope) {
    if (!envelope || !envelope.msgId || !envelope.kind) return;

    if (envelope.kind === "ack") {
      this._resolveAck(envelope.msgId);
      return;
    }

    // ACK 必须在去重判断之前回：重复消息说明上次 ACK 丢了，必须再回一次
    try {
      await this._send({ msgId: envelope.msgId, kind: "ack" });
    } catch {
      // ACK 丢失由对端重发兜底
    }

    if (this._seen.has(envelope.msgId)) return; // 去重：业务逻辑只执行一次
    this._seen.set(envelope.msgId, Date.now());
    this._pruneSeen();

    this.onData?.(envelope.payload, envelope);
  }

  /** 重置去重表（接收端重启后内存去重失效，由调用方按需清理） */
  resetSeen() {
    this._seen.clear();
  }

  /** 停止所有等待中的发送（reject），通道销毁时调用 */
  destroy() {
    for (const [msgId, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`channel destroyed: ${msgId}`));
    }
    this._pending.clear();
  }

  _sendReliable(payload) {
    const msgId = genMsgId();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null, tries: 0 };
      this._pending.set(msgId, entry);

      const attempt = async () => {
        entry.tries++;
        if (entry.tries > this._maxRetry) {
          this._pending.delete(msgId);
          reject(
            new Error(
              `ACK timeout after ${this._maxRetry} attempts: ${msgId} (${this._id})`
            )
          );
          return;
        }
        let accepted = false;
        try {
          accepted = await this._send({ msgId, kind: "data", payload });
        } catch {
          accepted = false;
        }
        // 受理与否都进入定时等待：受理后等 ACK，未受理等下一轮重试。
        // 重发复用同一 msgId，接收方据此去重。
        entry.timer = setTimeout(attempt, this._timeout);
      };
      attempt();
    });
  }

  _resolveAck(msgId) {
    const entry = this._pending.get(msgId);
    if (!entry) return; // 迟到的重复 ACK，忽略
    clearTimeout(entry.timer);
    this._pending.delete(msgId);
    entry.resolve();
  }

  _pruneSeen() {
    const deadline = Date.now() - SEEN_TTL;
    for (const [id, ts] of this._seen) {
      if (ts < deadline) this._seen.delete(id);
    }
    // 容量兜底：超过上限时删除最早的一半
    if (this._seen.size > SEEN_MAX) {
      const ids = [...this._seen.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, Math.floor(SEEN_MAX / 2));
      for (const [id] of ids) this._seen.delete(id);
    }
  }
}
