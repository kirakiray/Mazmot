// cred-manager live-share —— 基于.noneos-core用户服务通信（registerService /
// sendToService）的实时互授协议，UI 逻辑分离于此，便于单测。
//
// 协议要点（遵循 noneos-core reliable-messaging 规范）：
// - 每条业务消息带唯一 msgId，接收方先回 ACK 再做去重与业务处理
// - 发送方超时未收到 ACK 则复用同一 msgId 重发，接收方按 msgId 去重
// - 同一目标串行发送（前一条 ACK 后才发下一条），ACK 不进串行队列
// 消息信封：
//   { msgId, kind: "data", payload: { type: "match"|"list-request"|"list-response", ... } }
//   { msgId, kind: "ack" }
// 拉取模式：本页只负责「互见 + 清单发现」，证书本体始终走 core 的
// getRecord(holderId, {role, issuer, subject}) 在线拉取（自动验签入库），
// 服务消息不传证书内容，避免绕过 core 的验签路径。

export const SERVICE_APP_ID = "cred-share-v1";

// incoming-matches 条目保留时长（超过即视为过期，读取时清掉）
const MATCH_TTL_MS = 7 * 24 * 3600 * 1000;

// ———— ACK 重发参数（保守默认，见 reliable-messaging 文档第 5 条） ————
const ACK_TIMEOUT = 3000;
const MAX_RETRY = 3;

// ———— 发送侧状态（模块级，与接收侧共享 msgId 空间） ————

const pendingAcks = new Map(); // msgId -> { resolve, reject, timer, tries }
let msgSeq = 0;

// list-request 的响应等待表：msgId -> { resolve, reject, timer }
const listResponseWaiters = new Map();

const sendQueues = new Map(); // `${userId}:${sessionId ?? "all"}` -> 尾部 Promise

const seenIds = new Map(); // msgId -> 首次接收时间戳（去重）
const SEEN_TTL = 5 * 60 * 1000;

/**
 * 把发送操作排入对应目标的串行队列（前一条完成/失败后才发下一条）
 */
const enqueue = (key, task) => {
  const prev = sendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  sendQueues.set(key, next);
  next.finally(() => {
    if (sendQueues.get(key) === next) sendQueues.delete(key);
  });
  return next;
};

/**
 * 发送一条需要对方确认的消息；ACK 超时复用同一 msgId 重发
 * @returns {{ msgId: string, done: Promise<void> }} done 在 ACK 到达时 resolve，
 *          重试耗尽 / 对端不可达时 reject
 */
const sendReliable = (remoteUser, payload) => {
  const msgId = `m-${Date.now()}-${++msgSeq}`;
  const done = new Promise((resolve, reject) => {
    const entry = { resolve, reject, timer: null, tries: 0 };
    pendingAcks.set(msgId, entry);
    const attempt = async () => {
      // ACK 已在定时器触发前到达并结算，跳过本轮重发
      if (!pendingAcks.has(msgId)) return;
      entry.tries++;
      if (entry.tries > MAX_RETRY) {
        pendingAcks.delete(msgId);
        reject(new Error(`ACK 超时（已重试 ${MAX_RETRY} 次）：${msgId}`));
        return;
      }
      try {
        const results = await remoteUser.sendToService(
          SERVICE_APP_ID,
          { msgId, kind: "data", payload },
          { waitForService: ACK_TIMEOUT },
        );
        if (!results.some((r) => r.status === "ok")) {
          // no_receiver / offline / error：对端不可达，直接失败，不空耗重试
          pendingAcks.delete(msgId);
          clearTimeout(entry.timer);
          reject(
            new Error(
              results[0]?.status === "offline" || !results.length
                ? "对方不在线"
                : `消息未送达（${results[0]?.status ?? "unknown"}）`,
            ),
          );
          return;
        }
      } catch (err) {
        pendingAcks.delete(msgId);
        clearTimeout(entry.timer);
        reject(err);
        return;
      }
      // 已进入传输通道，等 ACK；超时则重发
      entry.timer = setTimeout(attempt, ACK_TIMEOUT);
    };
    attempt();
  });
  return { msgId, done };
};

