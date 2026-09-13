// 妙造隔离预览 —— conjure 侧编排
//
// 把生成的应用文件经 noneos-core 应用间通信（remoteUser + registerService）
// 推送到隔离域（bridge，origin 见下方 BRIDGE_ORIGIN：本地 localhost:30032 /
// 线上 c1.dev.mazmot.noneos.com），由 bridge 写入其
// 本域 VFS 后跳转运行。主域（本域）不执行 AI 生成的代码，达到数据隔离目的。
//
// 两条推送路径（自动选择）：
//  - 快路径：上一次预览的应用页还开着（页面内注入的 /bridge/inject.js 常驻代理
//    在线）→ 直连代理做增量同步，更新完代理自行 location.reload()，无感刷新；
//  - 慢路径：代理不在线（首次预览 / 应用页已关）→ 新标签打开 bridge 引导页，
//    走 hello → sync-check → 推送 → done → 跳转 的完整流程。
//
// 推送完成（done）后若发生了文件写入/页面跳转，还会等应用页代理回线
//（agent-online），保证调用方（预览按钮 / preview_app 工具）返回时代理
// 已可响应调试指令。
//
// 调试通道（debugPreviewCommand）：经独立 dbgLink 向应用页代理下发 dbg 指令
//（console/eval/click/dom/shot 等，见 /bridge/debug-runtime.js），结果按
// dbg-chunk/dbg-result 协议回传并在此结算。文件推送与调试指令互不干扰。
//
// 通信协议与可靠投递实现见 /bridge/proto.js（双端共享）。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_BRIDGE,
  SERVICE_ID_AGENT,
  USER_NAMESPACE,
  buildFileMessages,
  buildManifest,
  createDbgCollector,
  createReliableLink,
} from "/bridge/proto.js";

// 隔离域 origin：按运行环境自动选择——
//  - 本地开发（npm run static 同时伺服 30031-30036，30032 即第二实例）
//  - 线上部署（主站在任意非 localhost 域名，如 dev.mazmot.noneos.com）统一走
//    https://c1.dev.mazmot.noneos.com：同一份静态站的独立子域，与主站不同
//    origin，保持 AI 生成代码的隔离
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export const BRIDGE_ORIGIN = LOCAL_HOSTS.includes(location.hostname)
  ? "http://localhost:30032"
  : "https://c1.dev.mazmot.noneos.com";

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
// done 后等应用页代理回线（agent-online）的窗口：覆盖 reload / 跳转 +
// 代理重连信令服务器全程；超时不视为推送失败（预览本身已成功）
const AGENT_BACK_TIMEOUT = 30_000;
// 调试指令等待结果的默认/上限窗口（wait/eval/shot 可由 args 放宽到上限）
const DBG_TIMEOUT = 25_000;
const DBG_TIMEOUT_MAX = 120_000;

