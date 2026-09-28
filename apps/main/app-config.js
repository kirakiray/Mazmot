export const home = "./home.html";

// 回到前台时 ping 根 SW 检查宿主缓存更新（SW 侧 3s 防抖，见 mz/sw/host-cache.js）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    navigator.serviceWorker?.controller?.postMessage({ type: "mz-cache-check" });
  }
});


export const pageAnime = {
  current: {
    opacity: 1,
    transform: "translate(0, 0)",
  },
  next: {
    opacity: 0,
    transform: "translate(30px, 0)",
  },
  previous: {
    opacity: 0,
    transform: "translate(-30px, 0)",
  },
};
