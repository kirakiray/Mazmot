// Conjure 隔离预览 —— 双端共享协议模块
//
// conjure（主域 30031）与 bridge（隔离域 30032）之间的应用文件传输协议。
// 双端同仓库同源，经绝对路径 /bridge/proto.js 引用（各自域内均由静态服务器提供）。
//
// 通信基于 noneos-core 的 registerService / sendToService（尽力投递），
// 本模块按「应用层可靠消息投递」规范实现信封 + ACK + 重发 + 去重 + 串行队列；
// 不直接 import /nos/*（Core 加载时机约束），传输句柄由调用方注入。
//
// 消息流（payload.type）：
//   bridge 页 / 应用页代理 → conjure（服务 conjure-preview）：
//     { type: "hello", userId }                 —— bridge 页就绪，告知自己的 userId
//     { type: "agent-online", userId }          —— 应用页内 inject.js 就绪（常驻代理）
//     { type: "sync-diff", appName, missing }   —— 增量比对结果：需要（重）传的 path 列表
//     { type: "done", appName, url }            —— 文件落盘完成（或已最新），回传运行 URL
//   conjure → bridge 页（服务 conjure-bridge）/ 应用页代理（服务 conjure-agent）：
//     { type: "sync-check", appName, manifest } —— 增量同步：[{path, hash}] 清单，比对本地
//     { type: "app-begin", appName, fileCount, wipe? }  —— wipe 缺省 true（全量，清目录重建）；
//                                                  增量推送时 false（只覆盖写入差异文件）
//     { type: "file", appName, path, seq, total, text }  —— 大文件按 seq/total 分片
//     { type: "app-end", appName }
//   conjure → 应用页代理（调试指令，见 debug-runtime.js 的指令集）：
//     { type: "dbg", cmd, args, reqId }        —— 在预览页执行调试指令（eval/console/click/...）
//   应用页代理 → conjure（调试结果；大结果按分片回传）：
//     { type: "dbg-chunk", reqId, seq, total, text } —— 调试结果分片（与文件分片同字节预算）
//     { type: "dbg-result", reqId, ok, result?|error?, chunks?, meta? }
//                                                  —— 小结果单条直达（result 携带全文）；
//                                                  大结果作汇总标记（chunks=分片数，文本以分片为准）

export const SERVICE_ID_CONJURE = "conjure-preview";
export const SERVICE_ID_BRIDGE = "conjure-bridge";
// 常驻代理：首次预览后由 inject.js 注入到应用页内注册（后续预览直连增量更新 + 自动刷新）
export const SERVICE_ID_AGENT = "conjure-agent";

// 双端共用的本地用户命名空间（各自 origin 独立存储，同串即可）
export const USER_NAMESPACE = "conjure-preview";

// 应用页注入的代理脚本地址（同源静态文件，绝对路径引用）
export const AGENT_SCRIPT_SRC = "/bridge/inject.js";

// 隔离域写入的 VFS 命名空间与应用运行 URL 前缀
export const BRIDGE_NAMESPACE = "conjure-apps";

// 文本文件扩展名白名单（与 conjure 的写入白名单一致，bridge 侧防御性复检）
const TEXT_EXT = [
  ".html", ".js", ".mjs", ".css", ".json", ".md", ".txt", ".svg",
  ".csv", ".xml", ".map",
];

/** 规范化应用名（与 conjure builder.sanitizeAppName 同规则） */
export function sanitizeAppName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
}

/** 校验相对路径（拒绝绝对路径 / .. 逃逸 / 非白名单扩展名），返回 { ok, reason } */
export function validateRelPath(path) {
  const p = String(path || "").trim();
  if (!p) return { ok: false, reason: "路径为空" };
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p))
    return { ok: false, reason: "不允许绝对路径" };
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === ".."))
    return { ok: false, reason: "路径中包含非法片段（.. 或空段）" };
  if (!TEXT_EXT.some((ext) => p.toLowerCase().endsWith(ext)))
    return {
      ok: false,
      reason: `只支持文本文件（${TEXT_EXT.join(" ")}）`,
    };
  return { ok: true };
}

// 单条消息业务 payload 的安全上限（服务端硬限制 256KB，
// 为加密与 JSON 序列化开销留余量，同 nos/publish 的 CHUNK_SIZE 取 128KB）
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// 文本分片按字符数取值：UTF-8 下单字符最多 4 字节，
// 96k 字符最坏 384KB 会超限，故按「字节预算」分片（见 chunkText）。
// 预算取 32KB：CI 等 UDP 受限环境只能走信令服务器中继（via:"server"），
// 实测大分片（64KB 级、E2EE+JSON 放大后更大）过中继曾触发连接掉线
//（sendToService 返回 offline 且重试窗口内不自愈）；32KB 在任何放大系数
// 下都远离服务端 256KB 硬限，宁可多分几片换稳定
const CHUNK_BYTE_BUDGET = 32 * 1024;