// 模块级共享状态：同一页面多次预览复用同一 LocalUser 与服务注册
//（registerService 重复注册会抛 "already registered"，必须只注册一次）
let svcUser = null; // 已注册 conjure-preview 服务的 LocalUser
let activeLink = null; // 当前回合的可靠链路（服务 handler 里用于回 ACK）
let waiters = null; // 当前回合的 { hello, diff, done } Promise
let peerService = SERVICE_ID_BRIDGE; // 当前回合的对端服务（bridge 页 / 应用页代理）
// 调试通道：与预览回合链路并存（dbgLink 常驻，activeLink 随回合创建/销毁）
let dbgLink = null; // 常驻可靠链路（只承载 dbg 指令与其结果）
let agentRemote = null; // 应用页代理的 remoteUser 句柄（dbg 指令的投递目标）
let dbgCollector = null; // dbg-chunk/dbg-result 聚合（见 proto.createDbgCollector）
const dbgWaiters = new Map(); // reqId -> { resolve, reject }
let dbgSeq = 0;

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
  // 调试链路常驻：不随预览回合创建/销毁（preview_app 推送与 dbg 指令可交错）
  dbgCollector = createDbgCollector();
  dbgLink = createReliableLink({
    sendTo: (env) =>
      agentRemote
        ? agentRemote.sendToService(SERVICE_ID_AGENT, env, {
            waitForService: 3000,
          })
        : Promise.resolve([{ status: "error" }]),
  });
  user.registerService(SERVICE_ID_CONJURE, {
    onMessage: (data, ctx) => {
      lastPeerSeenAt = Date.now();
      const reply = (env) => {
        // ACK 定向回复到发送方监听的服务：hello 来自 bridge 页，
        // agent-online / 快路径的 sync-diff、done、dbg 结果来自应用页代理。
        // 两个都发（其一必然 no_receiver，重复 ACK 无害），避免依赖对端类型判断
        for (const appId of [SERVICE_ID_BRIDGE, SERVICE_ID_AGENT]) {
          ctx.remoteUser
            .sendToService(appId, env, { sessionId: ctx.fromSessionId })
            .catch(() => {});
        }
      };
      // ACK 信封：两条链路都尝试结算（各自只 resolve 自己的 pending，无冲突）
      if (data && data.kind === "ack") {
        if (dbgLink) dbgLink.receive(data, reply);
        if (activeLink) activeLink.receive(data, reply);
        return;
      }
      // 数据信封按 payload.type 定向到一条链路（receive 内负责回 ACK + 去重）
      const type = data?.payload?.type;
      const isDbg = type === "dbg-chunk" || type === "dbg-result";
      const link = isDbg ? dbgLink : activeLink;
      if (!link) {
        try {
          reply({ msgId: data?.msgId, kind: "ack" });
        } catch (_) {}
        return;
      }
      const payload = link.receive(data, reply);
      if (!payload) return;
      if (isDbg) {
        // 调试结果：聚合分片，收齐后结算对应等待器
        let outcome = null;
        try {
          outcome = dbgCollector.push(payload);
        } catch (err) {
          outcome = { ok: false, error: err.message, meta: null };
        }
        if (outcome) {
          const w = dbgWaiters.get(payload.reqId);
          if (w) {
            dbgWaiters.delete(payload.reqId);
            w.resolve(outcome);
          }
        }
        return;
      }
      if (!waiters) return;
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

/* ---------- 代理在线判定（三信号） ----------
 * isRemoteUserOnline 只反映「本页实例已建立的连接」（remoteUsers 缓存 =
 * 主动 connectUser + 被动收到消息后自动创建）：刷新后的页面 / 新开的
 * conjure 标签页缓存为空，会把开着的预览代理误判为离线（RTC 连接是页级
 * 的，不随 userId 跨标签继承），导致快路径被跳过、预览窗口被导航回
 * bridge 引导页。因此在线判定依次用：
 *   1. 本地缓存 isRemoteUserOnline（本页连过且未断）；
 *   2. 近期对端信封宽限（lastPeerSeenAt，覆盖 reload 抖动）；
 *   3. 有界主动连接探测（connectUser：代理页开着即连上并进入缓存，
 *      连不上/超时才视为真离线）。
 */

const PROBE_CONNECT_TIMEOUT = 6_000;

// 有界主动连接：返回是否连上（超时/失败为 false；后台迟到的连接无害，会进缓存）
const probeConnect = async (user, targetId, ms = PROBE_CONNECT_TIMEOUT) => {
  try {
    await withTimeout(user.connectUser(targetId), ms, "connect timeout");
    return true;
  } catch (_) {
    return false;
  }
};

// 三信号在线判定；probe=false 时只查前两信号（watcher 轮询场景做节流探测）
async function isAgentLikelyOnline(user, targetId, { probe = true } = {}) {
  let online = false;
  try {
    online = await user.isRemoteUserOnline(targetId);
  } catch (_) {}
  if (online) return true;
  if (Date.now() - lastPeerSeenAt < 8_000) return true;
  if (probe) return await probeConnect(user, targetId);
  return false;
}

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

/* ---------- 预览窗口在线状态监听（按钮亮标） ---------- */

// watchPreviewAgent 启动后注册的即时刷新句柄（预览完成后立刻点亮/熄灭）
let refreshWatcher = null;

/**
 * 常驻监听预览窗口（应用页代理）是否在线：
 * noneos 的 remote_user_connected / disconnected 事件驱动 + 5s 轮询兜底
 *（页面隐藏时暂停轮询，回前台立即刷新）。多次调用幂等（单例）。
 *
 * @param {Object} opts
 * @param {Function} opts.load
 * @param {Object} opts.selfStore
 * @param {(online: boolean) => void} opts.onChange 在线状态变化回调
 */
export function watchPreviewAgent({ load, selfStore, onChange }) {
  if (watchPreviewAgent._started) return;
  watchPreviewAgent._started = true;
  (async () => {
    try {
      const userMod = await load("/nos/user/main.js");
      const user = await userMod.getUser(USER_NAMESPACE);
      ensureService(user); // 与 openRemotePreview 共用同一次服务注册

      let lastOnline = null;
      let targetId = null; // update() 时缓存的预览用户 id（事件回调里比对用）
      let lastProbeAt = 0; // 上次主动连接探测时间（≥30s 一次，防信令抖动）
      const update = async () => {
        targetId = (await readStoredBridgeId(selfStore)) || null;
        if (!targetId) return false;
        let online = false;
        try {
          online = await user.isRemoteUserOnline(targetId);
        } catch (_) {}
        // 短兜底（8s）：连接事件与在线缓存短暂抖动（如对端 reload 中）时
        // 不立刻熄灭；对端真正关闭后最迟 8s 熄灭
        if (!online && Date.now() - lastPeerSeenAt < 8_000) {
          online = true;
        }
        // 新标签页/刷新后缓存为空（连接是页级的）：周期性有界探测一次，
        // 代理页开着即点亮；探测建立的连接同时服务后续预览快路径
        if (!online && Date.now() - lastProbeAt > 30_000) {
          lastProbeAt = Date.now();
          online = await probeConnect(user, targetId);
        }
        if (online !== lastOnline) {
          lastOnline = online;
          try {
            onChange(online);
          } catch (_) {}
        }
        return online;
      };
      refreshWatcher = update;

      try {
        user.bind("remote_user_connected", () => update());
        user.bind("remote_user_disconnected", (e) => {
          // 精确匹配预览用户断开：清兜底时间戳，立即熄灭
          const d = e && e.detail;
          if (d && targetId && d.userId === targetId) {
            lastPeerSeenAt = 0;
          }
          setTimeout(update, 500);
        });
      } catch (_) {}
      await ensureServerConnected(user).catch(() => {});
      await update();
      // 轮询兜底：连接事件可能漏发（如代理窗口直接被杀）
      setInterval(() => {
        if (!document.hidden) update();
      }, 5000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) update();
      });
    } catch (err) {
      console.warn("[remote-preview] 预览窗口状态监听失败：", err);
    }
  })();
}

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

  // 推送差异文件到当前对端（bridge 页 / 应用页代理共用协议）；
  // 返回是否实际推送了文件（false = 零差异，对端页面不会刷新）
  const pushFiles = async (diff) => {
    const missing = new Set(Array.isArray(diff.missing) ? diff.missing : []);
    const toSend = files.filter((f) => missing.has(f.path));
    // 部分命中走增量覆盖（不清目录）；一个都没命中视为全量（清目录重建）
    const wipe = toSend.length === files.length;
    if (!toSend.length) {
      status("内容无变化，预览已是最新");
      return false;
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
    return true;
  };

  // ---------- 快路径：直连应用页常驻代理 ----------
  // 三信号在线判定（见 isAgentLikelyOnline）：连得上就绝不走 bridge 引导页；
  // 只有确认离线（应用页已关）才回退慢路径
  const storedId = await readStoredBridgeId(selfStore);
  let probedOnline = false; // 本回合内经连接探测确认过代理可达（宽限重试的依据之一）
  if (storedId) {
    let agentLikelyOnline = false;
    try {
      agentLikelyOnline = await user.isRemoteUserOnline(storedId);
    } catch (_) {}
    if (!agentLikelyOnline && Date.now() - lastPeerSeenAt < 8_000) {
      agentLikelyOnline = true; // 近期见过对端信封（reload 抖动）
    }
    if (!agentLikelyOnline) {
      // 本页没连过（新标签页/刷新后缓存为空）：主动探测一次，
      // 代理页开着即连上走快路径，连不上才视为真离线回退慢路径
      status("探测已打开的预览页...");
      agentLikelyOnline = await probeConnect(user, storedId);
      probedOnline = agentLikelyOnline;
    }
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
          // 宽限条件：近期见过对端信封（多半是应用页 reload 中），或本回合
          // 内连接探测刚成功过（新标签页里 lastPeerSeenAt 为 0，但代理几秒前
          // 确实可达）——都值得换新等待器再等一轮；真离线才回退
          if (Date.now() - lastPeerSeenAt > RELOAD_GRACE && !probedOnline) {
            throw err;
          }
          resetWaiters();
          diff = await attemptAgent(
            AGENT_PROBE_TIMEOUT,
            "预览页刷新中，等待代理回线...",
          );
        }
        const pushed = await pushFiles(diff);
        const done = await withTimeout(
          waiters.done,
          DONE_TIMEOUT,
          "等待预览页应用更新超时",
        );
        await storeBridgeId(selfStore, storedId);
        agentRemote = remote; // 调试通道复用该连接
        // 有文件写入 → 应用页即将 reload：等代理回线（agent-online）再返回，
        // 调用方（preview_app 工具）紧接着的调试指令不会扑空；零差异无刷新，跳过
        if (pushed) {
          resetWaiters();
          await withTimeout(waiters.hello, AGENT_BACK_TIMEOUT, "等待预览页刷新超时").catch(
            (err) => console.warn("[remote-preview]", err.message),
          );
        }
        link.dispose();
        refreshWatcher?.();
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
  agentRemote = remote; // 应用页代理与 bridge 页同一本地用户，连接可复用
  // 引导页正跳转成应用页：等代理回线（agent-online）再返回，调用方紧接着的
  // 调试指令不会扑空；超时不视为失败（预览本身已成功），由轮询/事件点亮按钮
  resetWaiters();
  await withTimeout(waiters.hello, AGENT_BACK_TIMEOUT, "等待预览应用页加载超时").catch(
    (err) => console.warn("[remote-preview]", err.message),
  );
  link.dispose();
  status(`隔离预览就绪：${done.url}`);
  refreshWatcher?.();
  return done;
}

/**
 * 向预览窗口（应用页代理）下发一条调试指令并等待结果。
 * 指令集见 /bridge/debug-runtime.js：status/console/text/click/type/wait/dom/eval/shot。
 * @param {Object} opts
 * @param {Function} opts.load 页面模块注入的 load 函数（按需加载 /nos/*）
 * @param {Object} [opts.selfStore] 自存储空间（读取预览侧 userId）
 * @param {string} opts.cmd 指令名
 * @param {Object} opts.args 指令参数
 * @param {number} [opts.timeoutMs] 等待结果的超时（默认 25s，上限 120s）
 * @returns {Promise<{ ok: true, result: string, meta: Object }>}
 * @throws 预览窗口未打开 / 指令投递失败 / 等待结果超时 / 对端执行失败
 */
export async function debugPreviewCommand({
  load,
  selfStore = null,
  cmd,
  args = {},
  timeoutMs,
}) {
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  ensureService(user);

  const storedId = await readStoredBridgeId(selfStore);
  if (!storedId) {
    throw new Error(
      "预览窗口未打开：请先调用 preview_app 工具把应用推送到隔离预览窗口",
    );
  }
  await ensureServerConnected(user).catch(() => {});
  // 三信号在线判定（含主动连接探测）：新标签页/刷新后本页没连过也能调通
  if (!(await isAgentLikelyOnline(user, storedId))) {
    throw new Error(
      "预览窗口不在线（可能已关闭）；请重新调用 preview_app 恢复预览",
    );
  }
  if (!agentRemote) {
    agentRemote = await user.connectUser(storedId);
  }

  const reqId = `dbg-${Date.now().toString(36)}-${++dbgSeq}`;
  let resolveFn;
  const promise = new Promise((res) => {
    resolveFn = res;
  });
  dbgWaiters.set(reqId, { resolve: resolveFn });

  try {
    // send 落定仅代表对端已收（ACK），业务结果经 dbg-chunk/dbg-result 回传结算
    await dbgLink.send({ type: "dbg", cmd, args, reqId });
  } catch (err) {
    dbgWaiters.delete(reqId);
    throw new Error(`调试指令投递失败（预览页无响应）：${err.message}`);
  }

  const ms = Math.max(5_000, Math.min(timeoutMs || DBG_TIMEOUT, DBG_TIMEOUT_MAX));
  let outcome;
  try {
    outcome = await withTimeout(promise, ms, `调试指令 ${cmd} 等待结果超时（${ms}ms）`);
  } catch (err) {
    dbgWaiters.delete(reqId);
    throw err;
  }
  if (!outcome.ok) {
    throw new Error(String(outcome.error || `调试指令 ${cmd} 执行失败`));
  }
  return outcome;
}
