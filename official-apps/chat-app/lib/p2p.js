// chat-app P2P 封装
// 基于 NoneOS Core user API，封装服务注册、连接、收发消息、在线状态、名片（用户名）获取。
// 与 ping-pong 模板、contact-assistant 应用保持一致的命名空间约定。

const SERVICE_NAME = "chat-app";
// 使用 default 命名空间，与 Mazmot 主系统共享用户身份（主系统设置的昵称在此也生效）
const USER_NAMESPACE = "default";

let _userCache = null;
let _remoteCache = new Map(); // hostUserId -> remoteUser
let _serviceReg = null;
let _eventUnbinds = []; // [{ userId, fn }] 针对每个对端的事件解绑函数

// ===== 工具：打印带前缀的日志 =====
function log(...args) {
  console.log("%c[chat-app p2p]", "color:#6750a4;font-weight:600;", ...args);
}
function logError(...args) {
  console.error("%c[chat-app p2p]%c [错误]", "color:#b3261e;font-weight:600;", "color:inherit;", ...args);
}

export function getServiceName() {
  return SERVICE_NAME;
}

/**
 * 获取当前用户（同命名空间复用密钥与连接状态）。
 * @returns {Promise<object>} NoneOS Core user 对象
 */
export async function getCurrentUser() {
  if (_userCache) {
    log("getCurrentUser: 命中缓存，userId =", _userCache.userId);
    return _userCache;
  }
  log("getCurrentUser: 首次加载 /nos/user/main.js ...");
  const { getUser } = await import("/nos/user/main.js");
  log("getCurrentUser: 调用 getUser(" + USER_NAMESPACE + ") ...");
  _userCache = await getUser(USER_NAMESPACE);
  log("getCurrentUser: 已获取用户，userId =", _userCache.userId);
  return _userCache;
}

/**
 * 获取当前用户 ID。
 */
export async function getCurrentUserId() {
  const user = await getCurrentUser();
  return user.userId;
}

/**
 * 获取当前用户的用户名（优先 nickname，其次默认 username）。
 * @returns {Promise<{username:string, nickname:string, displayName:string}>}
 */
export async function getCurrentUserInfo() {
  const user = await getCurrentUser();
  log("getCurrentUserInfo: 调用 user.getInfo() ...");
  const info = await user.getInfo();
  const displayName = info.nickname || info.username || ("user-" + user.userId.slice(0, 6));
  log("getCurrentUserInfo:", { userId: user.userId, username: info.username, nickname: info.nickname, displayName });
  return { username: info.username, nickname: info.nickname, displayName };
}

/**
 * 获取对方的用户名（通过名片交换，connectUser 后可拿）。
 * 名片会自动缓存，二次调用直接返回缓存值。
 * @param {string} peerUserId
 * @returns {Promise<{username:string, nickname:string, displayName:string} | null>}
 */
export async function getPeerInfo(peerUserId) {
  try {
    const user = await getCurrentUser();
    log("getPeerInfo: user.card.get(" + peerUserId + ") ...");
    const card = await user.card.get(peerUserId);
    if (!card) {
      log("getPeerInfo: 名片为空，peerUserId =", peerUserId);
      return null;
    }
    const displayName = card.nickname || card.username || ("user-" + peerUserId.slice(0, 6));
    log("getPeerInfo:", { peerUserId, username: card.username, nickname: card.nickname, displayName });
    return { username: card.username, nickname: card.nickname, displayName };
  } catch (err) {
    logError("getPeerInfo 失败:", err, "peerUserId =", peerUserId);
    return null;
  }
}

/**
 * 注册 chat-app 服务，接收对端消息。
 * @param {(data: object, ctx: { fromUserId, fromSessionId, remoteUser }) => void} onMessage
 * @returns {Promise<() => void>} unregister 函数
 */
export async function registerService(onMessage) {
  const user = await getCurrentUser();
  log("registerService: 为用户注册服务，userId =", user.userId);

  if (_serviceReg) {
    log("registerService: 已存在旧注册，先注销");
    try { _serviceReg.unregister(); } catch (_) {}
  }

  _serviceReg = user.registerService(SERVICE_NAME, {
    onMessage(data, ctx) {
      const from = ctx && ctx.fromUserId;
      const session = ctx && ctx.fromSessionId;
      log("registerService: 收到消息 ↓", {
        data: typeof data === "object" ? JSON.stringify(data) : data,
        fromUserId: from,
        fromSessionId: session,
      });
      try {
        onMessage(data, ctx);
      } catch (err) {
        logError("registerService: onMessage 回调异常:", err);
      }
    },
  });
  log("registerService: 服务已注册 ✓");

  return () => {
    log("registerService: 注销服务");
    try { _serviceReg && _serviceReg.unregister(); } catch (_) {}
    _serviceReg = null;
  };
}

/**
 * 连接远端用户（带缓存）。
 * @param {string} hostUserId
 * @returns {Promise<object>} remoteUser
 */
export async function connectPeer(peerUserId) {
  if (!peerUserId) throw new Error("缺少 peerUserId");
  if (_remoteCache.has(peerUserId)) {
    log("connectPeer: 命中缓存，peerUserId =", peerUserId);
    return _remoteCache.get(peerUserId);
  }
  log("connectPeer: connectUser(" + peerUserId + ") ...");
  const user = await getCurrentUser();
  const remoteUser = await user.connectUser(peerUserId);
  _remoteCache.set(peerUserId, remoteUser);
  log("connectPeer: 已连接 ✓，peerUserId =", peerUserId);
  return remoteUser;
}

