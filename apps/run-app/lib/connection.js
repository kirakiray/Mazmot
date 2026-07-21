// run-app 页面的连接层辅助函数。
// 保持纯函数 / 无 DOM 依赖，方便单测与复用。

/**
 * 轮询等待 RTC 直连就绪。
 * @param {object} remoteUser
 * @param {number} timeout - 毫秒
 * @returns {Promise<{ ready: boolean, waited: number }>}
 */
export async function waitForRtcReady(remoteUser, timeout) {
  const start = Date.now();
  const check = () => {
    try {
      const info = remoteUser.getRTT && remoteUser.getRTT();
      return info && info.via === "rtc";
    } catch (_) {
      return false;
    }
  };
  if (check()) return { ready: true, waited: 0 };
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve({ ready: true, waited: Date.now() - start });
      } else if (Date.now() - start >= timeout) {
        clearInterval(timer);
        resolve({ ready: false, waited: Date.now() - start });
      }
    }, 100);
  });
}

/**
 * 确保本地用户已连上至少一台信令服务器，然后才能 connectUser。
 *
 * `user.ready()` 只是发起连接，握手可能尚未完成；若此时 connectedUrls 为空
 * 就直接 connectUser，会立刻抛 "User X is not online on any connected server"。
 * 这里先轮询等待自动连接就绪，超时后再主动 connect 配置里的服务器兜底。
 *
 * @param {object} user - LocalUser
 * @param {object} [options]
 * @param {number} [options.timeout=8000] - 等待自动连接的总超时（毫秒）
 * @param {number} [options.pollInterval=100] - 轮询间隔（毫秒）
 * @returns {Promise<{ connected: boolean, urls: string[], servers: string[], errors: Array<{url:string, msg:string}> }>}
 */
export async function ensureServerConnected(
  user,
  { timeout = 8000, pollInterval = 100 } = {},
) {
  if (!user || !user.server) {
    return { connected: false, urls: [], servers: [], errors: [] };
  }
  const connectedUrls = () =>
    Array.isArray(user.server.connectedUrls) ? user.server.connectedUrls : [];

  // 已连上直接返回
  if (connectedUrls().length > 0) {
    return {
      connected: true,
      urls: connectedUrls(),
      servers: [],
      errors: [],
    };
  }

  const start = Date.now();
  // 先等 ready() 发起的自动连接完成（约一半超时时间）
  const passiveDeadline = start + Math.floor(timeout / 2);
  while (Date.now() < passiveDeadline) {
    if (connectedUrls().length > 0) {
      return {
        connected: true,
        urls: connectedUrls(),
        servers: [],
        errors: [],
      };
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // 仍未连上：主动连接配置里的服务器兜底，并记录每台的失败原因
  let servers = [];
  try {
    servers = (await user.server.getServers()) || [];
  } catch (err) {
    return {
      connected: connectedUrls().length > 0,
      urls: connectedUrls(),
      servers: [],
      errors: [{ url: "(getServers)", msg: String((err && err.message) || err) }],
    };
  }
  const errors = [];
  await Promise.all(
    servers.map((url) =>
      user.server.connect(url).catch((err) => {
        // 单台失败记录原因，靠其它服务器兜底
        errors.push({ url, msg: String((err && err.message) || err) });
      }),
    ),
  );

  // 主动连接后再等剩余时间
  while (Date.now() - start < timeout) {
    if (connectedUrls().length > 0) {
      return { connected: true, urls: connectedUrls(), servers, errors };
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return {
    connected: connectedUrls().length > 0,
    urls: connectedUrls(),
    servers,
    errors,
  };
}

/**
 * 请求单个 chunk，失败时自动重试。
 * @param {object} publisher
 * @param {object} remoteUser
 * @param {string} chunkHash
 * @param {object} [options]
 * @param {number} [options.retries=3]
 * @param {(info:{attempt:number, err:any}) => void} [options.onAttemptFail]
 */
export async function requestChunkWithRetry(
  publisher,
  remoteUser,
  chunkHash,
  { retries = 3, onAttemptFail } = {},
) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await publisher.requestChunk(remoteUser, chunkHash);
    } catch (err) {
      lastErr = err;
      if (onAttemptFail) {
        try {
          onAttemptFail({ attempt, err });
        } catch (_) {}
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }
  throw lastErr || new Error(`获取 chunk 失败`);
}

/**
 * 把 getRTT() 结果格式化成一行简短提示；返回空字符串表示未知。
 * @param {{via?:string, url?:string, rtt?:number}|null|undefined} info
 * @returns {string}
 */
export function formatPathHint(info) {
  if (!info || !info.via) return "";
  const rttMs =
    typeof info.rtt === "number" ? `${Math.round(info.rtt)}ms` : "?";
  if (info.via === "rtc") {
    return `连接：RTC 直连 · RTT ${rttMs}`;
  }
  if (info.via === "server") {
    let host = info.url || "?";
    try {
      host = new URL(info.url).host;
    } catch (_) {}
    return `连接：中继 ${host} · RTT ${rttMs}`;
  }
  return `连接：${info.via} · RTT ${rttMs}`;
}

/**
 * 读取当前握手服务器状态。返回 { url, connected }。
 * user.server 未就绪时返回 { url: "", connected: false }。
 * @param {object} user
 */
export async function readHandshakeStatus(user) {
  if (!user || !user.server) return { url: "", connected: false };
  const connected = Array.isArray(user.server.connectedUrls)
    ? user.server.connectedUrls
    : [];
  let urls = [];
  try {
    urls = (await user.server.getServers()) || [];
  } catch (_) {}
  const url = urls[0] || connected[0] || "";
  return {
    url,
    connected: !!url && connected.includes(url),
  };
}
