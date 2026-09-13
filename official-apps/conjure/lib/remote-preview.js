// 妙造隔离预览 —— conjure 侧编排
//
// 把生成的应用文件经 noneos-core 应用间通信（remoteUser + registerService）
// 推送到隔离域（bridge，默认 http://localhost:30032），由 bridge 写入其
// 本域 VFS 后跳转运行。主域（本域）不执行 AI 生成的代码，达到数据隔离目的。
//
// 两条推送路径（自动选择）：
//  - 快路径：上一次预览的应用页还开着（页面内注入的 /bridge/inject.js 常驻代理
//    在线）→ 直连代理做增量同步，更新完代理自行 location.reload()，无感刷新；
//  - 慢路径：代理不在线（首次预览 / 应用页已关）→ 新标签打开 bridge 引导页，
//    走 hello → sync-check → 推送 → done → 跳转 的完整流程。
//
// 通信协议与可靠投递实现见 /bridge/proto.js（双端共享）。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_BRIDGE,
  SERVICE_ID_AGENT,
  USER_NAMESPACE,
  buildFileMessages,
  buildManifest,
  createReliableLink,
} from "/bridge/proto.js";

// 隔离域 origin（npm run static 同时伺服 30031-30036，30032 即第二实例）
export const BRIDGE_ORIGIN = "http://localhost:30032";

// bridge / agent 侧 userId 的持久化键（存调用方注入的 selfStore）
const BRIDGE_USER_KEY = "bridge-user-id";

// 预览窗口：独立新窗口（popup）而非新标签，便于与妙造并排对照；
// 固定窗口名复用/聚焦同一窗口
const PREVIEW_WINDOW_NAME = "mazmot-bridge-preview";
const previewWindowFeatures = () => {
  const w = Math.min(1180, Math.floor(screen.availWidth * 0.8));
  const h = Math.min(820, Math.floor(screen.availHeight * 0.85));
  const left = Math.max(0, Math.floor((screen.availWidth - w) / 2));
  const top = Math.max(0, Math.floor((screen.availHeight - h) / 4));
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
};

// 等待 bridge hello / done 的兜底超时（bridge 首次访问需安装 Core，给足时间）
const HELLO_TIMEOUT = 120_000;
const DONE_TIMEOUT = 120_000;
// 差异比对是纯本地计算，超时说明对端异常（旧版本协议等），直接回退全量
const DIFF_TIMEOUT = 30_000;
// 探测常驻代理是否在线的窗口。要覆盖「上一次更新刚触发应用页 reload」的
// 窗口期（页面重载 + inject.js 重新连服务器需要数秒），过短会误判离线
const AGENT_PROBE_TIMEOUT = 8_000;
// 探测失败后，最近 RELOAD_GRACE 内还见过对端信封（ACK 等）时判定「只是
// reload 中」，再给一轮探测宽限；超过该窗口视为真离线
const RELOAD_GRACE = 15_000;

// 模块级共享状态：同一页面多次预览复用同一 LocalUser 与服务注册
//（registerService 重复注册会抛 "already registered"，必须只注册一次）
let svcUser = null; // 已注册 conjure-preview 服务的 LocalUser
let activeLink = null; // 当前回合的可靠链路（服务 handler 里用于回 ACK）
let waiters = null; // 当前回合的 { hello, diff, done } Promise
let peerService = SERVICE_ID_BRIDGE; // 当前回合的对端服务（bridge 页 / 应用页代理）

const resetWaiters = () => {
  let helloResolve, diffResolve, doneResolve;
  const hello = new Promise((r) => {
    helloResolve = r;
  });
  const diff = new Promise((r) => {
    diffResolve = r;
  });
  const done = new Promise((r) => {
    doneResolve = r;
  });
  waiters = { hello, diff, done, helloResolve, diffResolve, doneResolve };
};

// 服务只注册一次；handler 经共享变量路由到「当前回合」的链路与等待器
let lastPeerSeenAt = 0; // 最近一次收到对端信封（含 ACK）的时间，判断「只是 reload 中」

