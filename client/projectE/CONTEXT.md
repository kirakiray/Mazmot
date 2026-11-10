# Mazmot 桌面运行时 Context（client/projectE/）

Electron 桌面壳：把 Mazmot 静态站点封装为原生多窗口的应用运行时。本文件是本目录的**活文档**，记录当前架构与活跃流程；开发规范见 [`AGENTS.md`](AGENTS.md)，面向人的使用说明见 [`README.md`](README.md)。

> 与 `client/projectR`（Tauri 2 壳）能力对等，可对照阅读；差异集中在「注入方式 / 顶栏拖拽 / 打包工具 / 数据目录」，见文末「与 projectR 的差异」。

## 架构总览

```
┌─ BrowserWindow（每个窗口一个，origin = http://localhost:30031|30032）
│    站点静态文件（index.html 引导 → NoneOS Core SW 接管 /nos/* /gh/* /$xxx/*）
│    preload.js → shim.js（页面同 world）：window.open → ipcRenderer.invoke
│                              ▲ ipcRenderer.on("mazmot:closed")     │ IPC
├─ 主进程（src/）────────────────────────────────────────────────────┘
│    main.js：起静态服务器 → 建主窗口 → 导航分流 → 单实例/退出策略 → runtime_* 分发
│    static-server.js：Node http 回环服务器（30031 主站 / 30032 隔离域，IPv4+IPv6）
│    preload.js / shim.js：注入层（window.open / 标题同步 / 顶栏热区）
└─ 站点静态文件：dev = 仓库根（实时）；release = Contents/Resources/site；MAZMOT_WEB_ROOT 可覆盖
```

核心设计决策：**不用 `file://` / 自定义协议**（这类 origin 下 Service Worker 无法注册，而 NoneOS Core 依赖 SW），改为壳内置回环 HTTP 服务器 + 真实 `http://localhost` 源，SW / IndexedDB / BroadcastChannel 等平台能力与浏览器完全一致。

## 目录树

```
client/projectE/
├── AGENTS.md                 # 本目录开发规范（硬性规则清单）
├── CONTEXT.md                # 本文件（架构活文档）
├── README.md                 # 使用说明（开发/打包/已知限制）
├── package.json              # npm 脚本 + electron-builder 配置（extraResources 站点清单）
├── .gitignore                # node_modules / dist
├── assets/icon.png           # 运行时图标（从 projectR 同步，勿手改）
├── build/
│   ├── icon.png              # electron-builder 图标源（从 projectR 同步）
│   └── icon.icns             # macOS 打包图标（npm run icon 由 icon.png 生成）
├── scripts/
│   ├── launch.js             # dev/start 启动器（剔除 ELECTRON_RUN_AS_NODE 后拉起 Electron）
│   ├── sync-version.js       # 根 package.json 版本 → 本目录 package.json / lock
│   └── sync-icon.js          # projectR 图标 → assets + build（含 icns）
├── src/
│   ├── main.js               # 主进程：服务器/窗口/IPC/导航分流/生命周期
│   ├── static-server.js      # 回环静态服务器 + HTTP 语义（14 个 Node 单测）
│   ├── preload.js            # document-start 注入：窗口 label + IPC 桥 + 安装 shim
│   └── shim.js               # window.open 多窗口 shim（页面上下文）
└── test/
    └── static-server.test.js # npm test（node --test）
```

## 启动流程（src/main.js）

1. `app.setName("Mazmot")`：固定 userData 目录名（`~/Library/Application Support/Mazmot`），保证 SW / IndexedDB 跨启动稳定。
2. `requestSingleInstanceLock()`：拿不到锁直接退出；二次启动聚焦已有主窗口。
3. `app.whenReady()` → `resolveWebRoot()`：`MAZMOT_WEB_ROOT` → 打包 `resources/site` → dev 仓库根（`src/../../..`）。
4. 主站端口按 `MAIN_PORTS`（30031 → 30033/30034/30035/30036）依次尝试：每个 `StaticServer` 先绑 `127.0.0.1` 取实际端口，再以同端口补绑 `::1`（双栈同 origin）。
5. 隔离域固定 `BRIDGE_PORT = 30032`，失败只降级 conjure 预览。
6. 建主窗口 `main`：`http://localhost:<mainPort>/`，1200×800 / 最小 860×600，`titleBarStyle: hiddenInset`（macOS）。
7. 主窗口 `closed` → `app.quit()`（关主窗 = 退出整个 runtime，含全部应用窗口）。
8. `will-quit` 时关闭静态服务器（双栈）。

