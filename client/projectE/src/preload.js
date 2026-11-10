// Mazmot Desktop Runtime (Electron) — preload 注入层
//
// 每个 BrowserWindow 都加载本文件（document-start，先于页面脚本）。职责：
//   1. 从启动参数取当前窗口 label，供 shim 标记 opener；
//   2. 用 ipcRenderer.invoke 实现与 projectR 同名的 runtime_* 命令；
//   3. 在页面上下文安装 window.open 多窗口 shim。
//
// 安全模型说明：站点是壳自己从本地静态服务器伺服的可信内容，导航被限制在
// 回环源（见 src/main.js），因此这里用 contextIsolation:false + sandbox:false
// 让 preload 与页面同 world，直接接管 window.open（与 Tauri 的
// initialization_script 注入语义一致）。nodeIntegration 保持关闭，
// 页面拿不到 require / Node API。

"use strict";

const { ipcRenderer } = require("electron");
const { installShim } = require("./shim");

function readWindowLabel() {
  const prefix = "--mazmot-window-label=";
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "main";
}

window.__MAZMOT_WINDOW_LABEL__ = readWindowLabel();

installShim({
  invoke: (command, args) =>
    ipcRenderer.invoke("runtime:invoke", command, args || {}),
  onClosed: (handler) => {
    ipcRenderer.on("mazmot:closed", (_event, name) => handler(name));
  },
});
