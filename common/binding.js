// Mazmot 应用与主页面之间的存活状态绑定脚本
// 每个由 Mazmot 创建的应用的 index.html 通过 <script src="/common/binding.js"> 引入本文件
// 主页面通过 BroadcastChannel 与子应用互相通信，从而在主页面刷新后依然能感知已打开的应用

(function () {
  var CHANNEL_NAME = "mazmot-app-status";

  try {
    var bc = new BroadcastChannel(CHANNEL_NAME);

    // 从 location.pathname 推导出应用的挂载路径，例如：
    //   /$mount-xxx/index.html => $mount-xxx
    //   /$mount-xxx/           => $mount-xxx
    var path = location.pathname
      .replace(/^\//, "")
      .replace(/\/index\.html$/, "")
      .replace(/\/$/, "");

    var send = function (type) {
      try {
        bc.postMessage({ type: type, path: path });
      } catch (e) {}
    };

    bc.addEventListener("message", function (event) {
      var msg = event && event.data;
      if (msg && msg.type === "ping") send("pong");
    });

    // 上线通知
    send("alive");

    // 页面关闭 / 刷新前通知
    window.addEventListener("pagehide", function () {
      send("bye");
    });
  } catch (err) {
    console.warn("[mazmot binding] 初始化失败：", err);
  }
})();