/** 收到 ACK 时结算本端等待中的发送 */
const resolveAck = (msgId) => {
  const entry = pendingAcks.get(msgId);
  if (!entry) return; // 迟到的重复 ACK，忽略
  clearTimeout(entry.timer);
  pendingAcks.delete(msgId);
  entry.resolve();
};

const pruneSeen = () => {
  const deadline = Date.now() - SEEN_TTL;
  for (const [id, ts] of seenIds) {
    if (ts < deadline) seenIds.delete(id);
  }
};

// ———— 对外：发送封装 ————

/**
 * 向对方推送「我匹配了你」通知（携带本方签名卡片）
 * @param {object} remoteUser connectUser 得到的 RemoteUser
 * @param {object} card 本方签名 profile 卡片（user.getInfo()）
 */
export const notifyMatch = (remoteUser, card) =>
  enqueue(
    `${remoteUser.userId}:all`,
    () => sendReliable(remoteUser, { type: "match", card }).done,
  );

/**
 * 向对方请求「与我相关的证书」清单（仅元数据，不含签名内容；
 * 正式拉取由调用方走 core 的 getRecord / claimCert 完成，自动验签）
 * @param {object} remoteUser RemoteUser
 * @param {string} subject 我的 userId
 * @param {object} [options] { timeout } 等响应的超时毫秒数
 * @returns {Promise<object[]>} [{ id, role, issuer, subject, signTime, expire }]
 */
export const requestCertList = (remoteUser, subject, { timeout = 15000 } = {}) =>
  enqueue(`${remoteUser.userId}:all`, async () => {
    const { msgId, done } = sendReliable(remoteUser, {
      type: "list-request",
      subject,
    });
    const waiter = new Promise((resolve, reject) => {
      listResponseWaiters.set(msgId, { resolve, reject, timer: null });
      listResponseWaiters.get(msgId).timer = setTimeout(() => {
        listResponseWaiters.delete(msgId);
        reject(new Error("对方清单响应超时"));
      }, Math.max(timeout, ACK_TIMEOUT * (MAX_RETRY + 1)));
    });
    try {
      await done; // 先等请求被确认，再等响应
      return await waiter;
    } finally {
      const entry = listResponseWaiters.get(msgId);
      if (entry) {
        clearTimeout(entry.timer);
        listResponseWaiters.delete(msgId);
      }
    }
  });

/**
 * 探测对方是否可达（在线且可建立连接）；仅作 UI 提示，最终以发送结果为准
 */
export const isPeerReachable = async (user, peerId) => {
  try {
    return await user.isRemoteUserOnline(peerId);
  } catch {
    return false;
  }
};

// ———— 对外：服务注册（接收侧） ————

/**
 * 在本方用户实例上注册互授服务。页面（应用）打开期间有效，关闭即失效；
 * 因此对端发送时若本端离线会收到「对方不在线」。
 * @param {object} user LocalUser 实例
 * @param {object} handlers
 *   - onMatch(card, fromUserId)：有人匹配了我
 *   - listCerts(subject)：返回本地保管的、与 subject 相关的证书元数据列表
 *     （异步）；返回的只是展示用元数据，对方拉取时 core 仍会按 key 验签
 * @returns {{ unregister: () => void }}
 */
