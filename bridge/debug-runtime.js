// Conjure 隔离预览 —— 调试指令运行时（纯页面逻辑，无 /nos/* 依赖，可单测）
//
// 由 inject.js 在预览应用页内引入，执行 conjure 下发的 dbg 调试指令：
//   status   预览页状态（URL/标题/视口/日志统计）
//   console  读取控制台日志（inject.js 的 installConsoleCapture 环形缓冲）
//   text     读元素 innerText（默认 body）
//   click    深度查找元素并触发 click()
//   type     聚焦写入文本并派发 input/change
//   wait     轮询等待元素出现/消失或谓词成立
//   dom      DOM 样式快照（每节点一行几何 + 关键样式 + 文本，穿 shadow DOM）
//   eval     执行任意 JS（预置 $ / $$ / $deep / $$deep / $wait / $rect 等）
//   shot     真实截图（getDisplayMedia，需用户在浏览器授权一次）
//
// eval 运行时、序列化、DOM 快照的实现参考 web-bridge-mcp 的 client.js
// （同作者既有项目，方法经过实践验证），按本场景精简适配。

/* ---------- 深度选择器（light DOM 查不到时自动穿入已打开的 shadowRoot） ---------- */

export function deepRoots(root = document, out = []) {
  out.push(root);
  const els = root.querySelectorAll("*");
  for (let i = 0; i < els.length; i++) {
    if (els[i].shadowRoot) deepRoots(els[i].shadowRoot, out);
  }
  return out;
}

/** 深度查第一个匹配元素（穿 shadow DOM），找不到返回 null */
export function deepQuery(selector, root = document) {
  for (const r of deepRoots(root, [])) {
    const el = r.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/** 深度查全部匹配元素 */
export function deepQueryAll(selector, root = document) {
  const out = [];
  for (const r of deepRoots(root, [])) out.push(...r.querySelectorAll(selector));
  return out;
}

/* ---------- eval 运行时 ---------- */

// 预置快捷函数（与 web-bridge-mcp 同名同义，AI 可迁移既有经验）：
// $ / $$ 普通查询；$deep / $$deep 深度查询；$import 以页面 URL 为 base 动态 import；
// $wait 轮询等待；$rect 元素几何+可见性；$css 批量写样式
const PROLOGUE = `const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const $deep = (s, r) => __deepQuery(s, r);
const $$deep = (s, r) => __deepQueryAll(s, r);
const $import = (s) => import(new URL(s, location.href).href);
const $wait = async (cond, timeoutMs) => {
  const t0 = Date.now();
  for (;;) {
    const v = typeof cond === "string" ? ($deep(cond) || $(cond)) : await cond();
    if (v) return v;
    if (Date.now() - t0 > (timeoutMs || 10000)) throw new Error("$wait 超时（" + (timeoutMs || 10000) + "ms）: " + (typeof cond === "string" ? cond : String(cond).slice(0, 100)));
    await new Promise((r) => setTimeout(r, 100));
  }
};
const $rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth }; };
const $css = (el, styles) => { for (const k in styles) el.style[k] = styles[k]; return el; };
`;

// 语句块自动 return 的排除名单：最后一句不是表达式语句时保持原样
const NO_AUTORETURN_RE =
  /^(return|if|for|while|switch|do|try|catch|finally|throw|break|continue|const|let|var|function|class|else|\/\/|\/\*|\*|\}|\)|;|await\s+(function|class))/;

/**
 * 把 AI 提供的代码编译为异步函数：先按单个表达式包装；语法错误退回语句块，
 * 且最后一句表达式语句自动补 return（同一行多语句只 return 最后一个 ';' 之后的）。
 * @param {string} code
 * @param {Object} helpers 注入到执行作用域的宿主函数（{ __deepQuery, __deepQueryAll }）
 * @returns {Function} 无参异步函数
 */
