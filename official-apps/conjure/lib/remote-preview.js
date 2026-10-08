// 妙造隔离预览 —— conjure 侧编排
//
// 把生成的应用文件经 noneos-core 应用间通信（remoteUser + registerService）
// 推送到隔离域（bridge，origin 见下方 BRIDGE_ORIGIN：本地 localhost:30032 /
// 线上 c1.dev.mazmot.noneos.com），由 bridge 写入其
// 本域 VFS 后跳转运行。主域（本域）不执行 AI 生成的代码，达到数据隔离目的。
//
// 多窗口（最多 MAX_PREVIEW_WINDOWS 个）：预览窗口可以是本机新开的 popup，
// 也可以是手机扫码打开 bridge 引导页（/bridge/?u=<conjure userId>&app=<名>）
// 反连上来的远程设备。所有窗口经 inject.js 的 announce 心跳注册进窗口注册表
//（key = 对端 userId + 会话 sessionId，同机多窗口共享 userId 只能靠 sessionId
// 区分），注册表驱动：下拉气泡的窗口清单 / 扫码自动推送 / 调试指令定向投递
//（sendToService 带 sessionId，不广播到对端其它窗口）。
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
// dbg-chunk/dbg-result 协议回传并在此结算；缺省投递给最近心跳的在线窗口，
// 传 winId 可定向指定。文件推送与调试指令互不干扰。
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
  enableServerAutoReconnect,
  ensureServerConnected as ensureSignaling,
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
// 槽位窗口名复用/聚焦同一窗口（新开窗口用不同槽位名开新 popup）
const PREVIEW_WINDOW_NAME = "mazmot-bridge-preview";
const previewWindowFeatures = () => {
  const w = Math.min(1180, Math.floor(screen.availWidth * 0.8));
  const h = Math.min(820, Math.floor(screen.availHeight * 0.85));
  const left = Math.max(0, Math.floor((screen.availWidth - w) / 2));
  const top = Math.max(0, Math.floor((screen.availHeight - h) / 4));
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
};

// 弹窗被浏览器拦截的专用错误：window.open 返回 null（非用户手势 + 本站未放行，
// 浏览器默认如此）。preview 工具按 code 识别后给模型返回「指导用户放行 →
// 等确认 → check-popup 验证 → 重推」的行动指引，而不是普通失败文案（防止
// 模型在窗口放行前原地重试烧回合）。
export const POPUP_BLOCKED = "POPUP_BLOCKED";
export const popupBlockedError = () =>
  Object.assign(
    new Error(
      "预览窗口被浏览器拦截：浏览器默认禁止页面自动打开新窗口，需要用户放行后重试",
    ),
    { code: POPUP_BLOCKED },
  );

/**
 * 探测本站当前是否允许自动打开新窗口（弹窗未被拦截）：
 * 试开一个空白小窗并立即关闭。已放行时会闪现一个空白小窗，属预期；
 * 未放行时浏览器静默拦截，window.open 返回 null（不弹任何提示）。
 * @returns {{ allowed: boolean }}
 */
export function checkPopupAllowed() {
  let win = null;
  try {
    win = window.open(
      "about:blank",
      "_blank",
      "popup=yes,width=240,height=160,left=48,top=48",
    );
  } catch (_) {}
  if (win) {
    try {
      win.close();
    } catch (_) {}
    return { allowed: true };
  }
  return { allowed: false };
}

// ---------- 预览窗口注册表（多窗口） ----------

// 同时在线的预览窗口上限；超出后新窗口加入会被拒绝（对端收到 preview-full）
export const MAX_PREVIEW_WINDOWS = 10;
// 超过该时长没有 announce 心跳即视为离线（心跳 15s 一次，容忍 2 次丢包）
const WINDOW_OFFLINE_MS = 45_000;
// 离线超过该时长的注册表条目直接清除
const WINDOW_GC_MS = 30 * 60_000;

// key（userId|sessionId）→ { key, userId, sessionId, app, url, ua, device, bootAt, lastSeen }
const winRegistry = new Map();
// 本会话开过的预览窗口槽位（slot → Window 句柄），新开窗口时找空闲槽位
const previewSlots = new Map();
// 预览事件钩子（builder-store 接线）：onBridgeHello = 扫码/新窗口 hello 时自动推当前应用；
// onWindowsChange = 注册表变化（下拉气泡刷新）
const previewHooks = {};
export const setPreviewHooks = (hooks) => Object.assign(previewHooks, hooks || {});

