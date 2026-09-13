// Conjure 隔离预览 —— 应用页常驻代理
//
// 由 receiver.js 在写入 index.html 时注入（<script src="/bridge/inject.js"
// data-conjure-id="...">，见 injectAgent）。本脚本运行在 30032 隔离域的
// 预览应用页面内，注册 conjure-agent 服务：
//   - 页面加载即 connectUser(conjure) 并上报 agent-online；
//   - 后续妙造再次点「预览应用」时与本代理直连：sync-check 增量比对 →
//     只接收差异文件（经 receiver 写入本域 VFS）→ app-end 后回报 done 并
//     location.reload() 应用新代码，无需重开 bridge 引导页；
//   - 妙造的调试工具经 dbg 指令远程调试本页（console/eval/click/dom 快照/
//     截图等，见 debug-runtime.js），结果按 proto.js 的 dbg-chunk/dbg-result
//     协议回传；
//   - 页面内常驻可拖拽的「隔离预览」胶囊（见 createBubble），标识本应用
//     经隔离预览（debug）模式运行，并联动代理状态；胶囊右侧「日志」按钮
//     打开控制台日志面板（见 createLogDialog / installConsoleCapture）。
//
// 以 ES module 加载；依赖的同源静态模块（proto/receiver）与 /nos/*（页面
// 由 Core SW 伺服，必定受控）均可直接 import。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_AGENT,
  USER_NAMESPACE,
  buildDbgResultMessages,
  createReliableLink,
} from "/bridge/proto.js";
import { createPreviewReceiver, waitUrlReady } from "/bridge/receiver.js";
import { runDebugCommand } from "/bridge/debug-runtime.js";
import { getUser } from "/nos/user/main.js";

// 注入标签里的 conjure 侧 userId（module script 无 document.currentScript，
// 从 DOM 上的标签取）
const scriptTag = document.querySelector(
  `script[src="${import.meta.url.replace(location.origin, "")}"]`,
) || document.querySelector('script[src*="/bridge/inject.js"]');
const conjureId = scriptTag ? scriptTag.dataset.conjureId || "" : "";

const log = (...args) => console.info("[conjure-agent]", ...args);

/* ---------- 控制台捕获（log/info/warn/error/debug/time 系/table + 全局错误） ---------- */

const LOG_RING_MAX = 800; // 环形缓冲上限（条）
const ARG_TEXT_MAX = 2000; // 单条日志文本上限（字符）

const fmtArg = (v, depth = 0) => {
  try {
    if (v == null) return String(v);
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
    if (v instanceof Error) {
      return `${v.name}: ${v.message}` + (v.stack ? `\n${v.stack}` : "");
    }
    if (v instanceof Node) {
      const html = v.outerHTML || v.textContent || String(v);
      return html.length > 200 ? html.slice(0, 200) + "…" : html;
    }
    if (depth >= 2) return String(v);
    if (Array.isArray(v)) {
      return `[${v.map((x) => fmtArg(x, depth + 1)).join(", ")}]`;
    }
    const json = JSON.stringify(v, null, 1);
    return json === undefined ? String(v) : json;
  } catch (_) {
    return String(v);
  }
};

/**
 * 挂接 console 各方法与全局错误事件，收集带时间戳的日志到环形缓冲。
 * 注意：module（defer）在文档解析后执行，早于本脚本的同步 console 输出无法捕获。
 * @returns {{ entries: Array, subscribe(cb: Function): void }}
 */