/** 粗测字符串 UTF-8 字节数（避免逐字符 TextEncoder 全量编码的开销） */
export function byteSize(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    if (c > 0xffff) i++; // 代理对占 2 个 code unit
    bytes += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * 把文本按字节预算切成若干片，保证每片 UTF-8 字节数不超限。
 * 切点按 code point 对齐，不会把代理对劈成两半。
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
  const chunks = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    const size = c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4;
    if (c > 0xffff) i++;
    if (bytes + size > CHUNK_BYTE_BUDGET && i > start) {
      chunks.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
  }
  if (start < text.length) chunks.push(text.slice(start));
  return chunks;
}

/**
 * 构造单个文件的全部传输消息（小文件天然单片）。
 * @param {string} appName
 * @param {string} path 相对 client/ 的路径
 * @param {string} text 文件完整内容
 */
export function buildFileMessages(appName, path, text) {
  const parts = chunkText(text);
  const total = parts.length;
  return parts.map((part, i) => ({
    type: "file",
    appName,
    path,
    seq: i,
    total,
    text: part,
  }));
}

/** 估算业务 payload 序列化后的粗略字节数（用于发送前校验） */
export function assertSendable(payload) {
  const size = byteSize(JSON.stringify(payload));
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `payload too large: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`,
    );
  }
  return size;
}

/** 计算文本内容的 SHA-256 hex（增量同步的文件指纹） */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 构造文件清单（path + sha256），供增量同步比对。
 * 清单本身远小于文件内容（每条约 80 字节），可单条发送。
 * @param {Array<{path: string, text: string}>} files
 * @returns {Promise<Array<{path: string, hash: string}>>}
 */
export async function buildManifest(files) {
  return Promise.all(
    files.map(async (f) => ({ path: f.path, hash: await sha256Hex(f.text) })),
  );
}

const SEEN_TTL = 5 * 60 * 1000;

/**
 * 可靠链路：一端一实例，同时承担发送（串行队列 + ACK 等待 + 超时重发）
 * 与接收（回 ACK + 按 msgId 去重）。
 *
 * @param {Object} opts
 * @param {(envelope: Object) => Promise<any[]>} opts.sendTo
 *        底层发送函数（通常包装 remoteUser.sendToService(appId, env, { sessionId })）
 * @param {() => Promise} [opts.onOffline]
 *        发送结果为 offline / no_receiver / error 时，重试等待前先回调——
 *        消费方借此主动重连信令服务器。实测（CI 中继通道）连接掉线后
 *        noneos 未必及时自愈，干等重试只会耗尽次数；钩子抛错不影响重试节奏
 * @param {number} [opts.ackTimeout=3000]
 *        单次 ACK 等待基准（小消息实际值）；大载荷自动按字节放宽（每 16KB +1s）
 * @param {number} [opts.maxRetry=3]
 */