/** 从 UA 粗提「系统 · 浏览器」短标签（窗口列表展示用） */
export function describeDevice(ua) {
  const s = String(ua || "");
  const os = /iPhone/i.test(s)
    ? "iPhone"
    : /iPad/i.test(s)
      ? "iPad"
      : /Android/i.test(s)
        ? "Android"
        : /Macintosh|Mac OS X/i.test(s)
          ? "macOS"
          : /Windows/i.test(s)
            ? "Windows"
            : /Linux/i.test(s)
              ? "Linux"
              : "未知设备";
  const browser = /Edg\//i.test(s)
    ? "Edge"
    : /OPR\//i.test(s)
      ? "Opera"
      : /Firefox\//i.test(s)
        ? "Firefox"
        : /Chrome\//i.test(s)
          ? "Chrome"
          : /Safari/i.test(s)
            ? "Safari"
            : "";
  return browser ? `${os} · ${browser}` : os;
}

const isWindowFresh = (entry, now = Date.now()) =>
  now - entry.lastSeen < WINDOW_OFFLINE_MS;

/** 清理过期条目（离线超 WINDOW_GC_MS 的移除），返回是否有过移除 */
function pruneWindows() {
  const now = Date.now();
  let removed = false;
  for (const [key, entry] of winRegistry) {
    if (now - entry.lastSeen > WINDOW_GC_MS) {
      winRegistry.delete(key);
      removed = true;
    }
  }
  return removed;
}

const freshWindowCount = () => {
  pruneWindows();
  const now = Date.now();
  let n = 0;
  for (const entry of winRegistry.values()) if (isWindowFresh(entry, now)) n++;
  return n;
};

/**
 * 预览窗口清单快照（按最近心跳倒序 = 最活跃的在前）。UI 下拉气泡与
 * preview 工具 action=windows 共用；online 按心跳新鲜度判定。
 */