## 静态服务器行为规格（src/static-server.js）

| 行为 | 规格 |
| ---- | ---- |
| 监听 | 每端口 IPv4+IPv6 双栈各一个 `http.Server`，共用同一请求处理器 |
| 方法 | GET / HEAD，其余 405 |
| Host 校验 | 仅放行 `localhost` / `127.0.0.1` / `[::1]`（带不带端口均可），其余 403（防 DNS rebinding） |
| 路径安全 | percent 解码后拒绝 `..` 段；`realpath` 后必须仍在站点根内 |
| 目录 | 有 `index.html` → 目录 URL 缺尾斜杠时 308 补全（页面相对路径依赖目录形态）；无 index → 404 |
| 404 | 返回 **404 状态 + 顶层 `404.html` 内容**（对齐 CF Pages，禁止 SPA 回退 200 掩盖缺失） |
| 缓存 | `Cache-Control: no-cache` + ETag（mtime 秒-len 十六进制）；`If-None-Match` 命中回 304 |
| Range | 单区间 `bytes=a-b`（含 `bytes=-N`），206 + `Content-Range`；多区间不支持退回 200 |
| 标记头 | 全部响应带 `X-Mazmot-Runtime: <version>`（308 除外，与 Rust 侧一致） |

## window.open shim 契约（src/shim.js）

`preload.js` 在 document-start 运行（`contextIsolation: false`，与页面同 world），安装 shim。**契约方**：站点 `main/lib/app-status.js` 依赖返回窗口的 `closed`（实时）/ `focus()` / `close()` 三能力追踪应用存活。

| 调用形态 | 行为 |
| ---- | ---- |
| `open(同源URL, name)` | 无同名窗口 → `runtime_open_window` 开 BrowserWindow；同名存活 → 聚焦（URL 不同则先 `runtime_navigate_window`） |
| `open(url, name, features)` | 解析 `width/height/left/top/resizable` 设定原生窗口几何 |
| `open("", name)` | 只取引用并聚焦，**不触发导航**（对齐浏览器语义，conjure 依赖） |
| `open(外链, ...)` | 系统默认浏览器；返回 `closed` 恒真的假窗口（调用方以此区分「被拦截」报错路径） |
| `_self/_parent/_top` | 当前窗口导航；外链转系统浏览器 |
| 返回的假窗口 | `closed`（用户手关时由主进程 `webContents.send("mazmot:closed", name)` 置真）、`focus()`、`close()`（含窗口未建完的 pendingClose 兜底） |

同源判定：host ∈ {localhost, 127.0.0.1, [::1]} 且端口 ∈ 30031-30036。`target="_blank"` 锚点点击捕获走同一分流；外部 http(s) 由主进程 `will-navigate` / `will-redirect` 兜底分流。窗口标题跟随 `document.title`（500ms 轮询 → `runtime_set_window_title`）。启动时 `runtime_probe` 探测结果回传 `runtime_log` 写 stderr——**这是 IPC 是否可用的唯一外部观测点**。

## 顶部透明拖拽区（macOS hiddenInset）

所有窗口（主窗口 + `runtime_open_window` 创建的应用窗口）使用 `titleBarStyle: "hiddenInset"` + `trafficLightPosition {x:16,y:18}`：无系统标题栏，页面内容顶到窗口边缘，红绿灯浮在左上。shim 注入的顶部处理（仅 macOS；`runtime_probe` 返回 `titlebar: "overlay"`）：

- **无可见 bar**：只铺一块 40px 的透明热区（`-webkit-app-region: drag`，z-index 最大，挂 `<html>` 下防 ofa 重写 body 清掉），提供拖拽与双击最大化（Electron 对 drag 区域内建处理）。
- **内容下移**：`:root` 注入 `--mazmot-tb: 40px` + `body { padding-top: var(--mazmot-tb); box-sizing: border-box }`，让页面自身元素避开热区与红绿灯。站点全站无 `100vh` 布局（统一 `height:100%` 链 + overflow:hidden），不破坏任何页面。
- **已知取舍**：顶部 40px 区域是拖拽热区，页面自身在该区域放置的元素会被热区挡住点击（当前站点顶部均为留白，无冲突）。