function ensureService(user) {
  if (svcUser === user) return;
  user.registerService(SERVICE_ID_CONJURE, {
    onMessage: (data, ctx) => {
      lastPeerSeenAt = Date.now();
      if (!activeLink) return;
      const payload = activeLink.receive(data, (env) => {
        // ACK 定向回复到发送方监听的服务：hello 来自 bridge 页，
        // agent-online / 快路径的 sync-diff、done 来自应用页代理。
        // 两个都发（其一必然 no_receiver，重复 ACK 无害），避免依赖对端类型判断
        for (const appId of [SERVICE_ID_BRIDGE, SERVICE_ID_AGENT]) {
          ctx.remoteUser
            .sendToService(appId, env, { sessionId: ctx.fromSessionId })
            .catch(() => {});
        }
      });
      if (!payload || !waiters) return;
      if (payload.type === "hello" && payload.userId) {
        waiters.helloResolve({ userId: payload.userId, agent: false });
      } else if (payload.type === "agent-online" && payload.userId) {
        waiters.helloResolve({ userId: payload.userId, agent: true });
      } else if (payload.type === "sync-diff") {
        waiters.diffResolve(payload);
      } else if (payload.type === "done") {
        waiters.doneResolve(payload);
      }
    },
  });
  svcUser = user;
}

// 等待本地用户连上至少一台信令服务器（connectUser 的前置条件）
async function ensureServerConnected(user) {
  if (!user || !user.server) return;
  const connectedUrls = () =>
    Array.isArray(user.server.connectedUrls) ? user.server.connectedUrls : [];
  if (connectedUrls().length > 0) return;
  let servers = [];
  try {
    servers = (await user.server.getServers()) || [];
  } catch (_) {
    return; // 取列表失败时仍尝试连接（可能已在连接中）
  }
  await Promise.all(
    servers.map((url) => user.server.connect(url).catch(() => {})),
  );
  const deadline = Date.now() + 5000;
  while (connectedUrls().length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (connectedUrls().length === 0) {
    throw new Error("无法连接到任何信令服务器，请检查网络后重试");
  }
}

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);

const readStoredBridgeId = async (selfStore) => {
  if (!selfStore) return null;
  try {
    return (await selfStore.getItem(BRIDGE_USER_KEY)) || null;
  } catch (_) {
    return null;
  }
};

const storeBridgeId = async (selfStore, id) => {
  if (!selfStore || !id) return;
  try {
    await selfStore.setItem(BRIDGE_USER_KEY, id);
  } catch (_) {}
};

/**
 * 打开隔离预览：优先直连已打开预览页里的常驻代理（增量更新 + 自动刷新），
 * 代理不在线则新标签走 bridge 引导页完整流程。
 *
 * @param {Object} opts
 * @param {Function} opts.load 页面模块注入的 load 函数（按需加载 /nos/*）
 * @param {string} opts.appName 已规范化的应用名
 * @param {Array<{path: string, text: string}>} opts.files 应用全部文件
 * @param {Object} [opts.selfStore] 自存储空间（持久化 bridge 侧 userId）
 * @param {(text: string) => void} [opts.onStatus] 状态回调（推送中/完成/失败前的过程提示）
 */
