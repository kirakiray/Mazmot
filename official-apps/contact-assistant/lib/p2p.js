const SERVICE_NAME = "contact-assistant";
const USER_NAMESPACE = "contact-assistant";

let _userCache = null;
let _remoteCache = new Map();
let _serviceReg = null;

export function getServiceName() {
  return SERVICE_NAME;
}

export async function getCurrentUser() {
  if (_userCache) return _userCache;
  const { getUser } = await import("/nos/user/main.js");
  _userCache = await getUser(USER_NAMESPACE);
  return _userCache;
}

export async function getCurrentUserId() {
  const user = await getCurrentUser();
  return user.userId;
}

/**
 * 注册 contact-assistant 服务，接收对端消息。
 * @param {(data: object, ctx: { fromUserId, fromSessionId, remoteUser }) => void} onMessage
 * @returns {Promise<() => void>} unregister function
 */
export async function registerService(onMessage) {
  const user = await getCurrentUser();
  console.log("[contact-assistant p2p] registerService for user:", user.userId);

  if (_serviceReg) {
    try {
      _serviceReg.unregister();
    } catch (_) {}
  }

  _serviceReg = user.registerService(SERVICE_NAME, {
    onMessage(data, ctx) {
      console.log("[contact-assistant p2p] service message received:", { data, from: ctx?.fromUserId, session: ctx?.fromSessionId });
      try {
        onMessage(data, ctx);
      } catch (err) {
        console.error("[contact-assistant p2p] service onMessage error:", err);
      }
    },
  });
  console.log("[contact-assistant p2p] service registered");

  return () => {
    try {
      _serviceReg?.unregister();
    } catch (_) {}
    _serviceReg = null;
  };
}

/**
 * Visitor 连接 Host。
 * @param {string} hostUserId
 * @returns {Promise<object>} remoteUser
 */
export async function connectHost(hostUserId) {
  if (!hostUserId) {
    throw new Error("缺少 hostUserId");
  }
  if (_remoteCache.has(hostUserId)) {
    console.log("[contact-assistant p2p] connectHost using cached remote:", hostUserId);
    return _remoteCache.get(hostUserId);
  }
  console.log("[contact-assistant p2p] connectHost connecting:", hostUserId);
  const user = await getCurrentUser();
  const remoteUser = await user.connectUser(hostUserId);
  _remoteCache.set(hostUserId, remoteUser);
  console.log("[contact-assistant p2p] connectHost connected:", hostUserId);
  return remoteUser;
}

/**
 * Visitor 向 Host 发送消息。
 * @param {string} hostUserId
 * @param {object} data
 * @returns {Promise<Array>} sendToService 返回结果数组
 */
export async function sendToHost(hostUserId, data) {
  console.log("[contact-assistant p2p] sendToHost:", { hostUserId, data });
  const remoteUser = await connectHost(hostUserId);
  const results = await remoteUser.sendToService(SERVICE_NAME, data);
  console.log("[contact-assistant p2p] sendToHost results:", results);
  return results;
}

/**
 * Host 向指定访客 session 回复。
 * @param {object} ctx - registerService onMessage 的 ctx
 * @param {object} data
 */
export async function replyToVisitor(ctx, data) {
  console.log("[contact-assistant p2p] replyToVisitor:", { ctx, data });
  if (!ctx?.remoteUser || !ctx?.fromSessionId) {
    throw new Error("缺少回复上下文");
  }
  const results = await ctx.remoteUser.sendToService(SERVICE_NAME, data, {
    sessionId: ctx.fromSessionId,
  });
  console.log("[contact-assistant p2p] replyToVisitor results:", results);
  return results;
}

/**
 * 检查 Host 是否在线（Visitor 侧可用）。
 * @param {string} hostUserId
 */
export async function isHostOnline(hostUserId) {
  try {
    const user = await getCurrentUser();
    return await user.isRemoteUserOnline(hostUserId);
  } catch (err) {
    console.error("isHostOnline error:", err);
    return false;
  }
}
