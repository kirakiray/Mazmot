let version = "";
if (globalThis.serviceWorker) {
  // 在 chrome 和 safari 内
  // 从 serviceWorker.scriptURL 上获取 v 参数版本
  const urlParams = new URLSearchParams(
    new URL(serviceWorker.scriptURL).search,
  );

  version = urlParams.get("v") || "";
} else {
  // firefox内没有serviceWorker，则从 location 上获取 v 参数版本
  const urlParams = new URLSearchParams(new URL(location.href).search);
  version = urlParams.get("v") || "";
}

// NoneOS Core SW（处理 /nos/、/gh/、/npm/ 等命名空间）
const isLocalhost =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (isLocalhost) {
  try {
    // 本地 dev Core 服务（localhost:3002）
    importScripts("http://localhost:3002/sw/dist.js");
  } catch (err) {
    // 本地 dev Core 服务未启动（如 CI 环境），回退到线上 Core
    importScripts("https://core.noneos.com/sw/dist.js?v=" + version);
  }
} else {
  importScripts("https://core.noneos.com/sw/dist.js?v=" + version);
}

// 宿主离线缓存（index.html + mz/，清单 /cache-manifest.json）
// 必须在 core dist.js 之后加载，fetch 监听器处于兜底位
importScripts("/mz/sw/host-cache.js");