export function compileEval(code, helpers = {}) {
  const build = (body) =>
    new Function(
      "__deepQuery",
      "__deepQueryAll",
      '"use strict";\n' + PROLOGUE + body,
    ).bind(null, helpers.__deepQuery ?? deepQuery, helpers.__deepQueryAll ?? deepQueryAll);
  try {
    return build(`return (async () => (\n${code}\n))();`);
  } catch (_) {
    /* 不是单个表达式，走语句块 */
  }
  const lines = String(code).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t && t !== ";") {
      if (NO_AUTORETURN_RE.test(t)) break;
      const before = lines.slice(0, i).join("\n");
      const after = lines.slice(i + 1).join("\n");
      const semi = t.lastIndexOf(";");
      let transformed;
      if (semi !== -1) {
        const tail = t.slice(semi + 1).trim();
        if (!tail || NO_AUTORETURN_RE.test(tail)) break;
        transformed =
          before + "\n" + t.slice(0, semi + 1) + " return " + tail + "\n" + after;
      } else {
        transformed = before + "\nreturn " + t + "\n" + after;
      }
      try {
        return build(`return (async () => {\n${transformed}\n})();`);
      } catch (_) {
        /* 转换不合法，退回原始语句块 */
      }
      break;
    }
  }
  return build(`return (async () => {\n${code}\n})();`);
}

/* ---------- 安全序列化（结果预览） ---------- */

const PREVIEW_MAX_DEPTH = 6;
const PREVIEW_MAX_CHARS = 30000; // 留足 128KB 消息载荷余量（多字节场景）

/** 任意值 → 可读文本（Error 带 stack、DOM 带 outerHTML 摘要、循环引用标记、深度/长度封顶） */
export function serializeValue(v) {
  const out = previewInner(v, 0, []);
  return out.length > PREVIEW_MAX_CHARS
    ? out.slice(0, PREVIEW_MAX_CHARS) + " …[截断]"
    : out;
}

function previewInner(v, depth, seen) {
  try {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number" || t === "boolean") return String(v);
    if (t === "bigint") return v.toString() + "n";
    if (t === "string")
      return depth === 0
        ? v
        : JSON.stringify(v.length > 200 ? v.slice(0, 200) + "…" : v);
    if (t === "symbol") return v.toString();
    if (t === "function") {
      const src = Function.prototype.toString.call(v).split("\n")[0].slice(0, 200);
      return "ƒ " + (v.name || "(anonymous)") + " — " + src;
    }
    if (v instanceof Error)
      return v.stack ? String(v.stack) : v.name + ": " + v.message;
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (typeof Node !== "undefined" && v instanceof Node) {
      if (v instanceof Element) {
        const html = v.outerHTML || "";
        return html.length > 200 ? html.slice(0, 200) + "…" : html;
      }
      return "#" + (v.nodeName || "node") + " " + String(v.textContent || "").slice(0, 100);
    }
    if (typeof Window !== "undefined" && v instanceof Window) return "Window";

    if (depth >= PREVIEW_MAX_DEPTH) return "[深度超限]";
    if (seen.includes(v)) return "[Circular]";
    seen = seen.concat([v]);

    if (Array.isArray(v)) {
      const items = v.slice(0, 100).map((x) => previewInner(x, depth + 1, seen));
      if (v.length > 100) items.push("… 共 " + v.length + " 项");
      return "[" + items.join(", ") + "]";
    }
    if (v instanceof Map) {
      const m = [];
      let n = 0;
      for (const [k, val] of v) {
        if (n++ >= 50) {
          m.push("… 共 " + v.size + " 项");
          break;
        }
        m.push(previewInner(k, depth + 1, seen) + " => " + previewInner(val, depth + 1, seen));
      }
      return "Map(" + v.size + ") {" + m.join(", ") + "}";
    }
    if (v instanceof Set) {
      const s = [];
      let n = 0;
      for (const item of v) {
        if (n++ >= 50) {
          s.push("… 共 " + v.size + " 项");
          break;
        }
        s.push(previewInner(item, depth + 1, seen));
      }
      return "Set(" + v.size + ") {" + s.join(", ") + "}";
    }
    if (v instanceof Promise) return "Promise {<pending>}";

    const keys = Object.keys(v).slice(0, 50);
    const parts = keys.map((k) => k + ": " + previewInner(v[k], depth + 1, seen));
    const ctor =
      v.constructor && v.constructor.name && v.constructor.name !== "Object"
        ? v.constructor.name + " "
        : "";
    if (Object.keys(v).length > 50) parts.push("…");
    return ctor + "{" + parts.join(", ") + "}";
  } catch (e) {
    return "[无法序列化: " + (e && e.message) + "]";
  }
}

