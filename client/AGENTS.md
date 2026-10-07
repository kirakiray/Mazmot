# AI 代理开发指南 (AGENTS.md)

本文件为参与 Mazmot 桌面运行时（Tauri 2 壳）开发的 AI 代理提供上下文入口和开发规范，本目录可独立成项目，**规则自包含**。涉及站点源码（上级目录的 `index.html`、`main/`、`mz/`、`apps/` 等）的开发请另读仓库根的 `AGENTS.md` 与 `CONTEXT.md`。

## 项目上下文入口

- [`CONTEXT.md`](CONTEXT.md) —— 本目录的架构说明（启动流程、静态服务器行为、window.open shim 契约、命令速查、踩坑索引），**首次接手或未读过本目录代码时必须先读**。
- [`README.md`](README.md) —— 面向人的使用说明（开发 / 打包命令、端口约定、已知限制）。
- 仓库根 `AGENTS.md` 的「client/（桌面运行时，Tauri 2）」章节 —— 全局视角下的硬约束清单（与本文件一致，以本文件为细）。

## CONTEXT.md 同步维护规则

`CONTEXT.md` 是本目录知识的**活文档（living document）**，必须与代码保持一致。

- **凡是修改了本目录下的文件**（新增/删除/重命名文件、增删命令、调整端口策略、变更 shim 语义、修改打包配置等），**都必须同步更新 [`CONTEXT.md`](CONTEXT.md)**。
- **发现错误即纠正**：阅读源码后若发现 `CONTEXT.md` 与实际代码不符，即便不是本次任务引入的，也有责任顺手修正。
- **删除模块要同步清理**：删除文件或功能后，把 `CONTEXT.md` 对应的目录树、命令速查、流程条目一并移除，不留死描述。
- 文档内引用本目录文件一律用相对路径（如 `src-tauri/src/main.rs`）；引用仓库根文档用文字说明（如「仓库根 AGENTS.md」），**不写 `../` 链接**。

## 硬性架构规则

以下约束违反任意一条都会造成静默故障或数据丢失，**不允许例外**：

1. **禁止把 WebView 指向 `tauri://` asset 协议**：NoneOS Core 依赖 Service Worker，自定义协议源下 SW 无法注册。页面一律走内置静态服务器的真实 `http://localhost` 源。
2. **端口即 origin**：主站 origin（含端口）跨启动必须稳定，否则 SW 缓存与 IndexedDB 数据全部丢失。端口候选与回退顺序只能整体定义在 `src-tauri/src/static_server.rs` 的 `MAIN_PORTS`，**不得改动取值或顺序**；`30032` 为 conjure 隔离域（bridge）专属，站点侧 `BRIDGE_ORIGIN` 硬编码指向它，永远不进主站候选。
3. **站点零补丁**：本目录不得 fork / 修改站点源码来适配壳。兼容性问题优先在 `src-tauri/src/shim.js`（注入层）或 Rust 侧（`commands.rs` / `on_navigation`）解决；确实需要改站点行为的，到对应站点目录按仓库根规范单独改。
4. **新命令三件套联动**：新增 `runtime_*` 命令时必须同时更新三处，缺一即被 ACL **静默拒绝**（invoke 的 promise 直接 reject，无任何日志）：
   - `src-tauri/src/commands.rs` 命令实现 + `main.rs` 的 `generate_handler!` 登记；
   - `src-tauri/build.rs` 的 `AppManifest::commands()`（自动生成 `allow-<command>` 权限；**必须用 AppManifest，不能用 InlinedPlugin**——后者的权限键带 `plugin:<name>|` 命名空间，匹配不上裸命令名）；
   - `src-tauri/capabilities/main.json` 的 `permissions` 里引用对应的 `allow-<command>`。
5. **shim 浏览器语义不得弱化**：`shim.js` 模拟的是浏览器命名窗口行为（同名复用/聚焦不重开、`window.open("", name)` 只取引用不导航、假窗口 `closed`/`focus()`/`close()`），主应用的 `main/lib/app-status.js` 依赖这套契约追踪应用存活。改动 shim 前先读 `CONTEXT.md`「window.open shim 契约」。
6. **bundle 资源清单联动**：站点新增/删除顶层目录或文件、且需要打进桌面包时，同步更新 `src-tauri/tauri.conf.json` 的 `bundle.resources`（与站点 `sw/host-cache.js` 的离线缓存范围、`cache-manifest.json` 生成脚本对照）。
7. **图标管线单向**：改图标只能改 `scripts/gen_icon.py` 重新生成 `assets/icon.png`，再跑 `npx tauri icon` 派生；**禁止手改 `src-tauri/icons/` 下任何派生文件**（下次 icon 生成会覆盖）。

## 构建与测试

- **Rust 单元测试**（静态服务器路径/MIME/Range/端口/Host 校验）：`cd src-tauri && cargo test`，改 `static_server.rs` 后必须跑。
- **冒烟验证**（改 shim / 命令 / 端口逻辑后执行）：启动应用 → stderr 应依次出现「静态服务器已启动 ×4（30031/30032 双栈）」「主窗口就绪」「[web] probe ok {...}」→ `curl http://localhost:30031/` 得 200 → 确认 `~/Library/WebKit/com.mazmot.runtime/.../ServiceWorkerRegistrations-*.sqlite3` 存在（SW 注册落盘）。步骤细节见 `CONTEXT.md`「验证清单」。
- **打包**：`npm run build` 出 `.app`；DMG 因 `bundle_dmg.sh` 需要 Finder 自动化权限（终端环境 AppleEvent 超时），用 `hdiutil create -volname Mazmot -srcfolder <stage> -format UDZO` 兜底，步骤见 `CONTEXT.md`「打包产物」。
- **依赖下载**：本机拉 crates/npm 需要走代理时，先 `export https_proxy=http://127.0.0.1:8118 http_proxy=http://127.0.0.1:8118 no_proxy=localhost,127.0.0.1`（以开发者当前环境为准）。

## 其它开发通则

- Rust 代码遵循仓库整体风格：注释解释「为什么」而不是「做了什么”；公开模块/函数头部写一段定位注释。
- `shim.js` 是注入到页面的初始化脚本，运行在页面上下文——**只依赖标准 Web API 与 `__TAURI_INTERNALS__`/`__TAURI__`，禁止引入构建步骤或外部依赖**。
- 改动涉及站点侧可感知行为（多窗口、外链分流、标题同步）时，冒烟通过后提醒开发者做一次真人 UI 走查（应用列表打开应用 → 原生窗口 → 关闭后列表状态回收）。