export function createReliableLink({
  sendTo,
  onOffline = null,
  ackTimeout = 3000,
  maxRetry = 3,
}) {
  const pendingAcks = new Map(); // msgId -> { resolve, reject, timer, tries, waitMs, maxTries }
  const seenIds = new Map(); // msgId -> 首次接收时间戳
  const sendQueues = new Map(); // 队列 key -> 尾部 Promise
  let msgSeq = 0;

  // 单次 ACK 等待时长：大载荷按字节放宽——慢网络（CI / 远端信令中继）下
  // 大分片的一次往返可能超过固定 3s，若不放宽，重试反而重复推全量
  // 载荷加剧拥塞并耗尽次数（CI 的 WebKit 集成测试曾因此报 ACK timeout）。
  // 每 16KB 加 1s，小消息维持原 ackTimeout 不变
  const waitMsFor = (payload) => {
    let bytes = 0;
    try {
      bytes = byteSize(JSON.stringify(payload));
    } catch (_) {}
    return Math.max(ackTimeout, Math.ceil(bytes / (16 * 1024)) * 1000);
  };

  // 可用尝试次数：大载荷按字节追加（noneos 文档明确「通道切换（RTC↔中继）
  // 期间发出的消息可能丢失」——丢失与重发恢复都是常态，大分片需要更长的
  // 总重试窗口等通道回稳；每 32KB +1 次，上限 +5）
  const maxTriesFor = (payload) => {
    let bytes = 0;
    try {
      bytes = byteSize(JSON.stringify(payload));
    } catch (_) {}
    return maxRetry + Math.min(5, Math.floor(bytes / (32 * 1024)));
  };

  const pruneSeen = () => {
    const deadline = Date.now() - SEEN_TTL;
    for (const [id, ts] of seenIds) {
      if (ts < deadline) seenIds.delete(id);
    }
  };

  const attempt = (msgId, payload, entry) =>
    new Promise((resolveAttempt) => {
      const run = async () => {
        entry.tries++;
        if (entry.tries > entry.maxTries) {
          pendingAcks.delete(msgId);
          entry.reject(
            new Error(
              `ACK timeout after ${entry.maxTries - 1} retries: ${msgId}`,
            ),
          );
          return;
        }
        let delivered = false;
        try {
          // 重发复用同一 msgId，接收方据此去重
          const results = await sendTo({ msgId, kind: "data", payload });
          delivered = !!(results && results.some((r) => r && r.status === "ok"));
        } catch (_) {}
        if (!delivered) {
          // 连通道都没进去（no_receiver / offline / error）：先让消费方
          // 主动重连（掉线后干等重试曾整窗耗尽），再进入下一轮
          if (onOffline) {
            try {
              await onOffline();
            } catch (_) {}
          }
          entry.timer = setTimeout(run, entry.waitMs);
          return;
        }
        entry.timer = setTimeout(run, entry.waitMs);
        resolveAttempt();
      };
      run();
    });

  /** 发送一条业务消息，收到 ACK 后 resolve；实现串行（上一条落定才发下一条） */
  const send = (payload, queueKey = "default") => {
    assertSendable(payload);
    const task = () =>
      new Promise((resolve, reject) => {
        const msgId = `m-${Date.now()}-${++msgSeq}`;
        const entry = { resolve, reject, timer: null, tries: 0 };
        entry.waitMs = waitMsFor(payload);
        entry.maxTries = maxTriesFor(payload);
        pendingAcks.set(msgId, entry);
        attempt(msgId, payload, entry);
      });
    const prev = sendQueues.get(queueKey) ?? Promise.resolve();
    const next = prev.then(task, task);
    sendQueues.set(queueKey, next);
    next.finally(() => {
      if (sendQueues.get(queueKey) === next) sendQueues.delete(queueKey);
    });
    return next;
  };

  const resolveAck = (msgId) => {
    const entry = pendingAcks.get(msgId);
    if (!entry) return; // 迟到的重复 ACK，忽略
    clearTimeout(entry.timer);
    pendingAcks.delete(msgId);
    entry.resolve();
  };

  /**
   * 接收一条信封消息。
   * ACK 消息只结算本端等待；数据消息立即回 ACK（先于去重），
   * 重复消息返回 null（业务不重复执行）。
   * @returns {Object|null} 首次收到的业务 payload；ACK / 重复消息返回 null
   */
  const receive = (data, reply) => {
    if (!data || typeof data.msgId !== "string") return null;
    if (data.kind === "ack") {
      resolveAck(data.msgId);
      return null;
    }
    // 无论是否重复都先回 ACK（重复消息说明上次 ACK 丢了）
    if (reply) {
      try {
        reply({ msgId: data.msgId, kind: "ack" });
      } catch (_) {
        /* ACK 发送失败由对端重发兜底 */
      }
    }
    if (seenIds.has(data.msgId)) return null;
    seenIds.set(data.msgId, Date.now());
    pruneSeen();
    return data.payload;
  };

  /** 放弃所有在途发送（页面关闭 / 会话失效时调用） */
  const dispose = () => {
    for (const [, entry] of pendingAcks) {
      clearTimeout(entry.timer);
      entry.reject(new Error("link disposed"));
    }
    pendingAcks.clear();
    seenIds.clear();
  };

  return { send, receive, dispose };
}

/**
 * 文件拼装器（bridge 接收端）：按 path 聚合分片，收齐返回完整文本。
 * 纯逻辑，便于单测。
 */