/* ---------- DOM 样式快照（虚拟截图：免授权的「长什么样」） ---------- */

const SNAPSHOT_STYLES = [
  "position", "z-index", "background-color", "color", "font-size", "font-weight",
  "border", "border-radius", "box-shadow", "opacity", "overflow",
];

/**
 * 递归子树生成文本快照：每个可见节点一行（几何 + 关键 computed style + 文本），
 * 穿 shadow DOM。验证颜色/布局/定位的首选，无需任何授权。
 * @param {Element} root
 * @param {{ depth?: number, maxNodes?: number }} [opts] depth 默认 4（上限 8），maxNodes 默认 60（上限 300）
 */
export function domSnapshot(root, opts = {}) {
  const maxDepth = Math.min(Math.max(1, opts.depth || 4), 8);
  const maxNodes = Math.min(Math.max(1, opts.maxNodes || 60), 300);
  const lines = [];
  const snap = (node, depth, prefix) => {
    if (lines.length >= maxNodes || depth > maxDepth) return;
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0))
      return;
    const cls =
      typeof node.className === "string" && node.className.trim()
        ? "." + node.className.trim().split(/\s+/).join(".")
        : "";
    const desc =
      prefix +
      "<" +
      node.tagName.toLowerCase() +
      (node.id ? "#" + node.id : "") +
      cls +
      ">";
    const st = SNAPSHOT_STYLES.map((k) => {
      const v = cs.getPropertyValue(k);
      return v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" &&
        v !== "1" && v !== "rgba(0, 0, 0, 0)"
        ? k + "=" + v
        : null;
    })
      .filter(Boolean)
      .join(", ");
    let txt = "";
    if (!node.children.length) {
      txt = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (txt) txt = ' 文本:"' + txt + '"';
    }
    lines.push(
      desc +
        " rect=" +
        Math.round(r.x) +
        "," +
        Math.round(r.y) +
        " " +
        Math.round(r.width) +
        "x" +
        Math.round(r.height) +
        (st ? " | " + st : "") +
        txt,
    );
    let kids;
    if (node.shadowRoot) {
      lines.push(prefix + "  #shadow-root");
      kids = Array.from(node.shadowRoot.children);
    } else {
      kids = Array.prototype.slice.call(node.children);
    }
    kids.forEach((c) => snap(c, depth + 1, prefix + "  "));
  };
  snap(root, 0, "");
  let out = lines.join("\n");
  if (lines.length >= maxNodes)
    out += `\n…[已达 maxNodes=${maxNodes} 上限，可调大 maxNodes 或减小 depth]`;
  return out || "（无可见的节点内容）";
}

/* ---------- 真实截图（getDisplayMedia，需用户授权一次） ---------- */

let shotStream = null; // 授权过的捕获流复用（页面存续期内免二次打扰）

/**
 * 截取页面真实渲染像素（JPEG base64）。首次调用浏览器弹原生授权框
 * （Chromium 预选当前标签页），授权一次后本页生命周期内复用。
 * @param {Element} [el] 按该元素视口矩形裁剪；缺省截整个视口
 * @param {{ maxSide?: number, quality?: number }} [opts] maxSide 默认 1280（0=不缩放），quality 默认 0.72
 * @returns {Promise<{ base64: string, w: number, h: number, mime: string }>}
 */