## 命令速查（src/main.js 的 COMMANDS，全部 `runtime_*`）

| 命令 | 参数（camelCase） | 说明 |
| ---- | ---- | ---- |
| `runtime_open_window` | url/name/width/height/x/y/resizable/opener | 开应用窗口，返回 label（`mazmot-<name>-<seq>`）；窗口 closed 时向 opener 发 `mazmot:closed` |
| `runtime_navigate_window` | label/url | 已有窗口导航（conjure 同名复用路径） |
| `runtime_focus_window` | label | restore + show + focus |
| `runtime_close_window` | label | 关闭窗口 |
| `runtime_set_window_title` | title | 当前窗口标题同步（按 `event.sender` 定位窗口） |
| `runtime_open_external` | url | `shell.openExternal`（只允许 http/https） |
| `runtime_probe` | — | 返回 `{version, os, titlebar, mainPort, bridgePort}` |
| `runtime_log` | message | 渲染进程 → stderr 日志通道 |

所有调用统一走 `ipcMain.handle("runtime:invoke")`，入口先过 `assertTrustedSender`（只接受回环源），再按 `COMMANDS` 分发；未知命令直接 reject。

## IPC 与安全边界

- `nodeIntegration: false`（页面拿不到 require / Node API）、`sandbox: false`（preload 需要 `require("electron")`）、`contextIsolation: false`（preload 与页面同 world，才能接管 `window.open`——等价 Tauri initialization_script）。
- 页面只能看到 `window.__mazmotRuntime`（shim 暴露的假窗口注册表）；IPC 函数闭包在 preload 内，不挂到 window。
- 主进程对每个调用校验 `event.senderFrame.url` 的 origin，非回环源一律 reject；`about:blank`（壳自建的 conjure 空白窗口）放行，后续导航仍受 `parseInternalUrl` 限制。
- `setWindowOpenHandler` 一律 deny，作为 shim 失效时的兜底，避免出现不受管的 Chromium 子窗口。

## 数据持久性与重置

- origin（含端口）跨启动稳定 → SW 缓存、IndexedDB、localStorage 全部持久；主站端口被外部进程占用时回退候选端口，该次启动 origin 变化会「看不到历史数据」。
- Electron userData 目录（macOS）：`~/Library/Application Support/Mazmot/`。**重置运行时 = 删除该目录**（SW 注册、已装应用、用户数据一并清除）。
- NoneOS Core 首装需联网（core.noneos.com），之后离线可用，与网页版一致。

## 打包

- `npm run build:dir` → `dist/mac-arm64/Mazmot.app`（快速验证）；`npm run build` → `dist/Mazmot-<version>-<arch>.dmg`。
- `electron-builder` 的 `build.extraResources` 把站点文件复制到 `Contents/Resources/site/`（与 projectR 的 `bundle.resources` 同一份清单，需同步维护）。
- `mac.identity: null`：不签名、不公证，产物适合内部验证；正式分发需配置签名证书与 notarization。
- DMG 需要 `hdiutil` 创建磁盘映像的权限；受限沙箱里会失败（`create failed - 操作不被允许`），改用 `npm run build:dir` / `build:dir:local` 验证 `.app`。
- 版本号跟随仓库根 `package.json`：`scripts/sync-version.js` 由 `predev` / `prebuild` 自动执行，产物版本、`runtime_probe` 与 `X-Mazmot-Runtime` 头同源。
- Windows / Linux 的 `win.target = portable`、`linux.target = AppImage` 已配置，需在对应平台或 CI 构建。

## 验证清单（改 shim / IPC / 端口 / 打包配置后）

1. `npm test`（14 用例：路径解析 / 穿越拦截 / MIME / Range / ETag / 404 / 308 / Host / 方法）。
2. `npm run dev`，stderr 依次出现：静态服务器已启动 ×4（main / bridge 各 v4+v6）、`主窗口就绪`、`[mazmot-runtime][web] probe ok {...}`（说明页面执行的 IPC 成功）。
3. `curl http://localhost:30031/` 200；`/sw.js` 200 且 `text/javascript`；不存在路径 404；目录缺尾斜杠 308。
4. SW 落盘：`~/Library/Application Support/Mazmot/Service Worker/` 下出现注册数据库。
5. 真人走查（涉及窗口行为时）：应用列表「打开 / 小窗口打开」→ 原生窗口弹出 → 关闭后列表状态回收；conjure 预览窗口（走 30032）。