export function listPreviewWindows() {
  pruneWindows();
  return [...winRegistry.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((e) => ({
      id: e.key,
      app: e.app,
      device: e.device,
      url: e.url,
      online: isWindowFresh(e),
      lastSeen: e.lastSeen,
    }));
}

// 控制消息（announce/hello/agent-online）去重：这些消息不再经回合链路的
// receive 去重，手动 ACK 后对端重发靠这里挡
const seenControl = new Map();
const isDupControl = (msgId) => {
  if (!msgId) return false;
  const now = Date.now();
  for (const [id, ts] of seenControl) {
    if (now - ts > 60_000) seenControl.delete(id);
  }
  if (seenControl.has(msgId)) return true;
  seenControl.set(msgId, now);
  return false;
};

// 注册一个预览窗口（announce 心跳 / agent 首次上报）。超过上限时向对端
// 回 preview-full（尽力投递，双服务都发，与 ACK 定向回复同款 spray）并不注册
function upsertWindowEntry(ctx, payload) {
  const key = `${ctx.fromUserId}|${ctx.fromSessionId}`;
  const prev = winRegistry.get(key);
  if (!prev && freshWindowCount() >= MAX_PREVIEW_WINDOWS) {
    const env = {
      msgId: `refuse-${Date.now().toString(36)}-${++dbgSeq}`,
      kind: "data",
      payload: { type: "preview-full", max: MAX_PREVIEW_WINDOWS },
    };
    for (const appId of [SERVICE_ID_BRIDGE, SERVICE_ID_AGENT]) {
      ctx.remoteUser
        .sendToService(appId, env, { sessionId: ctx.fromSessionId })
        .catch(() => {});
    }
    return false;
  }
  const now = Date.now();
  winRegistry.set(key, {
    key,
    userId: ctx.fromUserId,
    sessionId: ctx.fromSessionId,
    app: payload.appName || prev?.app || "",
    url: payload.url || prev?.url || "",
    ua: payload.ua || prev?.ua || "",
    device: describeDevice(payload.ua || prev?.ua),
    bootAt: prev?.bootAt || now,
    lastSeen: now,
  });
  try {
    previewHooks.onWindowsChange?.();
  } catch (_) {}
  return true;
}

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
// done 后等应用页代理回线（agent-online）的窗口：健康时代理 1~2s 内回线，
// 覆盖 reload / 跳转 + 重连信令的常规耗时即可；超时不视为推送失败（预览
// 本身已成功），也不值得为此烧几十秒——调试指令自带超时与重试
const AGENT_BACK_TIMEOUT = 8_000;
// 调试指令等待结果的默认/上限窗口（wait/eval/shot 可由 args 放宽到上限）
const DBG_TIMEOUT = 25_000;
const DBG_TIMEOUT_MAX = 120_000;

// 模块级共享状态：同一页面多次预览复用同一 LocalUser 与服务注册
//（registerService 重复注册会抛 "already registered"，必须只注册一次）
let svcUser = null; // 已注册 conjure-preview 服务的 LocalUser
let activeLink = null; // 当前回合的可靠链路（服务 handler 里用于回 ACK）
let waiters = null; // 当前回合的 { hello, diff, done, expectedPeer } Promise
let peerService = SERVICE_ID_BRIDGE; // 当前回合的对端服务（bridge 页 / 应用页代理）
// 调试通道：与预览回合链路并存（dbgLink 常驻，activeLink 随回合创建/销毁）
let dbgLink = null; // 常驻可靠链路（只承载 dbg 指令与其结果）
const agentRemotes = new Map(); // userId → remoteUser（dbg 指令的投递目标，按对端缓存）
let dbgCollector = null; // dbg-chunk/dbg-result 聚合（见 proto.createDbgCollector）
const dbgWaiters = new Map(); // reqId -> { resolve, reject }
let dbgSeq = 0;
// 定向调试：dbgLink.sendTo 构建信封时按 msgId 记下当时的投递目标（重发同目标）；
// dbgNextTarget 由 debugPreviewCommand 在每次 send 前设置
let dbgNextTarget = null; // { userId, sessionId } | null（null = 广播到对端全部窗口）
const dbgMsgTargets = new Map(); // msgId -> target

const resetWaiters = (expectedPeer = null) => {
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
  // expectedPeer：本轮等待的对端 userId。多窗口下 hello/agent-online 可能来自
  // 任何窗口（扫码设备反连、其他窗口 reload 回线），只有匹配对端才结算，
  // 防止别的窗口「冒领」本轮等待（sync-diff/done 由串行推送保证不串台）
  waiters = { hello, diff, done, helloResolve, diffResolve, doneResolve, expectedPeer };
};

// 服务只注册一次；handler 经共享变量路由到「当前回合」的链路与等待器
let lastPeerSeenAt = 0; // 最近一次收到对端信封（含 ACK）的时间，判断「只是 reload 中」

function ensureService(user) {
  if (svcUser === user) return;
  // 调试链路常驻：不随预览回合创建/销毁（preview_app 推送与 dbg 指令可交错）。
  // 投递目标按 msgId 记录（重发同目标）：debugPreviewCommand 每次发送前设置
  // dbgNextTarget；sessionId 缺省 = 广播到该对端 userId 的全部窗口（兼容旧窗口）
  dbgCollector = createDbgCollector();
  dbgLink = createReliableLink({
    sendTo: async (env) => {
      if (!dbgMsgTargets.has(env.msgId)) {
        dbgMsgTargets.set(env.msgId, dbgNextTarget);
        if (dbgMsgTargets.size > 128) {
          const cutoff = Date.now() - 10 * 60_000;
          for (const [id, t] of dbgMsgTargets) {
            if (!t || !t.recordedAt || t.recordedAt < cutoff) dbgMsgTargets.delete(id);
          }
        }
      }
      const target = dbgMsgTargets.get(env.msgId);
      if (target) target.recordedAt = Date.now();
      const remote = await ensureAgentRemote(user, target?.userId);
      if (!remote) return [{ status: "error" }];
      const opts = { waitForService: 3000 };
      if (target?.sessionId) opts.sessionId = target.sessionId;
      return remote.sendToService(SERVICE_ID_AGENT, env, opts);
    },
    // 中继通道掉线（offline）时主动重连，别让重试窗口干等耗尽
    onOffline: (info) => ensureServerConnected(user, info),
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
      const type = data?.payload?.type;
      // 窗口注册表类控制消息：不依赖回合链路（扫码 hello / announce 心跳可能在
      // 任意时刻到达，activeLink 多为 null）。手动去重 + ACK；hello 触发
      // onBridgeHello 钩子（builder-store 据此自动推送当前应用给扫码设备）；
      // hello/agent-online 仅在等待同一对端时结算回合等待器（防别的窗口冒领）
      if (type === "announce" || type === "hello" || type === "agent-online") {
        if (!isDupControl(data?.msgId)) {
          if (type === "announce") {
            upsertWindowEntry(ctx, data.payload || {});
          }
          const fromPeer = data.payload?.userId;
          if (type === "hello" && fromPeer) {
            try {
              previewHooks.onBridgeHello?.(fromPeer, data.payload.app || "");
            } catch (err) {
              console.warn("[remote-preview] onBridgeHello 钩子失败：", err);
            }
          }
          if (
            waiters &&
            fromPeer &&
            (type === "hello" || type === "agent-online") &&
            (!waiters.expectedPeer || waiters.expectedPeer === fromPeer)
          ) {
            waiters.helloResolve({ userId: fromPeer, agent: type === "agent-online" });
          }
        }
        try {
          reply({ msgId: data?.msgId, kind: "ack" });
        } catch (_) {}
        return;
      }
      // 数据信封按 payload.type 定向到一条链路（receive 内负责回 ACK + 去重）
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
      if (payload.type === "sync-diff") {
        waiters.diffResolve(payload);
      } else if (payload.type === "done") {
        waiters.doneResolve(payload);
      }
    },
  });
  svcUser = user;
}

