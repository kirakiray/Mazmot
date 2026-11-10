# AI 代理开发指南 (AGENTS.md) — client/projectE

本文件为参与 Mazmot 桌面运行时（Electron 壳）开发的 AI 代理提供上下文入口与开发规范，本目录可独立成项目，**规则自包含**。涉及站点源码（仓库根的 `index.html`、`main/`、`mz/`、`apps/` 等）的开发请另读仓库根 `AGENTS.md` 与 `CONTEXT.md`；涉及 Tauri 壳请看 `../projectR/AGENTS.md`。

## 项目上下文入口

- [`CONTEXT.md`](CONTEXT.md) —— 本目录的架构说明（启动流程、静态服务器行为、window.open shim 契约、IPC 速查、踩坑索引），**首次接手或未读过本目录代码时必须先读**。
- [`README.md`](README.md) —— 面向人的使用说明（开发 / 打包命令、端口约定、已知限制）。
- 仓库根 `AGENTS.md` 的「client/（桌面运行时）」章节 —— 全局视角下的硬约束清单（两个壳共用，以各自目录文档为细）。

## CONTEXT.md 同步维护规则

`CONTEXT.md` 是本目录知识的**活文档（living document）**，必须与代码保持一致。

- **凡是修改了本目录下的文件**（新增/删除/重命名文件、增删命令、调整端口策略、变更 shim 语义、修改打包配置等），**都必须同步更新 [`CONTEXT.md`](CONTEXT.md)**。
- **发现错误即纠正**：阅读源码后若发现 `CONTEXT.md` 与实际代码不符，即便不是本次任务引入的，也有责任顺手修正。
- **删除模块要同步清理**：删除文件或功能后，把 `CONTEXT.md` 对应的目录树、命令速查、流程条目一并移除，不留死描述。
- 文档内引用本目录文件一律用相对路径（如 `src/main.js`）；引用仓库根或 projectR 用文字说明，**不写 `../` 链接**。

## 硬性架构规则

以下约束违反任意一条都会造成静默故障或数据丢失，**不允许例外**：

1. **禁止把 BrowserWindow 指向 `file://` 或自定义协议**：NoneOS Core 依赖 Service Worker，这类源下 SW 无法注册。页面一律走内置静态服务器的真实 `http://localhost` 源。
2. **端口即 origin**：主站 origin（含端口）跨启动必须稳定，否则 SW 缓存与 IndexedDB 数据全部丢失。端口候选与回退顺序只能整体定义在 [`src/static-server.js`](src/static-server.js) 的 `MAIN_PORTS`，**不得改动取值或顺序**；`30032` 为 conjure 隔离域（bridge）专属，站点侧 `BRIDGE_ORIGIN` 硬编码指向它，永远不进主站候选。
3. **站点零补丁**：本目录不得 fork / 修改站点源码来适配壳。兼容性问题优先在 [`src/shim.js`](src/shim.js)（页面注入层）、[`src/preload.js`](src/preload.js) 或主进程（`src/main.js` 的导航分流）解决；确实需要改站点行为的，到对应站点目录按仓库根规范单独改。
4. **安全边界不可放宽**：`nodeIntegration` 必须保持 `false`；页面只能通过 `window.__mazmotRuntime` 的封装访问 IPC；`assertTrustedSender` 必须保留且只接受回环源。`contextIsolation: false` 是**有意为之**（preload 需与页面同 world 才能接管 `window.open`，等价 Tauri initialization_script），不要在未替代 shim 注入方案前改成 `true`。
5. **新命令必须同步三处**：新增 `runtime_*` 命令时，同时更新
   - [`src/main.js`](src/main.js) 的 `COMMANDS` 表；
   - 本文件与 [`README.md`](README.md) 的命令清单；
   - [`CONTEXT.md`](CONTEXT.md) 的「命令速查」表。
   新增命令默认继承 `assertTrustedSender` 校验；不得绕过统一入口另开 `ipcMain.handle`。
6. **shim 浏览器语义不得弱化**：[`src/shim.js`](src/shim.js) 模拟的是浏览器命名窗口行为（同名复用/聚焦不重开、`window.open("", name)` 只取引用不导航、假窗口 `closed`/`focus()`/`close()`），主应用的 `main/lib/app-status.js` 依赖这套契约追踪应用存活。改动前先读 `CONTEXT.md`「window.open shim 契约」。
7. **bundle 资源清单联动**：站点新增/删除顶层目录或文件、且需要打进桌面包时，同步更新 [`package.json`](package.json) 的 `build.extraResources`（与站点 `sw/host-cache.js` 的离线缓存范围、`cache-manifest.json` 生成脚本对照）。
8. **图标管线单向**：图标唯一源是 `../projectR/scripts/gen_icon.py` → `../projectR/assets/icon.png`；本目录不得手改 `assets/icon.png` 或 `build/icon.png`，改完源图后跑 `npm run icon` 同步。

## 构建与测试

- **单元测试**（静态服务器路径/MIME/Range/ETag/404/Host 校验）：`npm test`（Node 原生 test runner，不需要 Electron）。改 `src/static-server.js` 后必须跑。
- **冒烟验证**（改 shim / IPC / 端口逻辑后执行）：`npm run dev` → stderr 应依次出现「静态服务器已启动 ×2」「主窗口就绪」「[mazmot-runtime][web] probe ok {...}」→ `curl http://localhost:30031/` 得 200 → 确认 `~/Library/Application Support/Mazmot/Service Worker/` 下出现注册数据库。
- **打包验证**：`npm run build:dir` 先验证 `dist/mac-arm64/Mazmot.app` 能启动（站点资源在 `Contents/Resources/site`），再 `npm run build` 出 DMG。
- **依赖下载**：本机拉 Electron / electron-builder 依赖需要走代理时，先 `export https_proxy=… http_proxy=… ELECTRON_GET_USE_PROXY=1`（`@electron/get` 只有显式开启才读代理环境变量，否则会卡在直连 GitHub）。

## 其它开发通则

- 主进程代码遵循仓库整体风格：注释解释「为什么」而不是「做了什么」；模块/函数头部写一段定位注释。
- `src/preload.js` 与 `src/shim.js` 运行在渲染进程页面上下文——只依赖标准 Web API 与 `electron` 的 `ipcRenderer`，**禁止引入构建步骤或第三方依赖**。
- 改动涉及站点侧可感知行为（多窗口、外链分流、标题同步）时，冒烟通过后提醒开发者做一次真人 UI 走查（应用列表打开应用 → 原生窗口 → 关闭后列表状态回收）。