export async function openRemotePreview({
  load,
  appName,
  files,
  selfStore = null,
  onStatus = () => {},
  bridgeOrigin = BRIDGE_ORIGIN,
}) {
  const status = (text) => {
    try {
      onStatus(text);
    } catch (_) {}
  };

  status("创建本地用户...");
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  ensureService(user);

  status("连接信令服务器...");
  await ensureServerConnected(user);

  let remote = null;
  let link = null;
  // 可靠链路：必须在收到 hello 之前创建（hello 的 ACK 依赖 receive）；
  // sendTo 惰性取 remote 与对端服务
  link = createReliableLink({
    sendTo: (env) =>
      remote
        ? remote.sendToService(peerService, env, { waitForService: 3000 })
        : Promise.resolve([{ status: "error" }]),
  });
  activeLink = link;
  resetWaiters();

  // 推送差异文件到当前对端（bridge 页 / 应用页代理共用协议）
  const pushFiles = async (diff) => {
    const missing = new Set(Array.isArray(diff.missing) ? diff.missing : []);
    const toSend = files.filter((f) => missing.has(f.path));
    // 部分命中走增量覆盖（不清目录）；一个都没命中视为全量（清目录重建）
    const wipe = toSend.length === files.length;
    if (!toSend.length) {
      status("内容无变化，预览已是最新");
      return;
    }
    status(`推送应用文件（${toSend.length}/${files.length} 个有差异）...`);
    await link.send({
      type: "app-begin",
      appName,
      fileCount: toSend.length,
      wipe,
    });
    let sent = 0;
    for (const file of toSend) {
      for (const msg of buildFileMessages(appName, file.path, file.text)) {
        await link.send(msg);
      }
      sent++;
      status(`推送文件 ${sent}/${toSend.length}：${file.path}`);
    }
    await link.send({ type: "app-end", appName });
  };

  // ---------- 快路径：直连应用页常驻代理 ----------
  // 已连接（或近期有信封往来）的代理绝不走 bridge 引导页；
  // 只有确认离线（应用页已关）才回退慢路径
  const storedId = await readStoredBridgeId(selfStore);
  if (storedId) {
    let agentLikelyOnline = true;
    try {
      // LocalUser 的在线缓存（sync / async 都兼容）
      agentLikelyOnline = await user.isRemoteUserOnline(storedId);
    } catch (_) {}
    if (agentLikelyOnline) {
      // 一次探测 = 连接 + sync-check + 等 sync-diff；
      // 探测失败但刚见过对端信封（多半是应用页 reload 中）→ 再给一轮宽限
      const attemptAgent = async (ms, label) => {
        status(label);
        peerService = SERVICE_ID_AGENT;
        if (!remote) {
          remote = await user.connectUser(storedId);
        }
        const manifest = await buildManifest(files);
        // 不 await 发送：代理离线时 link 重试耗尽前先由超时触发回退
        link.send({ type: "sync-check", appName, manifest }).catch(() => {});
        return withTimeout(waiters.diff, ms, "代理无响应");
      };
      try {
        let diff;
        try {
          diff = await attemptAgent(AGENT_PROBE_TIMEOUT, "检测已打开的预览页...");
        } catch (err) {
          if (Date.now() - lastPeerSeenAt > RELOAD_GRACE) throw err;
          // 应用页正在 reload：换新等待器再等一轮（agent-online 后即可应答）
          resetWaiters();
          diff = await attemptAgent(
            AGENT_PROBE_TIMEOUT,
            "预览页刷新中，等待代理回线...",
          );
        }
        await pushFiles(diff);
        const done = await withTimeout(
          waiters.done,
          DONE_TIMEOUT,
          "等待预览页应用更新超时",
        );
        await storeBridgeId(selfStore, storedId);
        link.dispose();
        status(`预览已更新：${done.url}`);
        return done;
      } catch (err) {
        // 代理确实离线（应用页已关 / 彻底无响应）→ 回退 bridge 引导页流程
        console.warn("[remote-preview] 快路径不可用，回退 bridge 流程：", err);
        peerService = SERVICE_ID_BRIDGE;
        remote = null;
        // 上一轮等待器可能已被消费或永不到来，换新的一组
        link.dispose();
        link = createReliableLink({
          sendTo: (env) =>
            remote
              ? remote.sendToService(peerService, env, { waitForService: 3000 })
              : Promise.resolve([{ status: "error" }]),
        });
        activeLink = link;
        resetWaiters();
      }
    }
  }

  // ---------- 慢路径：bridge 引导页完整流程 ----------
  status("打开隔离预览窗口...");
  const url = `${bridgeOrigin}/bridge/?u=${encodeURIComponent(user.userId)}`;
  const win = window.open(url, PREVIEW_WINDOW_NAME, previewWindowFeatures());
  if (!win) {
    throw new Error(
      "预览窗口被浏览器拦截：请允许本站的弹出式窗口后重试",
    );
  }

  status("等待 bridge 就绪（首次访问需安装 NoneOS Core）...");
  const hello = await withTimeout(
    waiters.hello,
    HELLO_TIMEOUT,
    "等待 bridge 就绪超时：请确认预览窗口已打开且网络可用",
  );
  const bridgeUserId = hello.userId;
  await storeBridgeId(selfStore, bridgeUserId);

  status("连接 bridge...");
  remote = await user.connectUser(bridgeUserId);

  // 增量同步：先发「路径 + sha256」清单，bridge 比对本域 VFS，只回报需要（重）传的文件；
  // 比对超时 / 异常时回退全量推送
  let diff;
  try {
    status("对比文件差异...");
    const manifest = await buildManifest(files);
    await link.send({ type: "sync-check", appName, manifest });
    diff = await withTimeout(waiters.diff, DIFF_TIMEOUT, "等待差异比对超时");
  } catch (err) {
    console.warn("[remote-preview] 增量比对失败，回退全量推送：", err);
    diff = { missing: files.map((f) => f.path) };
  }
  await pushFiles(diff);

  const done = await withTimeout(
    waiters.done,
    DONE_TIMEOUT,
    "等待 bridge 写入完成超时",
  );
  link.dispose();
  status(`隔离预览就绪：${done.url}`);
  return done;
}
