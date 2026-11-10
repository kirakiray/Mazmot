// Mazmot Desktop Runtime (Electron) — window.open 原生多窗口 shim
//
// 由 src/preload.js 在 document-start 注入页面上下文（preload 与页面同 world），
// 职责与 projectR（Tauri）的 src-tauri/src/shim.js 一致：
//   - 同源 URL（localhost/127.0.0.1 的 30031-30036）→ 原生 BrowserWindow
//   - 外部 http(s) → 系统默认浏览器
//   - window.open("", name) → 只取已有窗口引用并聚焦，不触发导航
//   - 返回的假窗口支持 Mazmot 用到的 closed（实时，含用户手关）/ focus() / close()
//
// 跨窗口通信仍走 BroadcastChannel / localStorage，不依赖 window 层消息。
// 站点零补丁：这里只接管浏览器语义，不改站点任何代码。

"use strict";

const INTERNAL_HOSTS = { localhost: 1, "127.0.0.1": 1, "[::1]": 1 };
const INTERNAL_PORTS = {
  30031: 1,
  30032: 1,
  30033: 1,
  30034: 1,
  30035: 1,
  30036: 1,
};

function resolveUrl(raw) {
  try {
    const u = new URL(raw == null ? "" : String(raw), location.href);
    const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
    const internal =
      u.protocol === "http:" &&
      Boolean(INTERNAL_HOSTS[u.hostname]) &&
      Boolean(INTERNAL_PORTS[port]);
    return { url: u.href, internal, protocol: u.protocol };
  } catch {
    return { url: String(raw || ""), internal: false, protocol: "" };
  }
}

function parseFeatures(features) {
  const out = {};
  if (!features) return out;
  String(features)
    .split(",")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) out[part.trim()] = true;
      else out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
  return out;
}

/**
 * @param {{invoke: (command: string, args?: object) => Promise<any>,
 *          onClosed?: (handler: (name: string) => void) => void}} bridge
 */
