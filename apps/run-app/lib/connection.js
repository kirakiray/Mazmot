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
 * 并发连上所有配置的信令服务器，然后才能 connectUser。
 *
 * `user.ready()` 只会自动连默认（通常是列表第一台）服务器，若只连一台，
 * core 后续 connectUser 时就没有多台可比，无法按 RTT 择优。这里主动并发
 * `connect()` 所有服务器（对已连 URL 会复用，无副作用），让 core 能在多台
 * 已连服务器间挑最快路径。最多等 `timeout`：全部 connect 完成（成功或失败）
 * 就提前返回，超时则不再等待，只要至少一台连上即可继续。
 *
 * @param {object} user - LocalUser
 * @param {object} [options]
 * @param {number} [options.timeout=2000] - 等待所有服务器连接的总超时（毫秒）
 * @returns {Promise<{ connected: boolean, urls: string[], servers: string[], errors: Array<{url:string, msg:string}> }>}
 */
export async function ensureServerConnected(user, { timeout = 2000 } = {}) {
  if (!user || !user.server) {
    return { connected: false, urls: [], servers: [], errors: [] };
  }
  const connectedUrls = () =>
    Array.isArray(user.server.connectedUrls) ? user.server.connectedUrls : [];

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
  // 并发连接所有服务器，单台失败只记录原因、不影响其它台。
  const allSettled = Promise.all(
    servers.map((url) =>
      user.server.connect(url).catch((err) => {
        errors.push({ url, msg: String((err && err.message) || err) });
      }),
    ),
  );

  // 全部完成或超时（取先到者）：2s 内全连上就直接下一步，超时就不再等。
  await Promise.race([
    allSettled,
    new Promise((r) => setTimeout(r, timeout)),
  ]);

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
 * 读取当前握手服务器状态。返回 { url, connected, rtt }。
 *
 * 显示逻辑：优先采用 `remoteUser.getRTT()` 给出的实际路径——若经中继，
 * `info.url` 就是 core 择优后实际使用的最快服务器，`info.rtt` 是其延迟。
 * 无 remoteUser（尚未 connectUser）或走 RTC 直连时，退回显示已连上的第一台
 * （`connectedUrls[0]`），而非配置列表的第一台（`getServers()[0]`）。
 * user.server 未就绪时返回 { url: "", connected: false, rtt: null }。
 *
 * @param {object} user - LocalUser
 * @param {object} [remoteUser] - 已连接的发布者 RemoteUser（可选）
 */
export async function readHandshakeStatus(user, remoteUser) {
  if (!user || !user.server) return { url: "", connected: false, rtt: null };
  const connected = Array.isArray(user.server.connectedUrls)
    ? user.server.connectedUrls
    : [];

  // 优先采用 getRTT 的实际最快路径（经中继时 url 即实际使用的最快服务器）。
  let rtt = null;
  try {
    const info = remoteUser && remoteUser.getRTT && remoteUser.getRTT();
    if (info && info.via === "server" && info.url) {
      return {
        url: info.url,
        connected: connected.includes(info.url) || connected.length > 0,
        rtt: typeof info.rtt === "number" ? info.rtt : null,
      };
    }
    if (info && typeof info.rtt === "number") rtt = info.rtt;
  } catch (_) {}

  let urls = [];
  try {
    urls = (await user.server.getServers()) || [];
  } catch (_) {}
  const url = connected[0] || urls[0] || "";
  return {
    url,
    connected: !!url && connected.includes(url),
    rtt,
  };
}
