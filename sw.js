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

// 开发者模式（dev-bridge 脚本注入）总开关
// 允许两种环境：
// 1. 本地 localhost 且端口为 30033 - 30040
// 2. https 下的 dev1.mazmot.noneos.com ~ dev6.mazmot.noneos.com
{
  const { hostname, port, protocol } = new URL(location.href);
  const portNum = Number(port);
  const isLocalDev = hostname === "localhost" && portNum >= 30033 && portNum <= 30040;
  const isRemoteDev =
    protocol === "https:" &&
    /^dev[1-6]\.mazmot\.noneos\.com$/.test(hostname);
  globalThis.DEV_BRIDGE_ENABLED = isLocalDev || isRemoteDev;
}

// if (location.host.includes("localhost")) {
//   try {
//     importScripts("http://localhost:3002/sw/dist.js");
//   } catch (err) {
//     // 本地 dev Core 服务（localhost:3002）未启动（如 CI 环境），回退到线上 Core
//     importScripts("https://core.noneos.com/sw/dist.js?v=" + version);
//   }
// } else {
importScripts("https://core.noneos.com/sw/dist.js?v=" + version);
// }