export async function captureScreenshot(el, opts = {}) {
  const MAX_SIDE = opts.maxSide === undefined ? 1280 : opts.maxSide;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error(
      "当前浏览器不支持屏幕捕获（getDisplayMedia），无法截图；请改用 dom 指令获取样式快照",
    );
  }
  if (!shotStream || !shotStream.getVideoTracks().some((t) => t.readyState === "live")) {
    try {
      shotStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
    } catch (e) {
      throw new Error(
        "未获得屏幕授权（用户拒绝或取消了浏览器弹框），无法截图: " + (e && e.message),
      );
    }
    shotStream.getVideoTracks()[0].addEventListener("ended", () => {
      shotStream = null;
    });
  }
  const settings = shotStream.getVideoTracks()[0].getSettings();
  const video = document.createElement("video");
  video.srcObject = shotStream;
  video.muted = true;
  video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;";
  document.documentElement.appendChild(video);
  try {
    // 等首帧；play() 的 promise 在后台标签可能永不 settle，超时兜底
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      video.addEventListener("loadeddata", finish);
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
      setTimeout(finish, 3000);
    });
    const srcW = video.videoWidth || settings.width;
    const srcH = video.videoHeight || settings.height;
    if (!srcW || !srcH) throw new Error("捕获流尺寸未知，无法截图");
    let sx = 0,
      sy = 0,
      sw = srcW,
      sh = srcH;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1)
        throw new Error("目标元素不可见（尺寸为 0），无法裁剪截图");
      const kx = srcW / window.innerWidth;
      const ky = srcH / window.innerHeight;
      sx = r.x * kx;
      sy = r.y * ky;
      sw = r.width * kx;
      sh = r.height * ky;
    }
    // 限制最大边长 + JPEG 有损压缩：结果要经消息通道回传（≤96KB/片），不压会撑爆分片
    const scale = MAX_SIDE > 0 ? Math.min(1, MAX_SIDE / Math.max(sw, sh)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const base64 = canvas
      .toDataURL("image/jpeg", opts.quality === undefined ? 0.72 : opts.quality)
      .split(",")[1];
    return { base64, w: canvas.width, h: canvas.height, mime: "image/jpeg" };
  } finally {
    video.remove();
  }
}

/* ---------- 控制台日志格式化 ---------- */

/**
 * 把 inject.js 捕获的日志环形缓冲格式化为文本（供模型直接阅读）。
 * @param {Array<{t: number, level: string, text: string}>} entries
 * @param {{ limit?: number, since?: number }} [opts] limit 默认 50（上限 500），since 增量拉取
 * @returns {{ text: string, latestTs: number, count: number }}
 */
export function formatConsoleEntries(entries, opts = {}) {
  const limit = Math.min(Math.max(1, opts.limit || 50), 500);
  const since = Number(opts.since) || 0;
  const filtered = (entries || []).filter((e) => e.t > since);
  const picked = filtered.slice(-limit);
  if (!picked.length) {
    return {
      text: `（暂无${since ? "该时间之后的" : ""}日志）`,
      latestTs: since,
      count: 0,
    };
  }
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const lines = picked.map((e) => {
    const d = new Date(e.t);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    return `[${t}] [${e.level}] ${e.text}`;
  });
  const latestTs = picked[picked.length - 1].t;
  const head =
    `${since ? "增量" : "最近"} ${picked.length} 条（最新 ts: ${latestTs}，可作 since 继续增量拉取）` +
    (filtered.length > picked.length ? `，共匹配 ${filtered.length} 条只取末尾 ${limit} 条` : "");
  return { text: head + "：\n" + lines.join("\n"), latestTs, count: picked.length };
}

/* ---------- 指令分发 ---------- */

const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const str = (v, dflt = "") => (typeof v === "string" ? v : dflt);

const findEl = (selector) => {
  const el =
    document.querySelector(selector) || deepQuery(selector) || null;
  if (!el) throw new Error("找不到元素: " + selector);
  return el;
};

/**
 * 执行一条调试指令。
 * @param {Object} opts
 * @param {string} opts.cmd 指令名（status/console/text/click/type/wait/dom/eval/shot）
 * @param {Object} opts.args 指令参数
 * @param {{ entries: Array }} opts.capture installConsoleCapture 的返回值（console 指令用）
 * @param {Object} [opts.info] 代理侧信息（status 指令附带：appName/agentBootAt 等）
 * @returns {Promise<{ ok: boolean, result?: string, error?: string, meta?: Object }>}
 *          result 一律为文本；shot 的 result 为 base64、meta.image 携带图片信息
 */
