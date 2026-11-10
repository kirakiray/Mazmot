# Mazmot Desktop Runtime — Electron（client/projectE/）

用 [Electron](https://www.electronjs.org) 把 Mazmot 静态站点封装成桌面应用运行时，能力与隔壁 [`../projectR/`](../projectR/README.md)（Tauri 2）对齐：原生多窗口、`window.open` 接管、外链分流、单实例、内置站点服务。站点代码**零补丁**。

> AI 代理开发请先读本目录 [`AGENTS.md`](AGENTS.md)（硬性规范）与 [`CONTEXT.md`](CONTEXT.md)（架构活文档：启动流程 / shim 契约 / IPC 速查 / 踩坑索引）。

## 为什么是「内置静态服务器」而不是自定义协议

Mazmot 的运行时依赖 **NoneOS Core Service Worker**（提供 `/nos/*`、`/gh/*`、`/$虚拟目录/*`）。Electron 的 `file://` 或自定义协议源都**无法注册 Service Worker**，所以壳在主进程内置了一个回环 HTTP 静态服务器（[src/static-server.js](src/static-server.js)），BrowserWindow 指向真实的 `http://localhost` 源——SW、IndexedDB、BroadcastChannel 等平台能力与浏览器完全一致。

端口沿用仓库本地开发约定（`scripts/static.js`）与 projectR 保持一致：

| 端口 | 用途 |
| ---- | ---- |
| 30031 | 主站 origin（主窗口；被占用时依次回退 30033-30036） |
| 30032 | 隔离域 origin（conjure 预览 bridge，站点常量 `BRIDGE_ORIGIN` 硬编码指向它） |

> 主站端口落定前会依次尝试候选端口并绑定 `127.0.0.1` + `[::1]` 双栈；origin（含端口）跨启动保持稳定，SW 缓存与 IndexedDB 数据才不会丢。

## 站点资源来源

- **dev（`npm run dev`）**：直接伺服仓库根目录，站点源码改动刷新即生效。
- **release（`npm run build`）**：`package.json` 的 `build.extraResources` 把 `index.html`、`404.html`、`favicon.ico`、`sw.js`、`sw/`、`main/`、`apps/`、`mz/`、`official-apps/`、`bridge/`、`cache-manifest.json`、`locale-text.json` 复制到 `Contents/Resources/site/`。
- **`MAZMOT_WEB_ROOT` 环境变量**：指向任意一份站点静态文件，优先级最高。

## 多窗口 Runtime 行为（src/shim.js + src/preload.js）

Electron 原生 `window.open` 会创建未受控窗口，preload 在 document-start 把 `window.open` 接管为 IPC 驱动的原生窗口，语义对齐浏览器：

- `window.open(同源URL, "mazmot-app-<name>")` → 原生 `BrowserWindow`；同名窗口复用/聚焦，不重复开。
- `window.open(url, name, "width=…,height=…,left=…,top=…")` → 按 features 设定窗口尺寸与位置。
- `window.open("", name)` → 只取已开窗口引用并聚焦，不触发导航（conjure 依赖该语义）。
- 返回的假窗口支持 Mazmot 用到的 `closed`（实时，含用户手关）、`focus()`、`close()`。
- 外部 http(s)（文档、帮助链接等）→ 系统默认浏览器；页内导航由主进程 `will-navigate` / `will-redirect` 同样分流。
- 窗口标题跟随页面 `document.title`。
- macOS 使用 `titleBarStyle: "hiddenInset"`（无系统标题栏、红绿灯浮在左上），shim 注入 40px 透明拖拽热区与内容下移，与 projectR 的 Overlay 顶栏观感一致。

## IPC 与安全边界

- 渲染进程 `nodeIntegration: false`、`sandbox: false`、`contextIsolation: false`：站点是壳自己从本地静态服务器伺服的可信内容，preload 与页面同 world 才能接管 `window.open`（等价 Tauri 的 initialization_script）。
- 页面只能通过 `window.__mazmotRuntime` 的封装调用 IPC，拿不到 `require` / Node API。
- 主进程对每个 IPC 调用做**调用方 origin 校验**（只接受 `localhost` / `127.0.0.1` / `[::1]` 的 30031-30036），外部页面即使被加载也无法调用。
- 导航默认拦截非回环 http(s) 并转系统浏览器；`setWindowOpenHandler` 兜底拒绝一切 Chromium 自建窗口。

命令与 projectR 一一对应：`runtime_open_window` / `runtime_navigate_window` / `runtime_focus_window` / `runtime_close_window` / `runtime_set_window_title` / `runtime_open_external` / `runtime_probe` / `runtime_log`。

## 其它行为

- **单实例**：二次启动聚焦已有主窗口（`requestSingleInstanceLock`）。
- **关主窗即退出**整个 runtime（含所有应用窗口）。
- **404 语义与 CF Pages 对齐**：未命中路径返回 404 状态 + 顶层 `404.html`，不做 SPA 回退；目录缺尾斜杠 308 补全。
- 静态响应带 `ETag` 协商缓存（304）与单区间 `Range`（206）；Host 头校验防 DNS rebinding。
- `X-Mazmot-Runtime` 响应头标记本服务器版本。

## 开发

```bash
cd client/projectE
npm install        # 首次安装（Electron 二进制较大，网络差时先设代理）
npm run dev        # 调试运行（伺服仓库根，站点改动刷新即生效）
npm run build      # 打包 DMG（electron-builder，产物在 dist/）
npm run build:dir  # 只出未压缩 .app，快速验证
npm run test       # 静态服务器单元测试（Node 原生 test runner）
npm run icon       # 从 projectR 同步图标并生成 icns
```

受限环境（沙箱 / 只读用户目录）额外说明：

- `npm run dev -- --no-sandbox`：Chromium 子进程在受限沙箱里起不来时使用。
- `MAZMOT_USER_DATA=<可写目录> npm run dev`：userData 不可写会导致 app ready 前 SIGTRAP。
- `npm run build:dir:local`：复用 `node_modules/electron/dist`，跳过 electron-builder 下载缓存（受限环境无 `~/Library/Caches` 写权限时用）。

如果安装后 `node_modules/electron/dist` 为空（npm 11 的 install-scripts 审核跳过了 postinstall），手动补装二进制：

```bash
# 网络需要代理时先 export https_proxy/http_proxy，并让 @electron/get 读取代理
ELECTRON_GET_USE_PROXY=1 electron_config_cache=/tmp/mazmot-electron-cache \
  node node_modules/electron/install.js
```

- 启动日志（stderr）：`静态服务器已启动` ×4（main / bridge 各 v4+v6）→ `主窗口就绪` → `[mazmot-runtime][web] probe ok {...}`。
- 首次启动需要联网安装 NoneOS Core（从 core.noneos.com 拉 SW 核心），之后离线可用——与网页版行为一致。
- WebView 数据（SW / IndexedDB / localStorage）位于 `~/Library/Application Support/Mazmot/`（macOS），删除即重置运行时。
- `MAZMOT_DEVTOOLS=1 npm run dev` 自动打开 DevTools。

## 打包与已知限制

- `npm run build` 产出 `dist/Mazmot-<version>-arm64.dmg`（macOS 当前架构）；`npm run build:dir` 只出未压缩 `.app`，适合快速验证。
- macOS 首次打开未签名包需右键「打开」或在系统设置里放行。
- DMG 由 `hdiutil` 创建，需要终端具备创建磁盘映像的权限；受限沙箱里会报 `hdiutil: create failed - 操作不被允许`，此时用 `npm run build:dir` 出 `.app` 验证即可。
- 主站端口被占用回退后，该次启动 origin 变化会导致该次看不到历史数据（正常情况下端口稳定）。
- 30032 被占用时仅 conjure 隔离预览降级，主站不受影响。
- Windows / Linux 打包需在对应平台或 CI 上执行；Electron 自带 Chromium，无需系统额外 WebView 运行时（与 projectR 的 WebView2 依赖不同）。