## 踩坑索引

- **代理下载**：`@electron/get` 只有设置 `ELECTRON_GET_USE_PROXY=1` 才会读取 `https_proxy`，否则直连 GitHub 会长时间无进展；npm 11 的 install-scripts 审核也可能跳过 Electron 的 postinstall（表现为 `node_modules/electron/dist` 不存在）。
- **contextIsolation**：改成 `true` 后 preload 与页面不同 world，`window.open` 赋值对页面无效，所有应用都变成「点击无反应」；必须同时换注入方案（如 `webFrame.executeJavaScript` 到主 world）才能改。
- **`window.open` 重入**：shim 内调用 `runtime_open_window` 是异步的，窗口 label 在 Promise 返回前为空；`close()` 必须先置 `pendingClose`，否则会出现「关不掉的空窗口」。
- **`ELECTRON_RUN_AS_NODE`**：终端 / AI 会话可能注入该变量，此时 Electron 二进制退化成普通 Node，主进程代码根本不会执行（`--version` 输出的是 Node 版本）。`npm run dev` 走 `scripts/launch.js` 显式剔除该变量；直接跑 `node_modules/.bin/electron .` 时要自己 `env -u ELECTRON_RUN_AS_NODE`。
- **userData 不可写 = SIGTRAP**：Chromium 在 app ready 前就要建 userData 目录，沙箱 / 只读环境会直接 `Trace/BPT trap`，没有可读日志。设 `MAZMOT_USER_DATA=<可写目录>` 绕过；受限环境还需 `--no-sandbox`（`npm run dev -- --no-sandbox`）才能起子进程。
- **electron-builder 取 Electron / 图标工具的路径**：默认会往 `~/Library/Caches/electron` 与 `electron-builder` 缓存下载（受限环境 EPERM）。本机可用 `npm run build:dir:local`（`-c.electronDist=node_modules/electron/dist`）；图标提供 `build/icon.icns` 后不再触发 PNG→ICNS 转换工具下载（`npm run icon` 已自动生成）。
- **IPv6 双栈**：`port=0` 时 IPv4/IPv6 各绑会得到不同端口——先绑 IPv4 取 `server.address().port`，再用该端口绑 `::1`。
- **`-webkit-app-region: drag`**：drag 区域会吞掉鼠标事件；不要把交互元素放进顶部 40px 热区。
- **Electron 默认菜单**：macOS 保留默认菜单（Cmd+Q / 复制粘贴 / DevTools）；Windows/Linux 显式清空菜单，避免出现多余的默认项。
- **打包资源路径**：`extraResources` 的 `from` 相对本目录（`../../` 指向仓库根），`to` 相对 `Contents/Resources/`；漏配某目录时应用内会 404，但主窗口仍能打开（页面白屏），排查从 `curl` 对应 URL 开始。
- **CDP 验证多窗口**：`npm run dev -- --remote-debugging-port=9222` 后可用 `http://127.0.0.1:9222/json` 拿页面 target，通过 WebSocket 执行 `window.open(...)` / `w.close()` 做端到端验证（本次改造即以此验证：命名复用、URL 变更导航、closed 回调、窗口回收均通过）。

## 与 projectR 的差异

| 维度 | projectR（Tauri 2） | projectE（Electron） |
| ---- | ---- | ---- |
| WebView | 系统 WebView（macOS WKWebView / Windows WebView2） | Chromium（Electron 自带） |
| 注入方式 | `initialization_script` 注入页面 world | preload（`contextIsolation:false`，页面同 world） |
| IPC | Tauri commands + capability ACL | `ipcMain.handle("runtime:invoke")` + 调用方 origin 校验 |
| 顶栏拖拽 | `data-tauri-drag-region`（框架内建） | `-webkit-app-region: drag` |
| 静态服务器 | Rust `tiny_http` | Node `http` |
| 打包 | `tauri build`（app/dmg） | `electron-builder`（dmg） |
| 数据目录 | `~/Library/WebKit/com.mazmot.runtime/` | `~/Library/Application Support/Mazmot/` |
| 体积 | 小（复用系统 WebView） | 大（内置 Chromium，约 200MB+） |
