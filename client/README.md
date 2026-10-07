# Mazmot Desktop Runtime（client/）

用 [Tauri 2](https://tauri.app) 把 Mazmot 静态站点封装成桌面应用运行时：原生窗口里跑的仍是完整的 Mazmot 平台（NoneOS Core + ofa.js），`window.open` 接管为原生多窗口，应用获得浏览器标签页无法拥有的桌面体验。

> AI 代理开发请先读本目录的 [`AGENTS.md`](AGENTS.md)（硬性规范）与 [`CONTEXT.md`](CONTEXT.md)（架构活文档：启动流程 / shim 契约 / 命令速查 / 踩坑索引）。

## 为什么是「内置静态服务器」而不是 Tauri asset 协议

Mazmot 的运行时依赖 **NoneOS Core Service Worker**（提供 `/nos/*`、`/gh/*`、`/$虚拟目录/*`）。Service Worker 无法在 `tauri://` 自定义协议源上注册，所以本壳在 Rust 侧内置了一个回环 HTTP 静态服务器（[src-tauri/src/static_server.rs](src-tauri/src/static_server.rs)），WebView 指向真实的 `http://localhost` 源——SW、IndexedDB、BroadcastChannel 等平台能力与浏览器完全一致。

端口沿用仓库本地开发约定（`scripts/static.js`），站点代码**零补丁**：

| 端口 | 用途 |
| ---- | ---- |
| 30031 | 主站 origin（主窗口；被占用时依次回退 30033-30036） |
| 30032 | 隔离域 origin（conjure 预览 bridge，站点常量 `BRIDGE_ORIGIN` 硬编码指向它） |

> 主站端口落定前会依次尝试候选端口并绑定 `127.0.0.1` + `[::1]` 双栈；origin（含端口）跨启动保持稳定，SW 缓存与 IndexedDB 数据才不会丢。

## 站点资源来源

- **dev（`npm run dev` / debug 构建）**：直接伺服仓库根目录，站点源码改动实时生效（受 SW 缓存影响时可在应用内强制刷新或清空 WebView 数据）。
- **release（`npm run build`）**：`tauri.conf.json` 的 `bundle.resources` 把 `index.html`、`sw.js`、`sw/`、`main/`、`apps/`、`mz/`、`official-apps/`、`bridge/`、`cache-manifest.json`、`locale-text.json` 打进应用包（Windows/Linux 同理）。
- **`MAZMOT_WEB_ROOT` 环境变量**：指向任意一份站点静态文件，优先级最高（调试其它部署快照时用）。

## 多窗口 Runtime 行为（src-tauri/src/shim.js）

Tauri WebView 原生不支持 `window.open`，注入每个 WebView 的初始化脚本把它接管为原生窗口，语义对齐浏览器：

- `window.open(同源URL, "mazmot-app-<name>")` → 原生 `WebviewWindow`；同名窗口复用/聚焦，不重复开。
- `window.open(url, name, "width=…,height=…,left=…,top=…")` → 按 features 设定窗口尺寸与位置（应用列表「小窗口打开」、conjure 预览窗口）。
- `window.open("", name)` → 只取已开窗口引用并聚焦，不触发导航（conjure 依赖该语义）。
- 返回的假窗口支持 Mazmot 用到的 `closed`（实时，含用户手关）、`focus()`、`close()`。
- 外部 http(s)（文档、帮助链接等）→ 系统默认浏览器；页内导航的外链由 Rust `on_navigation` 同样分流。
- 窗口标题跟随页面 `document.title`。

## IPC 与权限

`capabilities/main.json` 只放行回环源（`http://localhost:30031-30036` / `127.0.0.1`），授予 `core:default`。Mazmot 命令层（`runtime_open_window` / `runtime_navigate_window` / `runtime_focus_window` / `runtime_close_window` / `runtime_set_window_title` / `runtime_open_external` / `runtime_probe` / `runtime_log`）是应用自定义命令，不依赖插件权限。

## 其它行为

- **单实例**：二次启动聚焦已有主窗口（`tauri-plugin-single-instance`），避免端口与数据漂移。
- **关主窗即退出**整个 runtime（含所有应用窗口）。
- **404 语义与 CF Pages 对齐**：未命中路径返回 404 状态 + 顶层 `404.html`，不做 SPA 回退（防止掩盖资源缺失）；目录缺尾斜杠 308 补全。
- 静态响应带 `ETag` 协商缓存（304）与单区间 `Range`（206，媒体进度条）；Host 头校验防 DNS rebinding。
- `X-Mazmot-Runtime` 响应头标记本服务器版本。

## 开发

```bash
cd client
npm install
npm run dev      # 调试运行（伺服仓库根，站点改动实时生效）
npm run build    # release 打包（.app / .dmg）
npm run icon     # 重新派生图标（源：assets/icon.png，由 scripts/gen_icon.py 生成）
```

- Rust 单元测试（静态服务器路径/MIME/Range/端口绑定）：`cd src-tauri && cargo test`
- 首次启动需要联网安装 NoneOS Core（从 core.noneos.com 拉 SW 核心），之后离线可用——与网页版行为一致。
- WebView 数据（SW / IndexedDB / localStorage）位于系统 WebView 用户数据目录（macOS：`~/Library/WebKit/com.mazmot.runtime`），删除即重置运行时。

## 已知限制

- 主站端口被占用回退后，该次启动 origin 变化会导致该次启动看不到历史数据（正常情况下端口稳定）。
- 30032 被占用时仅 conjure 隔离预览降级，主站不受影响。
- 自绘顶栏仅 macOS（Overlay 标题栏）；Windows / Linux 保持系统原生标题栏。
- Windows 便携包需系统自带 WebView2 Runtime；NSIS/MSI 安装包需在 Windows 上构建（或 GitHub Actions windows runner）。
- Linux 需 webkitgtk ≥ 2.40（Service Worker 支持）；Windows 使用 WebView2，均需实测验证后再正式分发。