export function createFileAssembler() {
  const entries = new Map(); // path -> { total, parts: [] }
  const completed = new Set(); // 已收齐的 path（迟到重复分片直接忽略，容量封顶）
  const COMPLETED_CAP = 1000;

  /**
   * @param {{ path: string, seq: number, total: number, text: string }} msg
   * @returns {{ path: string, text: string } | null} 收齐最后一片时返回完整文件
   */
  const push = (msg) => {
    const { path, seq, total, text } = msg;
    // 文件已收齐后的迟到重复分片（entry 已删除），静默忽略
    if (completed.has(path)) return null;
    let entry = entries.get(path);
    if (!entry) {
      entry = { total, parts: new Array(total).fill(undefined) };
      entries.set(path, entry);
    }
    if (seq < 0 || seq >= entry.total || entry.parts[seq] !== undefined) {
      throw new Error(`非法文件分片：${path} #${seq}/${entry.total}`);
    }
    entry.parts[seq] = text;
    if (entry.parts.every((p) => p !== undefined)) {
      entries.delete(path);
      completed.add(path);
      if (completed.size > COMPLETED_CAP) {
        completed.delete(completed.values().next().value);
      }
      return { path, text: entry.parts.join("") };
    }
    return null;
  };

  /** 尚未收齐的文件数（进度展示用） */
  const pendingCount = () => entries.size;

  return { push, pendingCount };
}

/* ---------- 调试指令（dbg）结果回传 ---------- */

/**
 * 构造调试结果的回传消息序列（应用页代理 → conjure）。
 * 小结果单条 dbg-result 直达；大结果先按 chunkText 分片为 dbg-chunk
 * （seq/total，串行链路保序），末条 dbg-result 作汇总标记（chunks=分片数）。
 * @param {string} reqId 调试指令携带的请求 id（原样回传配对）
 * @param {{ ok: boolean, result?: string, error?: string, meta?: Object }} outcome
 * @returns {Array<Object>} 待逐条 link.send 的消息
 */
export function buildDbgResultMessages(reqId, outcome) {
  const meta = outcome.meta ?? null;
  if (!outcome.ok) {
    return [
      {
        type: "dbg-result",
        reqId,
        ok: false,
        error: String(outcome.error ?? "unknown error"),
        meta,
      },
    ];
  }
  const text = String(outcome.result ?? "");
  // 与文件分片同预算（64KB 字节），为 JSON 包装开销再留 2KB 余量
  if (byteSize(text) > CHUNK_BYTE_BUDGET - 2048) {
    const parts = chunkText(text);
    const msgs = parts.map((part, i) => ({
      type: "dbg-chunk",
      reqId,
      seq: i,
      total: parts.length,
      text: part,
    }));
    msgs.push({ type: "dbg-result", reqId, ok: true, chunks: parts.length, meta });
    return msgs;
  }
  return [{ type: "dbg-result", reqId, ok: true, result: text, meta }];
}

/**
 * 调试结果收集器（conjure 侧）：按 reqId 聚合 dbg-chunk 分片，
 * 收到 dbg-result 汇总且分片齐备时返回拼装后的最终结果。
 * 与 createFileAssembler 同构，纯逻辑便于单测。
 * @returns {{ push(msg: Object): ({ok: boolean, result?: string, error?: string, meta: Object} | null) }}
 */
export function createDbgCollector() {
  const entries = new Map(); // reqId -> { total, parts: [] }

  const push = (msg) => {
    if (!msg || typeof msg.reqId !== "string") return null;
    if (msg.type === "dbg-chunk") {
      let entry = entries.get(msg.reqId);
      if (!entry) {
        entry = { total: msg.total || 0, parts: [] };
        entries.set(msg.reqId, entry);
      }
      const seq = Number(msg.seq);
      if (!(seq >= 0) || seq >= entry.total || entry.parts[seq] !== undefined) {
        throw new Error(`非法调试结果分片：${msg.reqId} #${seq}/${entry.total}`);
      }
      entry.parts[seq] = msg.text;
      return null;
    }
    if (msg.type === "dbg-result") {
      const entry = entries.get(msg.reqId);
      if (msg.ok === false) {
        entries.delete(msg.reqId);
        return { ok: false, error: msg.error, meta: msg.meta ?? null };
      }
      // 单条直达（无分片）
      if (!entry || msg.chunks == null) {
        entries.delete(msg.reqId);
        return {
          ok: true,
          result: String(msg.result ?? ""),
          meta: msg.meta ?? null,
        };
      }
      const complete =
        msg.chunks === entry.total &&
        entry.parts.length === entry.total &&
        entry.parts.every((p) => p !== undefined);
      entries.delete(msg.reqId);
      if (!complete) {
        return { ok: false, error: "调试结果分片不完整", meta: msg.meta ?? null };
      }
      return { ok: true, result: entry.parts.join(""), meta: msg.meta ?? null };
    }
    return null;
  };

  return { push };
}