export async function runDebugCommand({ cmd, args = {}, capture, info = {} }) {
  try {
    switch (cmd) {
      case "status": {
        const entries = capture?.entries || [];
        const errors = entries.filter((e) => e.level === "error").length;
        const result = serializeValue({
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          appName: info.appName || "",
          agentBootAt: info.agentBootAt || 0,
          logs: entries.length,
          errors,
        });
        return { ok: true, result, meta: { errors } };
      }
      case "console": {
        if (!capture) throw new Error("控制台捕获不可用");
        const { text, latestTs, count } = formatConsoleEntries(capture.entries, {
          limit: num(args.limit, 50),
          since: num(args.since, 0),
        });
        return { ok: true, result: text, meta: { latestTs, count } };
      }
      case "text": {
        const target = str(args.selector) || "body";
        const el = findEl(target);
        const text = el.innerText ?? "";
        return {
          ok: true,
          result: text.length > 20000 ? text.slice(0, 20000) + "…[截断]" : text || "（空文本）",
        };
      }
      case "click": {
        const selector = str(args.selector);
        const el = findEl(selector);
        el.scrollIntoView({ block: "center" });
        el.click();
        return {
          ok: true,
          result: serializeValue({
            clicked: selector,
            tag: el.tagName,
            text: (el.innerText || "").slice(0, 100),
            rect: el.getBoundingClientRect().toJSON(),
            disabled: "disabled" in el ? el.disabled : undefined,
          }),
        };
      }
      case "type": {
        const selector = str(args.selector);
        const text = str(args.text);
        const el = findEl(selector);
        el.focus();
        if ("value" in el) el.value = text;
        else el.textContent = text; // contenteditable
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          result: serializeValue({
            typed: text,
            tag: el.tagName,
            value: "value" in el ? el.value : undefined,
          }),
        };
      }
      case "wait": {
        const selector = str(args.selector);
        const code = str(args.code);
        if (!selector && !code) throw new Error("selector 与 code 至少提供一个");
        if (selector && code) throw new Error("selector 与 code 只能二选一");
        const absent = args.absent === true;
        const limit = Math.min(num(args.timeoutMs, 10000), 60000);
        const t0 = Date.now();
        for (;;) {
          let ok;
          if (selector) {
            const found = !!(document.querySelector(selector) || deepQuery(selector));
            ok = absent ? !found : found;
          } else {
            try {
              ok = !!(await compileEval(code)());
            } catch (_) {
              ok = false; // 谓词抛错视为未成立，继续轮询
            }
          }
          if (ok)
            return {
              ok: true,
              result: serializeValue({ satisfied: true, elapsedMs: Date.now() - t0 }),
            };
          if (Date.now() - t0 > limit)
            throw new Error(
              `等待超时（${limit}ms）：${selector ? (absent ? "元素未消失: " : "元素未出现: ") + selector : "谓词未成立: " + code.slice(0, 200)}`,
            );
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      case "dom": {
        const selector = str(args.selector) || "body";
        const el = findEl(selector);
        return {
          ok: true,
          result: domSnapshot(el, {
            depth: num(args.depth, 4),
            maxNodes: num(args.maxNodes, 60),
          }),
        };
      }
      case "eval": {
        const code = str(args.code);
        if (!code.trim()) throw new Error("code 不能为空");
        const value = await compileEval(code)();
        return { ok: true, result: serializeValue(value) };
      }
      case "shot": {
        const selector = str(args.selector);
        const el = selector ? findEl(selector) : undefined;
        const shot = await captureScreenshot(el, {
          maxSide: num(args.maxSide, 1280),
          quality: num(args.quality, 0.72),
        });
        return {
          ok: true,
          result: shot.base64,
          meta: { image: { mime: shot.mime, w: shot.w, h: shot.h } },
        };
      }
      default:
        throw new Error(`未知调试指令: ${cmd}`);
    }
  } catch (err) {
    return { ok: false, error: (err && err.stack) || String(err) };
  }
}