function installShim({ invoke, onClosed }) {
  if (window.__mazmotShim) return;

  const INV = (command, args) => Promise.resolve(invoke(command, args));
  const MY_LABEL = window.__MAZMOT_WINDOW_LABEL__ || "main";
  const registry = new Map(); // 命名窗口注册表：name -> 假窗口对象

  function makeFakeWindow(name) {
    const w = {
      name,
      closed: false,
      opener: window,
      __label: null,
      __pendingClose: false,
      __url: null,
      close() {
        if (w.closed) return;
        if (w.__label) {
          INV("runtime_close_window", { label: w.__label }).catch(() => {});
        } else {
          w.__pendingClose = true; // 原生窗口尚未建好，建好后立刻关
        }
        w.closed = true;
        if (w.name) registry.delete(w.name);
      },
      focus() {
        if (!w.closed && w.__label) {
          INV("runtime_focus_window", { label: w.__label }).catch(() => {});
        }
      },
      // Mazmot 不走 window 层 postMessage（跨窗口走 BroadcastChannel）
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    };
    return w;
  }

  function openExternal(url) {
    INV("runtime_open_external", { url }).catch(() => {});
  }

  window.open = function (url, name, features) {
    try {
      const target = url == null ? "" : String(url);
      const named =
        name && !["_blank", "_self", "_parent", "_top"].includes(name)
          ? String(name)
          : "";

      // _self 家族：当前窗口导航（同源交回页面，跨域走系统浏览器）
      if (name === "_self" || name === "_parent" || name === "_top") {
        const selfUrl = resolveUrl(target);
        if (target && !selfUrl.internal) {
          openExternal(selfUrl.url);
          return null;
        }
        location.href = selfUrl.url;
        return null;
      }

      const resolved = resolveUrl(target);

      // 外部链接：系统浏览器打开；返回 closed 恒真的假窗口，
      // 避免调用方把「窗口引用为空」当成弹窗被拦截而报错
      if (!resolved.internal) {
        if (target) openExternal(resolved.url);
        const ext = makeFakeWindow(named);
        ext.closed = true;
        return ext;
      }

      // 命名窗口复用：window.open("", name) 只取引用/聚焦，不触发导航
      const existing = named ? registry.get(named) : null;
      if (existing && !existing.closed) {
        if (
          target !== "" &&
          resolved.url !== existing.__url &&
          existing.__label
        ) {
          existing.__url = resolved.url;
          INV("runtime_navigate_window", {
            label: existing.__label,
            url: resolved.url,
          }).catch(() => {});
        }
        existing.focus();
        return existing;
      }
      if (existing) registry.delete(named);

      const f = parseFeatures(features);
      const w = makeFakeWindow(named);
      w.__url = target === "" ? null : resolved.url;

      const winName =
        named || `win-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      INV("runtime_open_window", {
        url: target === "" ? "about:blank" : resolved.url,
        name: winName,
        width: f.width ? Number(f.width) : null,
        height: f.height ? Number(f.height) : null,
        x: f.left !== undefined && f.left !== "" ? Number(f.left) : null,
        y: f.top !== undefined && f.top !== "" ? Number(f.top) : null,
        resizable: f.resizable !== undefined ? String(f.resizable) !== "no" : true,
        opener: MY_LABEL,
      })
        .then((label) => {
          w.__label = label;
          if (w.__pendingClose) {
            INV("runtime_close_window", { label }).catch(() => {});
          }
        })
        .catch(() => {
          w.closed = true;
        });

      if (named) registry.set(named, w);
      return w;
    } catch (err) {
      console.error("[mazmot-runtime] window.open shim 出错", err);
      return null;
    }
  };

  window.__mazmotRuntime = {
    // 原生窗口被用户关掉时由主进程 IPC 回调
    _notifyClosed(name) {
      const w = registry.get(name);
      if (w) {
        w.closed = true;
        registry.delete(name);
      }
    },
  };

  if (typeof onClosed === "function") {
    onClosed((name) => window.__mazmotRuntime._notifyClosed(name));
  }

  window.__mazmotShim = true;

  // target="_blank" 锚点：外链走系统浏览器，内链开原生窗口（浏览器等价行为）
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      if (a.getAttribute("target") !== "_blank") return;
      const resolved = resolveUrl(a.href);
      e.preventDefault();
      if (resolved.internal) window.open(resolved.url, "_blank");
      else openExternal(resolved.url);
    },
    true,
  );

  // 窗口标题跟随页面 document.title（浏览器窗口语义）
  let lastTitle = "";
  setInterval(() => {
    const t = document.title;
    if (t && t !== lastTitle) {
      lastTitle = t;
      INV("runtime_set_window_title", { title: t }).catch(() => {});
    }
  }, 500);

  // ---- 顶部透明拖拽区（仅 macOS：BrowserWindow titleBarStyle=hiddenInset，
  // 无系统标题栏、无自绘 bar——只铺一块看不见的拖拽热区，红绿灯浮在左上，
  // 页面内容经 padding 下移让出顶部无元素区域）。
  // 与 Tauri 版的区别：Electron 用 -webkit-app-region: drag 承担拖拽/双击最大化。
  const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
  function injectTitlebar() {
    if (!IS_MAC || document.getElementById("mazmot-titlebar")) return;
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", injectTitlebar, {
        once: true,
      });
      return;
    }
    const TB_H = 40;

    const shellStyle = document.createElement("style");
    shellStyle.textContent =
      ":root{--mazmot-tb:" +
      TB_H +
      "px}" +
      "body{padding-top:var(--mazmot-tb) !important;box-sizing:border-box !important}";
    (document.head || document.documentElement).appendChild(shellStyle);

    const dragStrip = document.createElement("div");
    dragStrip.id = "mazmot-titlebar";
    dragStrip.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "height:" + TB_H + "px",
      "z-index:2147483647",
      "user-select:none",
      "-webkit-user-select:none",
      "-webkit-app-region:drag",
    ].join(";");
    // 挂在 <html> 下而非 body：ofa 应用可能重写 body，避免热区被清掉
    document.documentElement.appendChild(dragStrip);
  }
  injectTitlebar();

  // 启动探测：IPC 可用性写进 runtime 日志（stderr），便于排查 IPC 异常
  INV("runtime_probe")
    .then((info) => {
      console.info("[mazmot-runtime] 就绪", info);
      INV("runtime_log", {
        message: "probe ok " + JSON.stringify(info),
      }).catch(() => {});
    })
    .catch((err) => {
      console.warn("[mazmot-runtime] IPC 不可用，多窗口能力降级", err);
      INV("runtime_log", { message: "ipc unavailable: " + err }).catch(() => {});
    });
}

module.exports = { installShim };
