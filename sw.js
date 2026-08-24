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

// 启用宿主项目离线缓存（host-cache）
// SW 加载时读取 /host-cache.json，将 files 列表预缓存到 OPFS，实现离线访问
globalThis.HOST_CACHE_CONFIG = true; // 开启离线缓存

// if (location.host.includes("localhost")) {
//   importScripts("http://localhost:3002/sw/dist.js");
// } else {
importScripts("https://core.noneos.com/sw/dist.js?v=" + version);
// }