export const registerShareService = (user, handlers) => {
  const service = user.registerService(SERVICE_APP_ID, {
    async onMessage(data, ctx) {
      if (!data || !data.msgId) return;

      // 1. ACK 分支：结算本端等待中的发送
      if (data.kind === "ack") {
        resolveAck(data.msgId);
        return;
      }

      // 2. 先回 ACK（必须在去重之前：重复消息说明上次 ACK 丢了）
      ctx.remoteUser
        .sendToService(
          SERVICE_APP_ID,
          { msgId: data.msgId, kind: "ack" },
          { sessionId: ctx.fromSessionId },
        )
        .catch(() => {});

      // 3. 去重
      if (seenIds.has(data.msgId)) return;
      seenIds.set(data.msgId, Date.now());
      pruneSeen();

      // 4. 业务分发
      const payload = data.payload || {};
      const fromUserId =
        ctx.fromUserId || (ctx.remoteUser && ctx.remoteUser.userId) || "";
      try {
        if (payload.type === "match" && payload.card) {
          await addIncomingMatch(payload.card, fromUserId);
          handlers.onMatch?.(payload.card, fromUserId);
        } else if (payload.type === "list-request" && payload.subject) {
          const certs = (await handlers.listCerts?.(payload.subject)) || [];
          // 响应也要可靠投递（对端按 replyTo 关联请求），但必须直发、
          // 不进串行队列：双方同时拉取时，队列首都是各自在等的 list-request，
          // 响应若排队会被自己这条请求堵死，形成互相等待的死锁
          sendReliable(ctx.remoteUser, {
            type: "list-response",
            replyTo: data.msgId,
            certs,
          }).done.catch((err) =>
            console.warn("清单响应发送失败：", err),
          );
        } else if (payload.type === "list-response" && payload.replyTo) {
          const waiter = listResponseWaiters.get(payload.replyTo);
          if (waiter) {
            clearTimeout(waiter.timer);
            listResponseWaiters.delete(payload.replyTo);
            waiter.resolve(payload.certs || []);
          }
        }
      } catch (err) {
        console.warn("处理互授消息失败：", err);
      }
    },
  });
  return { unregister: () => service.unregister() };
};

// ———— 本地持久化（getStorage("mz-cert")，与 /mz/cert 系列共用空间） ————

const getStore = async () => {
  const { getStorage } = await import("/nos/storage/main.js");
  return getStorage("mz-cert");
};

/**
 * 记录「谁匹配了我」（收到 match 通知时写入）
 */
export const addIncomingMatch = async (card, fromUserId) => {
  const store = await getStore();
  const list = (await store.getItem("incoming-matches")) || [];
  const userId = card.subject || fromUserId;
  const rest = list.filter((m) => m.userId !== userId);
  rest.unshift({ userId, card, time: Date.now() });
  await store.setItem("incoming-matches", rest.slice(0, 50));
};

/**
 * 「匹配了我的」列表（自动清理过期条目）
 */
export const listIncomingMatches = async () => {
  const store = await getStore();
  const list = (await store.getItem("incoming-matches")) || [];
  const deadline = Date.now() - MATCH_TTL_MS;
  const fresh = list.filter((m) => m.time >= deadline);
  if (fresh.length !== list.length) {
    await store.setItem("incoming-matches", fresh);
  }
  return fresh;
};

export const removeIncomingMatch = async (userId) => {
  const store = await getStore();
  const list = ((await store.getItem("incoming-matches")) || []).filter(
    (m) => m.userId !== userId,
  );
  await store.setItem("incoming-matches", list);
};

/**
 * 记录「我匹配过的」（本端解析对方配对码成功后写入，供页面回显）
 */
export const addOutgoingMatch = async (card) => {
  const store = await getStore();
  const list = (await store.getItem("outgoing-matches")) || [];
  const rest = list.filter((m) => m.userId !== card.subject);
  rest.unshift({ userId: card.subject, card, time: Date.now() });
  await store.setItem("outgoing-matches", rest.slice(0, 50));
};

export const listOutgoingMatches = async () => {
  const store = await getStore();
  const list = (await store.getItem("outgoing-matches")) || [];
  const deadline = Date.now() - MATCH_TTL_MS;
  const fresh = list.filter((m) => m.time >= deadline);
  if (fresh.length !== list.length) {
    await store.setItem("outgoing-matches", fresh);
  }
  return fresh;
};

export const removeOutgoingMatch = async (userId) => {
  const store = await getStore();
  const list = ((await store.getItem("outgoing-matches")) || []).filter(
    (m) => m.userId !== userId,
  );
  await store.setItem("outgoing-matches", list);
};