/**
 * 向对端发送消息。
 * @param {string} peerUserId
 * @param {object} data
 * @returns {Promise<Array>} sendToService 返回结果数组
 */
export async function sendToPeer(peerUserId, data) {
  log("sendToPeer →", { peerUserId, data });
  const remoteUser = await connectPeer(peerUserId);
  const results = await remoteUser.sendToService(SERVICE_NAME, data);
  log("sendToPeer: 返回结果", results);
  return results;
}

/**
 * 通过 ctx 定向回复某个 session（host 回复指定 customer）。
 * @param {object} ctx registerService onMessage 的 ctx
 * @param {object} data
 */
export async function replyToSession(ctx, data) {
  if (!ctx || !ctx.remoteUser || !ctx.fromSessionId) {
    throw new Error("缺少回复上下文（ctx.remoteUser / ctx.fromSessionId）");
  }
  log("replyToSession →", { toSessionId: ctx.fromSessionId, fromUserId: ctx.fromUserId, data });
  const results = await ctx.remoteUser.sendToService(SERVICE_NAME, data, {
    sessionId: ctx.fromSessionId,
  });
  log("replyToSession: 返回结果", results);
  return results;
}

/**
 * 检查对端是否在线。
 * @param {string} peerUserId
 * @returns {Promise<boolean>}
 */
export async function isPeerOnline(peerUserId) {
  try {
    const user = await getCurrentUser();
    const online = await user.isRemoteUserOnline(peerUserId);
    log("isPeerOnline:", { peerUserId, online });
    return online;
  } catch (err) {
    logError("isPeerOnline 失败:", err);
    return false;
  }
}

/**
 * 绑定对端的上下线 / RTT / RTC 状态事件。
 * 返回解绑函数；调用方在 detached 时执行。
 *
 * @param {string} peerUserId 对端 userId
 * @param {{ onOnline?:Function, onOffline?:Function, onLinkType?:Function }} handlers
 *   - onLinkType(via: "rtc" | "server" | "") 连接方式变化
 * @returns {Promise<() => void>} 解绑函数
 */
export async function bindPeerEvents(peerUserId, handlers = {}) {
  const user = await getCurrentUser();
  const unbinds = [];

  // 1) 上线
  unbinds.push(
    user.bind("remote_user_connected", (event) => {
      const detail = (event && event.detail) || {};
      if (detail.userId !== peerUserId) return;
      log("事件 remote_user_connected:", { peerUserId, initiatedBy: detail.initiatedBy });
      if (handlers.onOnline) handlers.onOnline();
    }),
  );

  // 2) 下线
  unbinds.push(
    user.bind("remote_user_disconnected", (event) => {
      const detail = (event && event.detail) || {};
      if (detail.userId !== peerUserId) return;
      log("事件 remote_user_disconnected:", { peerUserId, reason: detail.reason });
      if (handlers.onOffline) handlers.onOffline();
    }),
  );

  // 3) RTT 更新 → 连接方式
  unbinds.push(
    user.bind("rtt_update", (event) => {
      const detail = (event && event.detail) || {};
      if (detail.userId !== peerUserId || !detail.via) return;
      log("事件 rtt_update:", { peerUserId, via: detail.via, rtt: detail.rtt });
      if (handlers.onLinkType) handlers.onLinkType(detail.via);
    }),
  );

  // 4) RTC 协商状态
  unbinds.push(
    user.bind("rtc_state", (event) => {
      const detail = (event && event.detail) || {};
      if (detail.userId !== peerUserId) return;
      log("事件 rtc_state:", { peerUserId, state: detail.state });
      if (!handlers.onLinkType) return;
      if (detail.state === "connected") {
        handlers.onLinkType("rtc");
      } else if (detail.state === "disconnected" || detail.state === "failed" || detail.state === "closed") {
        handlers.onLinkType("server"); // 回退到服务器中转
      }
    }),
  );

  const unbindFn = () => {
    log("bindPeerEvents: 解绑对端事件，peerUserId =", peerUserId);
    unbinds.forEach((fn) => { try { fn(); } catch (_) {} });
  };
  _eventUnbinds.push({ peerUserId, fn: unbindFn });
  return unbindFn;
}

/**
 * 解绑所有事件（全局清理，detached 时调用）。
 */
export function unbindAllEvents() {
  log("unbindAllEvents: 共", _eventUnbinds.length, "组");
  _eventUnbinds.forEach(({ fn }) => { try { fn(); } catch (_) {} });
  _eventUnbinds = [];
}

/**
 * 主动断开对端连接（清理缓存）。
 * @param {string} peerUserId
 */
export async function disconnectPeer(peerUserId) {
  try {
    _remoteCache.delete(peerUserId);
    const user = await getCurrentUser();
    log("disconnectPeer:", peerUserId);
    await user.disconnectUser(peerUserId);
  } catch (err) {
    logError("disconnectPeer 失败:", err);
  }
}

/**
 * 根据 sendToService 的返回结果数组，判断是否送达并提取连接方式。
 * @param {Array} results
 * @returns {{ delivered:boolean, via:string, offline:boolean }}
 */
export function parseSendResults(results) {
  const ret = { delivered: false, via: "", offline: false };
  if (!Array.isArray(results) || results.length === 0) return ret;
  const ok = results.find((r) => r && r.status === "ok");
  if (ok) {
    ret.delivered = true;
    ret.via = ok.via === "rtc" ? "rtc" : ok.via ? "server" : "";
  } else {
    ret.offline = results.some(
      (r) => r && (r.status === "offline" || r.status === "error" || r.status === "discovery_failed"),
    );
  }
  return ret;
}