/** 取（必要时建立）到指定对端 userId 的连接；userId 为空回退最近一次连接 */
async function ensureAgentRemote(user, userId) {
  if (!userId) {
    return agentRemotes.get(lastAgentRemoteId) || null;
  }
  let remote = agentRemotes.get(userId);
  if (remote) return remote;
  remote = await user.connectUser(userId);
  agentRemotes.set(userId, remote);
  lastAgentRemoteId = userId;
  return remote;
}
let lastAgentRemoteId = null;

// 等待本地用户连上信令服务器（connectUser 的前置条件）。
// 共享实现会把双端收敛到同一台（排序首位的）中继，避免跨区域转发大帧丢失；
// reason="capped"（发送命令悬挂，连接疑似僵尸）时硬重置连接
async function ensureServerConnected(user, info) {
  const ok = await ensureSignaling(user, {
    hard: info?.reason === "capped",
  });
  if (!ok) throw new Error("无法连接到任何信令服务器，请检查网络后重试");
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

// 代理服务存在性探测（快路径 sync-check 前的门槛）：connectUser 只证明
// 「对端用户可达」，证明不了「对端注册了 conjure-agent」——对端开着的可能
// 是 bridge 引导页（只注册 conjure-bridge）。此前这种场景要等 sync-check
// 无 ACK 烧满 AGENT_PROBE_TIMEOUT（每次尝试 no_receiver 3s + 重试间隔）才
// 回退，预览固定慢 ~10s。直接 sendToService 一条 ping（ receiver 按未知
// 类型忽略，无副作用），no_receiver 即代理不在，快速回退；reload 窗口代理
// 重新注册需一两秒，给 2.5s 有界宽限
const AGENT_SERVICE_PING_TIMEOUT = 2_500;
const probeAgentService = async (remote) => {
  const deadline = Date.now() + AGENT_SERVICE_PING_TIMEOUT;
  for (;;) {
    const res = await remote
      .sendToService(
        SERVICE_ID_AGENT,
        { msgId: `ping-${Date.now()}`, kind: "data", payload: { type: "ping" } },
        { waitForService: 1200 },
      )
      .catch(() => null);
    if (res?.some?.((r) => r && r.status === "ok")) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
};

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

// 主预览窗口对端 userId（openRemotePreview 推送后即写入）。多窗口同步时
// 用它排除刚推完的主窗口（fast path = 该对端；slow path = 新开的引导窗口）
export const getPrimaryBridgeId = readStoredBridgeId;

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
      enableServerAutoReconnect(user); // 掉线自动重连（默认关闭）
      ensureService(user); // 与 openRemotePreview 共用同一次服务注册

      let lastOnline = null;
      let lastWindowCount = -1;
      let targetId = null; // update() 时缓存的预览用户 id（事件回调里比对用）
      let lastProbeAt = 0; // 上次主动连接探测时间（≥30s 一次，防信令抖动）
      const update = async () => {
        // 多窗口判定：注册表里有心跳新鲜的窗口（announce 15s/次）即在线；
        // 窗口数变化时刷新 UI 清单（离线抖动由 pruneWindows + 轮询兜底）
        const count = freshWindowCount();
        if (count !== lastWindowCount) {
          lastWindowCount = count;
          try {
            previewHooks.onWindowsChange?.();
          } catch (_) {}
        }
        if (count > 0) {
          if (lastOnline !== true) {
            lastOnline = true;
            try {
              onChange(true);
            } catch (_) {}
          }
          return true;
        }
        targetId = (await readStoredBridgeId(selfStore)) || null;
        if (!targetId) {
          if (lastOnline !== false) {
            lastOnline = false;
            try {
              onChange(false);
            } catch (_) {}
          }
          return false;
        }
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
 * @param {({done: number, total: number}) => void} [opts.onProgress] 结构化进度
 *   （清单比对 / 文件推送的 done/total，供 UI 画进度条；阶段文本走 onStatus）
 */
export async function openRemotePreview({
  load,
  appName,
  files,
  selfStore = null,
  onStatus = () => {},
  onProgress = () => {},
  bridgeOrigin = BRIDGE_ORIGIN,
}) {
  const status = (text) => {
    try {
      onStatus(text);
    } catch (_) {}
  };
  const report = (done, total) => {
    try {
      onProgress({ done, total });
    } catch (_) {}
  };

  status("创建本地用户...");
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  enableServerAutoReconnect(user); // 掉线自动重连（默认关闭）
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
    // 中继通道掉线（offline）时主动重连，别让重试窗口干等耗尽
    onOffline: (info) => ensureServerConnected(user, info),
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
    report(0, toSend.length);
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
      report(sent, toSend.length);
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
    resetWaiters(storedId); // 本轮只认该对端的 hello/agent-online，防其他窗口冒领
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
      // 一次探测 = 连接 + 服务存在性 ping + sync-check + 等 sync-diff；
      // 探测失败但刚见过对端信封（多半是应用页 reload 中）→ 再给一轮宽限
      const attemptAgent = async (ms, label) => {
        status(label);
        peerService = SERVICE_ID_AGENT;
        remote = await ensureAgentRemote(user, storedId);
        // 服务不在（no_receiver，对端是 bridge 引导页 / 应用页已关）立即
        // 失败回退，别等 sync-check 烧满重试窗口
        if (!(await probeAgentService(remote))) {
          throw Object.assign(new Error("预览页代理服务不在线"), {
            code: "AGENT_SERVICE_OFFLINE",
          });
        }
        const manifest = await buildManifest(files, (d, t) => report(d, t));
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
          // 确实可达）——都值得换新等待器再等一轮；真离线才回退。
          // 例外：服务 ping 的 no_receiver 是决定性失败（probeAgentService
          // 内部已含 2.5s 宽限，且 announce 心跳只出自应用页代理）——仅当
          // 近期见过代理信封（reload 中）才再试一轮；「连接可达」（probedOnline）
          // 不算数，对端可能只是 bridge 引导页
          const seenAgentRecently = Date.now() - lastPeerSeenAt <= RELOAD_GRACE;
          const decisive = err?.code === "AGENT_SERVICE_OFFLINE";
          const grace = decisive
            ? seenAgentRecently
            : seenAgentRecently || probedOnline;
          if (!grace) {
            throw err;
          }
          resetWaiters(storedId);
          diff = await attemptAgent(
            AGENT_PROBE_TIMEOUT,
            "预览页刷新中，等待代理回线...",
          );
        }
        const pushed = await pushFiles(diff);
        // 零差异：代理对 sync-check 会自行补发 done，但无需依赖——没有写入
        // 就没有「等待更新」可言，直接合成结果（done 缺失时白等 120s，实测踩坑）
        const done = pushed
          ? await withTimeout(
              waiters.done,
              DONE_TIMEOUT,
              "等待预览页应用更新超时",
            )
          : { url: `/$ai-apps/${appName}/client/index.html`, appName, agentOnline: true };
        await storeBridgeId(selfStore, storedId);
        agentRemotes.set(storedId, remote); // 调试通道复用该连接
        lastAgentRemoteId = storedId;
        // 有文件写入 → 应用页即将 reload：等代理回线（agent-online）再返回，
        // 调用方（preview_app 工具）紧接着的调试指令不会扑空；零差异无刷新，
        // 代理仍在线。回线结果记进 done.agentOnline（false = 工具文案提示稍候重试）
        let agentBack = { agent: !pushed };
        if (pushed) {
          resetWaiters(storedId);
          agentBack = await withTimeout(
            waiters.hello,
            AGENT_BACK_TIMEOUT,
            "等待预览页刷新超时",
          ).catch((err) => {
            console.warn("[remote-preview]", err.message);
            return null;
          });
        }
        done.agentOnline = agentBack?.agent === true;
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
          onOffline: (info) => ensureServerConnected(user, info),
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
    throw popupBlockedError();
  }
  previewSlots.set(1, win); // 槽位 1 = 主预览窗口（新开窗口从槽位 2 起找空闲）

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
    // 阶段通知：bridge 引导页在 sync-check 到达前只能干等，先告知「正在
    // 比对」让它的等待态动起来（引导页 best-effort 展示，失败不影响推送）
    link.send({ type: "push-stage", stage: "diff" }).catch(() => {});
    const manifest = await buildManifest(files, (d, t) => report(d, t));
    await link.send({ type: "sync-check", appName, manifest });
    diff = await withTimeout(waiters.diff, DIFF_TIMEOUT, "等待差异比对超时");
  } catch (err) {
    console.warn("[remote-preview] 增量比对失败，回退全量推送：", err);
    diff = { missing: files.map((f) => f.path) };
  }
  const pushed = await pushFiles(diff);

  // bridge 引导页只在收到 app-end（有实际写入）后回报 done：零差异时推送
  // 侧不发任何消息，这里必须跳过 done 等待，否则白等 DONE_TIMEOUT
  // （bridge VFS 已有同内容副本，预览本身就是最新的）
  const done = pushed
    ? await withTimeout(
        waiters.done,
        DONE_TIMEOUT,
        "等待 bridge 写入完成超时",
      )
    : {
        url: `/$ai-apps/${appName}/client/index.html`,
        appName,
        agentOnline: false, // 引导页未跳转，应用页代理不在线
      };
  agentRemotes.set(bridgeUserId, remote); // 应用页代理与 bridge 页同一本地用户，连接可复用
  lastAgentRemoteId = bridgeUserId;
  // 引导页正跳转成应用页：等代理回线（agent-online）再返回，调用方紧接着的
  // 调试指令不会扑空；超时不视为失败（预览本身已成功），由轮询/事件点亮按钮，
  // 结果记进 done.agentOnline 供工具文案提示
  resetWaiters();
  let agentBack = null;
  if (pushed) {
    agentBack = await withTimeout(
      waiters.hello,
      AGENT_BACK_TIMEOUT,
      "等待预览应用页加载超时",
    ).catch((err) => {
      console.warn("[remote-preview]", err.message);
      return null;
    });
  }
  done.agentOnline = agentBack?.agent === true;
  link.dispose();
  status(`隔离预览就绪：${done.url}`);
  refreshWatcher?.();
  return done;
}

/* ---------- 多窗口：串行推送队列 + 按对端推送 ---------- */

// 预览回合的 waiters/activeLink 是模块级单例，推送必须串行（按钮主流程由
// builder-store 的 previewBusy 防重入；扫码 hello 触发的自动推送经此队列排队）
let pushChain = Promise.resolve();
const enqueuePush = (fn) => {
  const run = pushChain.then(fn, fn);
  pushChain = run.catch(() => {});
  return run;
};

// 推送一轮文件到指定对端：先按常驻代理试探（已开窗口，增量 + 自动刷新），
// 无响应再按 bridge 引导页流程（新窗口 / 扫码设备）。返回 done（含运行 url）
async function pushRound(user, peerId, { appName, files, onStatus = () => {}, onProgress = () => {} }) {
  const status = (text) => {
    try {
      onStatus(text);
    } catch (_) {}
  };
  const report = (done, total) => {
    try {
      onProgress({ done, total });
    } catch (_) {}
  };
  let remote = null;
  let link = null;
  const mkLink = () => {
    link = createReliableLink({
      sendTo: (env) =>
        remote
          ? remote.sendToService(peerService, env, { waitForService: 3000 })
          : Promise.resolve([{ status: "error" }]),
      onOffline: (info) => ensureServerConnected(user, info),
    });
    activeLink = link;
  };
  const pushFiles = async (diff) => {
    const missing = new Set(Array.isArray(diff.missing) ? diff.missing : []);
    const toSend = files.filter((f) => missing.has(f.path));
    const wipe = toSend.length === files.length;
    if (!toSend.length) return false;
    status(`推送应用文件（${toSend.length}/${files.length} 个有差异）...`);
    report(0, toSend.length);
    await link.send({ type: "app-begin", appName, fileCount: toSend.length, wipe });
    let sent = 0;
    for (const file of toSend) {
      for (const msg of buildFileMessages(appName, file.path, file.text)) {
        await link.send(msg);
      }
      sent++;
      status(`推送文件 ${sent}/${toSend.length}：${file.path}`);
      report(sent, toSend.length);
    }
    await link.send({ type: "app-end", appName });
    return true;
  };

  mkLink();
  resetWaiters(peerId);
  // 先按常驻代理试探：连不上 / 无响应 → 回退 bridge 引导页流程
  try {
    status("检测预览窗口...");
    peerService = SERVICE_ID_AGENT;
    remote = await withTimeout(user.connectUser(peerId), 8_000, "连接超时");
    agentRemotes.set(peerId, remote);
    lastAgentRemoteId = peerId;
    // 服务存在性门槛：对端可达 ≠ 代理在（可能是 bridge 引导页），no_receiver
    // 立即回退 bridge 流程，不等 sync-check 烧满重试窗口
    if (!(await probeAgentService(remote))) {
      throw new Error("预览页代理服务不在线");
    }
    const manifest = await buildManifest(files, (d, t) => report(d, t));
    link.send({ type: "sync-check", appName, manifest }).catch(() => {});
    const diff = await withTimeout(waiters.diff, AGENT_PROBE_TIMEOUT, "代理无响应");
    const pushed = await pushFiles(diff);
    const done = await withTimeout(
      waiters.done,
      DONE_TIMEOUT,
      "等待预览页应用更新超时",
    );
    if (pushed) {
      resetWaiters(peerId);
      await withTimeout(waiters.hello, AGENT_BACK_TIMEOUT, "等待预览页刷新超时").catch(
        () => {},
      );
    }
    link.dispose();
    return done;
  } catch (err) {
    console.warn(`[remote-preview] 对端 ${peerId} 代理试探失败，回退 bridge 流程：`, err);
  }
  // bridge 引导页流程（全新窗口 / 扫码设备：hello 已带 appId 意图，文件全量或增量）
  link?.dispose();
  remote = null;
  mkLink();
  resetWaiters(peerId);
  peerService = SERVICE_ID_BRIDGE;
  status("连接预览窗口...");
  remote = await withTimeout(user.connectUser(peerId), 8_000, "连接超时");
  agentRemotes.set(peerId, remote);
  lastAgentRemoteId = peerId;
  let diff;
  try {
    status("对比文件差异...");
    // 阶段通知：新窗口 / 扫码设备的引导页在此阶段只能干等，先告知「正在
    // 比对」让它的等待态动起来（best-effort，失败不影响推送）
    link.send({ type: "push-stage", stage: "diff" }).catch(() => {});
    const manifest = await buildManifest(files, (d, t) => report(d, t));
    await link.send({ type: "sync-check", appName, manifest });
    diff = await withTimeout(waiters.diff, DIFF_TIMEOUT, "等待差异比对超时");
  } catch (_) {
    diff = { missing: files.map((f) => f.path) };
  }
  await pushFiles(diff);
  const done = await withTimeout(waiters.done, DONE_TIMEOUT, "等待 bridge 写入完成超时");
  link.dispose();
  return done;
}

/**
 * 把应用文件推送到多个已在线的预览窗口（串行逐个，结果逐对端汇报）。
 * 供「更新全部窗口」与扫码 hello 自动推送使用；失败不中断其余窗口。
 * @returns {Promise<Array<{peerId: string, ok: boolean, url?: string, error?: string}>>}
 */
export async function syncPreviewPeers({
  load,
  appName,
  files,
  peerIds,
  onStatus = () => {},
  onProgress = () => {},
}) {
  if (!Array.isArray(peerIds) || !peerIds.length) return [];
  return enqueuePush(async () => {
    const userMod = await load("/nos/user/main.js");
    const user = await userMod.getUser(USER_NAMESPACE);
    enableServerAutoReconnect(user);
    ensureService(user);
    await ensureServerConnected(user).catch(() => {});
    const results = [];
    for (const peerId of peerIds) {
      try {
        const done = await pushRound(user, peerId, {
          appName,
          files,
          onStatus,
          onProgress,
        });
        results.push({ peerId, ok: true, url: done?.url || "" });
      } catch (err) {
        results.push({ peerId, ok: false, error: err.message });
      }
    }
    return results;
  });
}

/**
 * 新开一个隔离预览窗口（popup）：打开 bridge 引导页（带当前应用名），
 * 引导页 hello 后由 builder-store 的 onBridgeHello 钩子自动推送应用文件。
 * 窗口上限 MAX_PREVIEW_WINDOWS；槽位窗口名避免 window.open 复用同名旧窗。
 */
export async function openPreviewWindow({
  load,
  app = "",
  bridgeOrigin = BRIDGE_ORIGIN,
}) {
  if (freshWindowCount() >= MAX_PREVIEW_WINDOWS) {
    throw new Error(
      `预览窗口已达上限（${MAX_PREVIEW_WINDOWS} 个），请先关闭部分预览窗口`,
    );
  }
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  enableServerAutoReconnect(user);
  ensureService(user);
  // 清理已关闭的槽位；主窗口槽位（1）可能由旧流程开过而不在表里，
  // 此时复用其窗口名只会把旧窗导航到引导页再推当前应用，无实质危害
  for (const [n, win] of previewSlots) {
    if (win?.closed) previewSlots.delete(n);
  }
  let slot = 1;
  while (previewSlots.has(slot)) slot++;
  const url =
    `${bridgeOrigin}/bridge/?u=${encodeURIComponent(user.userId)}` +
    (app ? `&app=${encodeURIComponent(app)}` : "");
  const win = window.open(url, slotWindowName(slot), previewWindowFeatures());
  if (!win) {
    throw popupBlockedError();
  }
  previewSlots.set(slot, win);
  return { slot, url };
}

const slotWindowName = (slot) =>
  slot === 1 ? PREVIEW_WINDOW_NAME : `${PREVIEW_WINDOW_NAME}-${slot}`;

/**
 * conjure 侧预览身份（userId）：二维码内容 /bridge/?u=<此值> 的信任根。
 * 预览窗口（任意设备）连上该用户即被视为可信调试对端（消息层另有发送方校验）。
 */
export async function getPreviewIdentity({ load }) {
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  ensureService(user);
  return { userId: user.userId };
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
 * @param {string} [opts.winId] 目标窗口（listPreviewWindows 的 id，即 userId|sessionId）；
 *   缺省投递给最近心跳的在线窗口；窗口注册表为空时回退存储的 bridge userId（广播）
 * @returns {Promise<{ ok: true, result: string, meta: Object }>}
 * @throws 预览窗口未打开 / 指令投递失败 / 等待结果超时 / 对端执行失败
 */
export async function debugPreviewCommand({
  load,
  selfStore = null,
  cmd,
  args = {},
  timeoutMs,
  winId = null,
}) {
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);
  enableServerAutoReconnect(user); // 掉线自动重连（默认关闭）
  ensureService(user);
  await ensureServerConnected(user).catch(() => {});

  // 解析投递目标：显式 winId → 注册表精确匹配；缺省 → 最近心跳的在线窗口；
  // 注册表为空（旧版窗口无 announce 心跳）→ 回退存储的 bridge userId 广播
  let target = null;
  pruneWindows();
  if (winId) {
    const hit = winRegistry.get(winId);
    if (!hit || !isWindowFresh(hit)) {
      throw new Error(
        `预览窗口不在线或不存在：${winId}（可用 preview 工具 action=windows 查看在线窗口）`,
      );
    }
    target = { userId: hit.userId, sessionId: hit.sessionId };
  } else {
    const fresh = listPreviewWindows().filter((w) => w.online);
    if (fresh.length) {
      const newest = winRegistry.get(fresh[0].id);
      target = { userId: newest.userId, sessionId: newest.sessionId };
    } else {
      const storedId = await readStoredBridgeId(selfStore);
      if (!storedId) {
        throw new Error(
          "预览窗口未打开：请先调用 preview 工具（action=app）推送应用",
        );
      }
      if (!(await isAgentLikelyOnline(user, storedId))) {
        throw new Error(
          "预览窗口不在线（可能已关闭）；请重新推送预览恢复",
        );
      }
      target = { userId: storedId, sessionId: null };
    }
  }

  const reqId = `dbg-${Date.now().toString(36)}-${++dbgSeq}`;
  let resolveFn;
  const promise = new Promise((res) => {
    resolveFn = res;
  });
  dbgWaiters.set(reqId, { resolve: resolveFn });

  try {
    // send 落定仅代表对端已收（ACK），业务结果经 dbg-chunk/dbg-result 回传结算；
    // dbgNextTarget 在 send 前设置，dbgLink.sendTo 构建信封时按 msgId 记档（重发同目标）
    dbgNextTarget = target;
    await dbgLink.send({ type: "dbg", cmd, args, reqId });
  } catch (err) {
    dbgNextTarget = null;
    dbgWaiters.delete(reqId);
    throw new Error(`调试指令投递失败（预览页无响应）：${err.message}`);
  } finally {
    dbgNextTarget = null;
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