export function installConsoleCapture() {
  const entries = [];
  const subs = new Set();
  const push = (level, parts) => {
    let text = parts.join(" ");
    if (text.length > ARG_TEXT_MAX) text = text.slice(0, ARG_TEXT_MAX) + "…";
    entries.push({ t: Date.now(), level, text });
    if (entries.length > LOG_RING_MAX) entries.shift();
    subs.forEach((f) => {
      try {
        f(entries);
      } catch (_) {}
    });
  };

  const timers = new Map(); // console.time 标签 → 开始时间
  const wrap = (level) => {
    const orig = console[level] ? console[level].bind(console) : () => {};
    console[level] = (...args) => {
      push(level, args.map((a) => fmtArg(a)));
      orig(...args);
    };
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) wrap(level);
  console.table = ((orig) => (...args) => {
    push("log", ["[table]", ...args.map((a) => fmtArg(a))]);
    orig(...args);
  })(console.table ? console.table.bind(console) : () => {});
  console.time = ((orig) => (label = "default") => {
    timers.set(label, Date.now());
    orig(label);
  })(console.time ? console.time.bind(console) : () => {});
  console.timeLog = ((orig) => (...args) => {
    const label = args[0] ?? "default";
    const start = timers.get(label);
    push("log", [
      `${label}: ${start ? Date.now() - start : "?"}ms`,
      ...args.slice(1).map((a) => fmtArg(a)),
    ]);
    orig(...args);
  })(console.timeLog ? console.timeLog.bind(console) : () => {});
  console.timeEnd = ((orig) => (label = "default") => {
    const start = timers.get(label);
    if (start != null) {
      push("log", [`${label}: ${(Date.now() - start).toFixed(1)}ms`]);
      timers.delete(label);
    }
    orig(label);
  })(console.timeEnd ? console.timeEnd.bind(console) : () => {});

  window.addEventListener(
    "error",
    (e) => {
      push("error", [
        `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`,
      ]);
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    push("error", ["UnhandledRejection: " + fmtArg(e.reason)]);
  });

  return {
    entries,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/* ---------- 日志对话框（Shadow DOM 隔离，应用 CSS 无法穿透） ---------- */

const DIALOG_ID = "conjure-log-dialog";

/**
 * 创建日志面板：等级过滤（全部/错误/警告）/ 清空 / 关闭（Esc 同效），
 * 打开时自动滚动到底部并实时追加新日志。返回 { toggle(), open(), close() }。
 */
export function createLogDialog(capture) {
  if (document.getElementById(DIALOG_ID)) {
    return { toggle: () => {}, open: () => {}, close: () => {} };
  }
  const host = document.createElement("div");
  host.id = DIALOG_ID;
  // 宿主关键属性带 !important（同气泡，防应用 CSS 压制）
  for (const [prop, val] of [
    ["position", "fixed"],
    ["z-index", "2147483647"],
    ["right", "16px"],
    ["bottom", "60px"],
    ["display", "none"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["pointer-events", "auto"],
  ]) {
    host.style.setProperty(prop, val, "important");
  }
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel {
    width: min(720px, 92vw);
    height: min(440px, 62vh);
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    overflow: hidden;
    background: rgba(24, 27, 33, 0.96);
    color: #e8eaed;
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft Yahei", sans-serif;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  header.dragging { cursor: grabbing; }
  header .title { font-weight: 600; color: #fff; }
  .chips { display: flex; gap: 6px; margin-left: 8px; }
  .chip {
    border: none; cursor: pointer;
    padding: 3px 10px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    color: #cfd3d9; font-size: 11px;
  }
  .chip.active { background: #4f8cff; color: #fff; }
  .chip .n { opacity: 0.75; margin-left: 4px; }
  .spacer { flex: 1; }
  button.act {
    border: none; cursor: pointer;
    padding: 3px 10px; border-radius: 8px;
    background: rgba(255, 255, 255, 0.12);
    color: #e8eaed; font-size: 11px;
  }
  button.act:hover { background: rgba(255, 255, 255, 0.22); }
  .body {
    flex: 1; overflow: auto; padding: 8px 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
  }
  .row {
    display: flex; gap: 8px;
    padding: 3px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    white-space: pre-wrap; word-break: break-word;
  }
  .row .t { flex: none; color: #8ab4f8; opacity: 0.85; }
  .row .lv { flex: none; width: 40px; font-weight: 600; }
  .row.error { background: rgba(239, 68, 68, 0.12); }
  .row.error .lv { color: #f87171; }
  .row.warn { background: rgba(251, 191, 36, 0.08); }
  .row.warn .lv { color: #fbbf24; }
  .row.info .lv { color: #7eeac5; }
  .row.debug .lv { color: #9aa0a6; }
  .row.log .lv { color: #9aa0a6; }
  .empty { padding: 24px; text-align: center; color: #9aa0a6; }
</style>
<div class="panel">
  <header>
    <span class="title">日志</span>
    <span class="chips">
      <button class="chip" data-f="all">全部<span class="n"></span></button>
      <button class="chip" data-f="error">错误<span class="n"></span></button>
      <button class="chip" data-f="warn">警告<span class="n"></span></button>
    </span>
    <span class="spacer"></span>
    <button class="act" data-act="clear">清空</button>
    <button class="act" data-act="close">关闭 ✕</button>
  </header>
  <div class="body"></div>
</div>`;

  const bodyEl = shadow.querySelector(".body");
  const chips = [...shadow.querySelectorAll(".chip")];
  let filter = "all";
  let open_ = false;

  // 顶栏拖拽（与胶囊同一套 Pointer Events + 视口钳制；位置记忆 sessionStorage）
  const DIALOG_POS_KEY = "conjure-log-dialog-pos";
  const headerEl = shadow.querySelector("header");
  const placeDialog = (x, y) => {
    const w = host.offsetWidth || 400;
    const h = host.offsetHeight || 300;
    const px = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8));
    const py = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
    host.style.setProperty("left", `${px}px`, "important");
    host.style.setProperty("top", `${py}px`, "important");
    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("bottom", "auto", "important");
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(DIALOG_POS_KEY) || "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      placeDialog(saved.x, saved.y);
    }
  } catch (_) {}
  let dlgDrag = null;
  headerEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return; // 过滤/清空/关闭按钮不触发拖拽
    const rect = host.getBoundingClientRect();
    dlgDrag = { px: e.clientX, py: e.clientY, ox: rect.left, oy: rect.top };
    headerEl.classList.add("dragging");
    headerEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  headerEl.addEventListener("pointermove", (e) => {
    if (!dlgDrag) return;
    placeDialog(
      dlgDrag.ox + e.clientX - dlgDrag.px,
      dlgDrag.oy + e.clientY - dlgDrag.py,
    );
  });
  const endDlgDrag = () => {
    if (!dlgDrag) return;
    dlgDrag = null;
    headerEl.classList.remove("dragging");
    try {
      const rect = host.getBoundingClientRect();
      sessionStorage.setItem(
        DIALOG_POS_KEY,
        JSON.stringify({ x: rect.left, y: rect.top }),
      );
    } catch (_) {}
  };
  headerEl.addEventListener("pointerup", endDlgDrag);
  headerEl.addEventListener("pointercancel", endDlgDrag);

  const fmtTime = (t) => {
    const d = new Date(t);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };
  const levelName = (lv) =>
    ({ error: "error", warn: "warn", info: "info" }[lv] || "log");

  const render = () => {
    const list = capture.entries.filter((e) =>
      filter === "all"
        ? true
        : filter === "error"
          ? e.level === "error"
          : e.level === "warn" || e.level === "error",
    );
    bodyEl.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无日志";
      bodyEl.appendChild(empty);
    } else {
      const frag = document.createDocumentFragment();
      for (const e of list) {
        const row = document.createElement("div");
        row.className = `row ${levelName(e.level)}`;
        const t = document.createElement("span");
        t.className = "t";
        t.textContent = fmtTime(e.t);
        const lv = document.createElement("span");
        lv.className = "lv";
        lv.textContent = levelName(e.level);
        const msg = document.createElement("span");
        msg.textContent = e.text;
        row.append(t, lv, msg);
        frag.appendChild(row);
      }
      bodyEl.appendChild(frag);
    }
    bodyEl.scrollTop = bodyEl.scrollHeight;
    // 等级计数徽标
    const counts = {
      all: capture.entries.length,
      error: capture.entries.filter((e) => e.level === "error").length,
      warn: capture.entries.filter(
        (e) => e.level === "warn" || e.level === "error",
      ).length,
    };
    chips.forEach((c) => {
      c.querySelector(".n").textContent = counts[c.dataset.f] || "";
      c.classList.toggle("active", c.dataset.f === filter);
    });
  };

  chips.forEach((c) =>
    c.addEventListener("click", () => {
      filter = c.dataset.f;
      render();
    }),
  );
  shadow.querySelector('[data-act="clear"]').addEventListener("click", () => {
    capture.entries.length = 0;
    render();
  });
  shadow.querySelector('[data-act="close"]').addEventListener("click", () =>
    close(),
  );
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  function open() {
    if (open_) return;
    open_ = true;
    host.style.setProperty("display", "block", "important");
    render();
    document.addEventListener("keydown", onKey, true);
  }
  function close() {
    if (!open_) return;
    open_ = false;
    host.style.setProperty("display", "none", "important");
    document.removeEventListener("keydown", onKey, true);
  }

  // 打开期间实时追加
  capture.subscribe(() => {
    if (open_) render();
  });

  return { toggle: () => (open_ ? close() : open()), open, close };
}

/* ---------- 调试预览胶囊（可拖拽 + 日志按钮） ---------- */

const BUBBLE_ID = "conjure-preview-bubble";
const BUBBLE_POS_KEY = "conjure-agent-bubble-pos";

/**
 * 创建常驻胶囊：标识「本应用经隔离预览（debug）运行」，可拖拽，
 * 右侧「日志」按钮打开控制台日志面板；位置记忆在 sessionStorage。
 * 挂在 documentElement（html）下而非 body——AI 生成的应用常在脚本里
 * 重写 body（innerHTML / replaceChildren），挂 body 会被一并清掉；
 * 另配 MutationObserver：节点被应用移除时自动回挂。
 * 返回 { set(text, tone) }，tone: "idle"|"busy"|"ok"|"offline"。
 */
export function createBubble(onLogsClick) {
  if (document.getElementById(BUBBLE_ID)) {
    return { set: () => {} };
  }
  const el = document.createElement("div");
  el.id = BUBBLE_ID;
  // 全内联样式：注入目标页的 CSS 变量 / 规则不可依赖（AI 生成的应用任意写）
  Object.assign(el.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 6px 6px 14px",
    borderRadius: "999px",
    font: "12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft Yahei', sans-serif",
    color: "#fff",
    background: "rgba(32, 36, 44, 0.82)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
    backdropFilter: "blur(8px)",
    webkitBackdropFilter: "blur(8px)",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
    whiteSpace: "nowrap",
  });
  // 关键属性带 !important：应用的 !important CSS 试图隐藏 / 改定位时保持压制
  //（position 必须 fixed，否则 z-index 失效、胶囊被挤进文档流）
  for (const [prop, val] of [
    ["position", "fixed"],
    ["z-index", "2147483647"],
    ["left", "16px"],
    ["top", "auto"],
    ["right", "auto"],
    ["bottom", "16px"],
    ["display", "flex"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["pointer-events", "auto"],
  ]) {
    el.style.setProperty(prop, val, "important");
  }

  const dot = document.createElement("span");
  Object.assign(dot.style, {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#9aa0a6",
    flex: "none",
  });
  const label = document.createElement("span");
  label.textContent = "隔离预览";
  const btn = document.createElement("span");
  btn.textContent = "日志";
  Object.assign(btn.style, {
    flex: "none",
    padding: "2px 10px",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.14)",
    cursor: "pointer",
    fontSize: "11px",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(255, 255, 255, 0.28)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(255, 255, 255, 0.14)";
  });
  // 按钮不参与拖拽，点击开日志面板
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      onLogsClick?.();
    } catch (_) {}
  });

  el.append(dot, label, btn);
  const host = document.documentElement;
  host.appendChild(el);

  // 守护：应用重写 DOM 把胶囊移除时自动回挂（观察整个文档子树）
  const guard = new MutationObserver(() => {
    if (!document.getElementById(BUBBLE_ID)) {
      try {
        host.appendChild(el);
      } catch (_) {}
    }
  });
  guard.observe(host, { childList: true, subtree: true });

  const TONE_COLOR = {
    idle: "#9aa0a6",
    busy: "#fbbf24",
    ok: "#22c55e",
    offline: "#ef4444",
  };
  const api = {
    set(text, tone = "idle") {
      if (text) label.textContent = text;
      dot.style.background = TONE_COLOR[tone] || TONE_COLOR.idle;
    },
  };

  // 恢复上次拖放位置（同标签页有效，reload 不丢）
  try {
    const saved = JSON.parse(sessionStorage.getItem(BUBBLE_POS_KEY) || "null");
    if (
      saved &&
      Number.isFinite(saved.x) &&
      Number.isFinite(saved.y)
    ) {
      place(saved.x, saved.y);
    }
  } catch (_) {}

  function clamp(x, y) {
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 32;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
    };
  }

  function place(x, y) {
    const p = clamp(x, y);
    el.style.setProperty("left", `${p.x}px`, "important");
    el.style.setProperty("top", `${p.y}px`, "important");
    // 清掉初始锚定的 bottom/right：固定定位下 top 与 bottom 同时生效会把
    // 高度 auto 的胶囊拉伸到两端之间（底边钉死在视口底部）
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("right", "auto", "important");
  }

  // Pointer Events 拖拽（mouse / touch 通用）
  let dragging = null;
  el.addEventListener("pointerdown", (e) => {
    dragging = {
      px: e.clientX,
      py: e.clientY,
      ox: el.offsetLeft,
      oy: el.offsetTop,
    };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    place(
      dragging.ox + e.clientX - dragging.px,
      dragging.oy + e.clientY - dragging.py,
    );
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    el.style.cursor = "grab";
    try {
      sessionStorage.setItem(
        BUBBLE_POS_KEY,
        JSON.stringify({ x: el.offsetLeft, y: el.offsetTop }),
      );
    } catch (_) {}
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  return api;
}

/* ---------- 代理主流程 ---------- */

async function ensureServerConnected(user, timeout = 5000) {
  const urls = () =>
    Array.isArray(user.server?.connectedUrls) ? user.server.connectedUrls : [];
  let servers = [];
  try {
    servers = (await user.server.getServers()) || [];
  } catch (_) {
    return;
  }
  await Promise.all(
    servers.map((s) => user.server.connect(s).catch(() => {})),
  );
  const deadline = Date.now() + timeout;
  while (urls().length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  // 控制台捕获要尽早装上（module defer 执行时，应用后续输出都能收进环形缓冲）
  const capture = installConsoleCapture();
  const dialog = createLogDialog(capture);
  const bubble = createBubble(() => dialog.toggle());
  bubble.set("隔离预览", "idle");

  if (!conjureId) {
    bubble.set("隔离预览（未连妙造）", "offline");
    log("缺少 data-conjure-id，代理不启动");
    return;
  }
  try {
    const user = await getUser(USER_NAMESPACE);
    let remote = null;
    const link = createReliableLink({
      sendTo: (env) =>
        remote
          ? remote.sendToService(SERVICE_ID_CONJURE, env, {
              waitForService: 3000,
            })
          : Promise.resolve([{ status: "error" }]),
    });

    // 接收端：复用 receiver（含 index.html 代理脚本注入与增量比对），
    // 应用名取本页路径 /$conjure-apps/<name>/client/index.html 的 <name>
    const appName = decodeURIComponent(
      location.pathname.split("/")[2] || "",
    );
    const agentBootAt = Date.now();
    const receiver = createPreviewReceiver({
      conjureId,
      onProgress: (total, done, path) => {
        if (path == null) {
          bubble.set(`接收更新 0/${total}`, "busy");
          return;
        }
        bubble.set(`接收更新 ${done}/${total}`, "busy");
      },
    });

    // conjure 下发的调试指令：在本页执行（eval/console/click/dom/shot...），
    // 结果经 proto 的 dbg-chunk/dbg-result 协议回传（大结果自动分片）
    const handleDbg = async (payload) => {
      if (!payload.reqId || typeof payload.cmd !== "string") return;
      bubble.set("隔离预览 · 调试中", "busy");
      const started = Date.now();
      let outcome;
      try {
        outcome = await runDebugCommand({
          cmd: payload.cmd,
          args: payload.args || {},
          capture,
          info: { appName, agentBootAt },
        });
      } catch (err) {
        outcome = { ok: false, error: (err && err.stack) || String(err) };
      }
      outcome.meta = { ...(outcome.meta || {}), ms: Date.now() - started };
      for (const msg of buildDbgResultMessages(payload.reqId, outcome)) {
        link.send(msg).catch((err) => log("调试结果回传失败：", err));
      }
      bubble.set("隔离预览 · 已连接妙造", "ok");
    };

    user.registerService(SERVICE_ID_AGENT, {
      onMessage: (data, ctx) => {
        // 只信任注入时绑定的 conjure 用户：其他本地用户即便连上来也不响应
        //（调试指令可执行任意 JS，必须校验发送方）
        if (conjureId && ctx.fromUserId && ctx.fromUserId !== conjureId) {
          log("忽略非 conjure 用户的消息：", ctx.fromUserId);
          return;
        }
        const payload = link.receive(data, (env) => {
          // ACK 定向回复到 conjure 监听的服务
          ctx.remoteUser
            .sendToService(SERVICE_ID_CONJURE, env, {
              sessionId: ctx.fromSessionId,
            })
            .catch(() => {});
        });
        if (!payload) return;
        if (payload.type === "dbg") {
          handleDbg(payload);
          return;
        }
        receiver
          .handle(payload)
          .then((result) => {
            if (payload.type === "sync-check" && result && result.reply) {
              link.send(result.reply).catch(() => {});
              // 零差异：直接回报 done（无需刷新，conjure 侧收尾）
              if (!result.reply.missing.length) {
                link
                  .send({
                    type: "done",
                    appName: result.appName,
                    url: result.url,
                  })
                  .catch(() => {});
                bubble.set("隔离预览 · 已是最新", "ok");
              }
              return;
            }
            if (payload.type === "app-end" && result && result.url) {
              bubble.set("更新完成，刷新中...", "ok");
              // 文件已全部落盘：回报 done 后刷新本页应用新代码
              link
                .send({ type: "done", appName: result.appName, url: result.url })
                .catch(() => {});
              waitUrlReady(result.url, 10000).then(() => location.reload());
            }
          })
          .catch((err) => log("处理消息失败：", err));
      },
    });

    await ensureServerConnected(user);
    remote = await user.connectUser(conjureId);
    // 上报就绪（尽力投递；conjure 不在线时静默失败，不影响应用本身运行）
    await link.send({ type: "agent-online", userId: user.userId });
    bubble.set("隔离预览 · 已连接妙造", "ok");
    log(`代理就绪（app=${appName}）`);
  } catch (err) {
    // 代理失败不影响应用页面本身
    bubble.set("隔离预览 · 连接失败", "offline");
    log("启动失败（忽略）：", err);
  }
}

main();
