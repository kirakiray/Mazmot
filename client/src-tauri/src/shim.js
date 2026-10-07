// Mazmot Desktop Runtime — window.open 原生多窗口 shim
// 由 Tauri 以 initialization_script 注入每个 WebView（document-start，先于页面脚本）。
//
// Mazmot 打开应用的方式是 window.open(runUrl, "mazmot-app-<name>"[, features])，
// 依赖浏览器的「命名窗口复用」语义（同名窗口聚焦复用而非新开）。
// Tauri WebView 原生不支持 window.open，这里把它接管为原生多窗口：
//   - 同源 URL（localhost/127.0.0.1 的 30031/30032）→ 原生 WebviewWindow
//   - 外部 http(s) → 系统默认浏览器
// 返回的假窗口对象只需支持 Mazmot 用到的三个能力：
//   closed（实时）、focus()、close()（见 main/lib/app-status.js）
// 跨窗口通信走 BroadcastChannel / localStorage，不依赖 window 层消息。

(function () {
  if (window.__mazmotRuntime) return;

  var INV =
    (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
    (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
  if (!INV) {
    // IPC 不可用（权限/版本异常）时静默退化为浏览器默认行为
    return;
  }
  var MY_LABEL =
    (window.__TAURI_INTERNALS__ &&
      window.__TAURI_INTERNALS__.metadata &&
      window.__TAURI_INTERNALS__.metadata.currentWindow &&
      window.__TAURI_INTERNALS__.metadata.currentWindow.label) ||
    "main";

  var INTERNAL_HOSTS = { localhost: 1, "127.0.0.1": 1, "[::1]": 1 };
  var INTERNAL_PORTS = { 30031: 1, 30032: 1, 30033: 1, 30034: 1, 30035: 1, 30036: 1 };
  var registry = new Map(); // 命名窗口注册表：name -> 假窗口对象

  function resolveUrl(raw) {
    try {
      var u = new URL(raw == null ? "" : String(raw), location.href);
      var port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      var internal =
        u.protocol === "http:" &&
        INTERNAL_HOSTS[u.hostname] &&
        INTERNAL_PORTS[port];
      return { url: u.href, internal: internal };
    } catch (err) {
      return { url: String(raw || ""), internal: false };
    }
  }

  function parseFeatures(f) {
    var out = {};
    if (!f) return out;
    String(f).split(",").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) {
        out[part.trim()] = true;
      } else {
        out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
    });
    return out;
  }

  function makeFakeWindow(name) {
    var w = {
      name: name,
      closed: false,
      opener: window,
      __label: null,
      __pendingClose: false,
      __url: null,
      close: function () {
        if (w.closed) return;
        if (w.__label) {
          INV("runtime_close_window", { label: w.__label }).catch(function () {});
        } else {
          w.__pendingClose = true; // 原生窗口尚未建好，建好后立刻关
        }
        w.closed = true;
        if (w.name) registry.delete(w.name);
      },
      focus: function () {
        if (!w.closed && w.__label) {
          INV("runtime_focus_window", { label: w.__label }).catch(function () {});
        }
      },
      // Mazmot 不用 window 层 postMessage（跨窗口走 BroadcastChannel），留空实现
      postMessage: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
    return w;
  }

  function openExternal(url) {
    INV("runtime_open_external", { url: url }).catch(function () {});
  }

  window.open = function (url, name, features) {
    try {
      var target = url == null ? "" : String(url);
      var named =
        name &&
        name !== "_blank" &&
        name !== "_self" &&
        name !== "_parent" &&
        name !== "_top"
          ? String(name)
          : "";

      // _self 家族：当前窗口导航（同源交回浏览器默认行为，on_navigation 兜外链）
      if (name === "_self" || name === "_parent" || name === "_top") {
        var selfUrl = resolveUrl(target);
        if (target && !selfUrl.internal) {
          openExternal(selfUrl.url);
          return null;
        }
        location.href = selfUrl.url;
        return null;
      }

      var resolved = resolveUrl(target);

      // 外部链接：系统浏览器打开；返回 closed 恒真的假窗口，
      // 避免调用方把「窗口引用为空」当成弹窗被拦截而报错
      if (!resolved.internal) {
        if (target) openExternal(resolved.url);
        var ext = makeFakeWindow(named);
        ext.closed = true;
        return ext;
      }

      // 命名窗口复用：window.open("", name) 只取引用/聚焦，不触发导航（对齐浏览器语义）
      var existing = named ? registry.get(named) : null;
      if (existing && !existing.closed) {
        if (
          target &&
          target !== "" &&
          resolved.url !== existing.__url &&
          existing.__label
        ) {
          existing.__url = resolved.url;
          INV("runtime_navigate_window", {
            label: existing.__label,
            url: resolved.url,
          }).catch(function () {});
        }
        existing.focus();
        return existing;
      }
      if (existing) registry.delete(named);

      var f = parseFeatures(features);
      var w = makeFakeWindow(named);
      w.__url = target === "" ? null : resolved.url;

      var winName = named || "win-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
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
        .then(function (label) {
          w.__label = label;
          if (w.__pendingClose) {
            INV("runtime_close_window", { label: label }).catch(function () {});
          }
        })
        .catch(function () {
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
    // 原生窗口被用户关掉时由 Rust 侧 eval 回调
    _notifyClosed: function (name) {
      var w = registry.get(name);
      if (w) {
        w.closed = true;
        registry.delete(name);
      }
    },
  };

  // target="_blank" 锚点：外链走系统浏览器，内链开原生窗口（浏览器等价行为）
  document.addEventListener(
    "click",
    function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      if (a.getAttribute("target") !== "_blank") return;
      var resolved = resolveUrl(a.href);
      e.preventDefault();
      if (resolved.internal) {
        window.open(resolved.url, "_blank");
      } else {
        openExternal(resolved.url);
      }
    },
    true
  );

  // 窗口标题跟随页面 document.title（浏览器窗口语义）
  var lastTitle = "";
  setInterval(function () {
    var t = document.title;
    if (t && t !== lastTitle) {
      lastTitle = t;
      INV("runtime_set_window_title", { title: t }).catch(function () {});
    }
  }, 500);

  // 启动探测：IPC 可用性写进 runtime 日志（stderr），便于排查远端源权限问题
  INV("runtime_probe")
    .then(function (info) {
      console.info("[mazmot-runtime] 就绪", info);
      INV("runtime_log", { message: "probe ok " + JSON.stringify(info) }).catch(
        function () {}
      );
    })
    .catch(function (err) {
      console.warn("[mazmot-runtime] IPC 不可用，多窗口能力降级", err);
      INV("runtime_log", {
        message: "ipc unavailable: " + err,
      }).catch(function () {});
    });
})();
