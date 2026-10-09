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
//     协议回传；每次调用记入操作日志（createOpLog，sessionStorage 按页面加载
//     分组），日志面板「妙造调用」视图可查；
//   - 页面内常驻可拖拽的「隔离预览」胶囊（见 createBubble），标识本应用
//     经隔离预览（debug）模式运行，并联动代理状态；胶囊右侧「日志」按钮
//     打开控制台日志面板（见 createLogDialog / installConsoleCapture，
//     面板含「控制台」与「妙造调用」双视图）。
//
// 以 ES module 加载；依赖的同源静态模块（proto/receiver）与 /nos/*（页面
// 由 Core SW 伺服，必定受控）均可直接 import。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_AGENT,
  USER_NAMESPACE,
  buildDbgResultMessages,
  createReliableLink,
  enableServerAutoReconnect,
  ensureServerConnected,
} from "/bridge/proto.js";
import { createPreviewReceiver, waitUrlReady } from "/bridge/receiver.js";
import {
  runDebugCommand,
  createOpLog,
  DBG_TOOL_NAMES,
} from "/bridge/debug-runtime.js";
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
  // 静默开关：置 true 时暂停记录。snapdom 克隆页面会实例化宿主框架的自定义
  // 元素并触发噪音报错（ofa 组件 created 回调等），这类「截图自身」的报错
  // 不能进缓冲污染 AI 的错误感知（preview console / 自动错误回路）
  let muted = false;
  const push = (level, parts) => {
    if (muted) return;
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
      if (muted) return;
      push("error", [
        `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`,
      ]);
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    if (muted) return;
    push("error", ["UnhandledRejection: " + fmtArg(e.reason)]);
  });

  return {
    entries,
    setMuted(v) {
      muted = !!v;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/* ---------- 日志对话框（Shadow DOM 隔离，应用 CSS 无法穿透） ---------- */

const DIALOG_ID = "conjure-log-dialog";

/**
 * 创建日志面板：双视图——「控制台」（等级过滤 全部/错误/警告 + 清空 + Esc 关闭，
 * 打开时自动滚动到底部并实时追加新日志）与「妙造调用」（conjure 经调试指令
 * 对本页做过的操作记录：工具名 + 参数摘要 + 成败与耗时，按页面加载分组，
 * sessionStorage 持久化）。返回 { toggle(), open(), close() }。
 * @param {{ entries: Array, subscribe: Function }} capture installConsoleCapture 产物
 * @param {{ sessions: Function, clear: Function, subscribe?: Function }} [opLog]
 *        createOpLog 产物（缺省时不显示「妙造调用」视图）
 */
export function createLogDialog(capture, opLog = null) {
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
  .tabs { display: flex; gap: 4px; }
  .tab {
    border: none; cursor: pointer;
    padding: 3px 10px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: #cfd3d9; font-size: 11px;
  }
  .tab.active { background: #4f8cff; color: #fff; }
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
  /* 妙造调用视图 */
  .group-head {
    padding: 8px 12px 4px;
    color: #9aa0a6; font-size: 10.5px; font-weight: 600;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .group-head:first-child { border-top: none; }
  .call-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 3px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .call-row .t { flex: none; color: #8ab4f8; opacity: 0.85; }
  .call-badge {
    flex: none; max-width: 40%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding: 1px 8px; border-radius: 999px;
    font-size: 10.5px; font-weight: 600;
    background: rgba(255, 255, 255, 0.1); color: #cfd3d9;
  }
  .call-badge.query { color: #8ab4f8; }
  .call-badge.act { color: #fbbf24; }
  .call-badge.inspect { color: #7eeac5; }
  .call-badge.shot { color: #c58af9; }
  .call-args {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #bdc1c6;
  }
  .call-st { flex: none; font-size: 10.5px; }
  .call-st.ok { color: #22c55e; }
  .call-st.err { color: #f87171; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .call-st.run { color: #9aa0a6; }
</style>
<div class="panel">
  <header>
    <span class="tabs">
      <button class="tab" data-view="console">控制台</button>
      <button class="tab" data-view="calls">妙造调用</button>
    </span>
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
  const fmtTimeShort = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const levelName = (lv) =>
    ({ error: "error", warn: "warn", info: "info" }[lv] || "log");

  // ---------- 视图状态：console（控制台）/ calls（妙造调用） ----------
  const tabs = [...shadow.querySelectorAll(".tab")];
  const chipsEl = shadow.querySelector(".chips");
  const DIALOG_VIEW_KEY = "conjure-log-dialog-view";
  let view = "console";
  try {
    const saved = sessionStorage.getItem(DIALOG_VIEW_KEY);
    if (saved === "console" || saved === "calls") view = saved;
  } catch (_) {}

  const renderConsole = () => {
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

  // ---------- 妙造调用视图：conjure 调试指令记录（按页面加载分组） ----------
  const CALL_TONE = {
    status: "query", console: "query", text: "query",
    click: "act", type: "act", wait: "act",
    dom: "inspect", eval: "inspect",
    shot: "shot",
  };
  const renderCalls = () => {
    bodyEl.innerHTML = "";
    if (!opLog) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "调用记录不可用";
      bodyEl.appendChild(empty);
      return;
    }
    const sessions = opLog.sessions();
    if (!sessions.some((s) => s.entries.length)) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无妙造调用记录";
      bodyEl.appendChild(empty);
      return;
    }
    // 新的加载分组在前；组内条目按时间顺序
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      if (!s.entries.length) continue;
      const head = document.createElement("div");
      head.className = "group-head";
      head.textContent = `── ${i === sessions.length - 1 ? "本次加载" : "上次加载"} ${fmtTimeShort(s.startedAt)} ──`;
      bodyEl.appendChild(head);
      for (const e of s.entries) {
        const row = document.createElement("div");
        row.className = "call-row";
        const t = document.createElement("span");
        t.className = "t";
        t.textContent = fmtTime(e.ts);
        const badge = document.createElement("span");
        badge.className = `call-badge ${CALL_TONE[e.cmd] || ""}`;
        badge.textContent = DBG_TOOL_NAMES[e.cmd] || e.cmd;
        row.title = e.args || badge.textContent;
        const args = document.createElement("span");
        args.className = "call-args";
        args.textContent = e.args || "—";
        const st = document.createElement("span");
        if (e.ok === true) {
          st.className = "call-st ok";
          st.textContent = `✓ ${e.ms ?? "?"}ms`;
        } else if (e.ok === false) {
          st.className = "call-st err";
          st.textContent = `✗ ${e.err || "失败"}`;
        } else {
          st.className = "call-st run";
          st.textContent = "执行中…";
        }
        row.append(t, badge, args, st);
        bodyEl.appendChild(row);
      }
    }
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  const render = () => {
    tabs.forEach((tb) => tb.classList.toggle("active", tb.dataset.view === view));
    // 等级过滤 chips 只属于控制台视图
    chipsEl.style.display = view === "console" ? "" : "none";
    if (view === "calls") renderCalls();
    else renderConsole();
  };

  tabs.forEach((tb) =>
    tb.addEventListener("click", () => {
      view = tb.dataset.view;
      try {
        sessionStorage.setItem(DIALOG_VIEW_KEY, view);
      } catch (_) {}
      render();
    }),
  );

  chips.forEach((c) =>
    c.addEventListener("click", () => {
      filter = c.dataset.f;
      render();
    }),
  );
  shadow.querySelector('[data-act="clear"]').addEventListener("click", () => {
    if (view === "calls") {
      opLog?.clear();
    } else {
      capture.entries.length = 0;
    }
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

  // 打开期间实时追加：控制台日志与调用记录各自刷新当前视图
  capture.subscribe(() => {
    if (open_ && view === "console") render();
  });
  if (opLog && typeof opLog.subscribe === "function") {
    opLog.subscribe(() => {
      if (open_ && view === "calls") render();
    });
  }

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

// 共享实现（proto.js）：收敛到同一台中继 + 命令悬挂（capped）时硬重置连接；
// 代理侧静默尽力而为，不抛错打断页面
async function ensureServerConnectedSafe(user, info) {
  try {
    await ensureServerConnected(user, {
      timeout: 5000,
      hard: info?.reason === "capped",
    });
  } catch (_) {}
}

/* ---------- 能力桥（guest 替身 ↔ 妙造主容器 broker） ----------
 * receiver 注入的 import map 把 /mz/ai|net 顶替为 bridge/guest/ 替身模块；
 * 替身经这里挂载的 window.__MZ_BRIDGE__.call(cap, args) 把调用转发给主容器
 * （cap-req），主容器用自己的 key/联网通道执行后回 cap-chunk（流式分片）/
 * cap-res（终态）。key 与通道配置永不过桥。只挂调用入口，不暴露凭据。
 */
const pendingCaps = new Map(); // cap id → { resolve, reject, onChunk, timer }
let capSeq = 0;
let capSend = null; // (payload) => Promise，可靠链路建好后赋值

const abortError = () => {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
};

const mountCapBridge = () => {
  globalThis.__MZ_BRIDGE__ = {
    /** 发起一次能力调用；resolve 为 cap-res 的 result 字段 */
    call: (cap, args, { onChunk = null, signal = null, timeoutMs = 60_000 } = {}) =>
      new Promise((resolve, reject) => {
        if (typeof cap !== "string" || !cap) {
          return reject(new Error("cap 不能为空"));
        }
        const id = `cap-${Date.now().toString(36)}-${++capSeq}`;
        const entry = { resolve, reject, onChunk, timer: null };
        entry.timer = setTimeout(() => {
          pendingCaps.delete(id);
          reject(new Error(`${cap} 超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
        }, timeoutMs);
        pendingCaps.set(id, entry);
        if (signal) {
          if (signal.aborted) {
            clearTimeout(entry.timer);
            pendingCaps.delete(id);
            return reject(abortError());
          }
          // 取消：本地立即收场（AbortError），并通知主容器中断底层请求
          signal.addEventListener(
            "abort",
            () => {
              capSend?.({ type: "cap-abort", id }).catch(() => {});
              if (pendingCaps.delete(id)) {
                clearTimeout(entry.timer);
                reject(abortError());
              }
            },
            { once: true },
          );
        }
        if (!capSend) {
          clearTimeout(entry.timer);
          pendingCaps.delete(id);
          return reject(new Error("预览能力桥未就绪（代理链路尚未建立）"));
        }
        capSend({ type: "cap-req", id, cap, args }).catch((err) => {
          if (pendingCaps.delete(id)) {
            clearTimeout(entry.timer);
            reject(new Error("妙造连接中断，能力调用失败：" + (err?.message || err)));
          }
        });
      }),
  };
};

async function main() {
  // 控制台捕获要尽早装上（module defer 执行时，应用后续输出都能收进环形缓冲）
  const capture = installConsoleCapture();
  // conjure 调试指令的操作记录（日志面板「妙造调用」视图；按页面加载分组持久化）
  const opLog = createOpLog();
  const dialog = createLogDialog(capture, opLog);
  const bubble = createBubble(() => dialog.toggle());
  bubble.set("隔离预览", "idle");

  if (!conjureId) {
    bubble.set("隔离预览（未连妙造）", "offline");
    log("缺少 data-conjure-id，代理不启动");
    return;
  }
  // 桥对象先于应用代码挂载（本模块先于应用脚本执行）；链路建好前调用
  // 会在 call 内以「未就绪」收场——应用若在极早期调用属生成代码问题
  mountCapBridge();
  try {
    const user = await getUser(USER_NAMESPACE);
    enableServerAutoReconnect(user); // 掉线自动重连（默认关闭）
    let remote = null;
    const link = createReliableLink({
      sendTo: (env) =>
        remote
          ? remote.sendToService(SERVICE_ID_CONJURE, env, {
              waitForService: 3000,
            })
          : Promise.resolve([{ status: "error" }]),
      // 中继通道掉线（offline）时主动重连，别让重试窗口干等耗尽
      onOffline: (info) => ensureServerConnectedSafe(user, info),
    });
    // 能力桥的发送通道就绪（call 内已挂载，等待器不受影响）
    capSend = (payload) => link.send(payload);

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
    // 结果经 proto 的 dbg-chunk/dbg-result 协议回传（大结果自动分片）；
    // 每次调用记入操作日志（面板「妙造调用」视图可见）
    const handleDbg = async (payload) => {
      if (!payload.reqId || typeof payload.cmd !== "string") return;
      bubble.set("隔离预览 · 调试中", "busy");
      const started = Date.now();
      const opId = opLog.record(payload.cmd, payload.args || {});
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
      opLog.finish(
        opId,
        outcome.ok === true,
        Date.now() - started,
        outcome.ok ? "" : outcome.error,
      );
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
        // 能力桥回包：流式分片 / 终态结果，路由到等待中的调用（迟到的
        // 分片对应已超时收场的调用，直接丢弃）
        if (payload.type === "cap-chunk" || payload.type === "cap-res") {
          const entry = pendingCaps.get(payload.id);
          if (!entry) return;
          if (payload.type === "cap-chunk") {
            try {
              entry.onChunk?.(payload);
            } catch (_) {}
            return;
          }
          pendingCaps.delete(payload.id);
          clearTimeout(entry.timer);
          if (payload.ok) entry.resolve(payload.result);
          else entry.reject(new Error(payload.error || "能力调用失败"));
          return;
        }
        // 被 conjure 拒绝注册：预览窗口数已达上限（尽力投递的通知信封）
        if (payload.type === "preview-full") {
          bubble.set(`预览窗口已达上限（${payload.max || 10}）`, "offline");
          log("被 conjure 拒绝：预览窗口数量已达上限");
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

    await ensureServerConnectedSafe(user);
    remote = await user.connectUser(conjureId);
    // 上报就绪（尽力投递；conjure 不在线时静默失败，不影响应用本身运行）
    await link.send({ type: "agent-online", userId: user.userId });
    // announce 心跳：向 conjure 的窗口注册表上报本窗口（多窗口清单 / 调试指令
    // 定向投递的依据）。15s 一次，conjure 侧 45s 无心跳即判离线；经可靠链路
    // 发送（有 ACK/重发），conjure 不在线时重试耗尽静默失败
    const announce = () =>
      link
        .send({
          type: "announce",
          appName,
          url: location.href,
          ua: navigator.userAgent,
        })
        .catch(() => {});
    announce();
    setInterval(announce, 15_000);
    bubble.set("隔离预览 · 已连接妙造", "ok");
    log(`代理就绪（app=${appName}）`);
  } catch (err) {
    // 代理失败不影响应用页面本身
    bubble.set("隔离预览 · 连接失败", "offline");
    log("启动失败（忽略）：", err);
  }
}

main();
