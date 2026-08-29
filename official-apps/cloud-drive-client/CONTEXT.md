# 云盘客户端 Context

> 云盘客户端，由 base 模板创建。入口 HTML → app-config → 首页模块。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── app.json          # 应用元数据：name / version / icon / entry / appConfig / permissions
├── index.html        # 入口 HTML：加载 ofa.js + 定义 Material 主题变量 + <o-router>/<o-app>
├── app-config.js     # ofa.js 应用配置：导出 home 路由与页面切换动画 pageAnime
└── pages/
    └── home.html     # 首页模块（<template page>）：展示 appName / appDesc
```

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量，方便整套换肤。
- **元数据同步**：修改 [app.json](app.json) 的 `name` / `description` / `icon` 后，如果这些字段也出现在页面文案里，请顺带更新对应模板/页面。
- **连接状态反馈**：[files.html](pages/files.html) 用 `connState`（connecting/connected）+ `loading` 两个 data 字段驱动 UI——恢复会话 / 连接服务器期间文件区显示 spinner（「正在连接服务器… / 正在加载目录…」），避免渲染成空白目录；顶栏用户名左侧有连接状态点（红 = 连接中，绿 = 已连接）。刷新目录（`reload`）负责置位/复位 `loading`，空目录文案只在 `!loading` 时渲染。

## 扩展指引

- **新增页面**：
  1. 在 [pages/](pages/) 下新建 `<name>.html`，遵循 `<template page>` 结构。
  2. 在 [app-config.js](app-config.js) 导出 `export const <name> = "./pages/<name>.html"`。
  3. 通过 `<a href="//<name>">` 或 `this.app.goto("//<name>")` 跳转。
- **接入 NoneOS Core**：
  - 顶层禁止 `import "/nos/*"`。
  - 在页面模块中：`const load = lm(import.meta); const { init } = await load("/nos/fs/main.js");`
- **持久化数据**：使用 `/nos/storage/main.js`（`getStorage(<id>)` 划分空间），避免直接使用 `localStorage`。

## 踩坑指南

开发 / 调试中遇到的坑（按 AGENTS.md 规则持续录入，格式：现象 → 原因 → 正确写法）：

### 1. ofa.js@latest 的 `goto("./x.html")` 相对解析基准变更 → 路由缺 `/pages/` 反复白屏
- **现象**：登录成功后跳转文件页报「加载页面模块 …/cloud-drive-client/files.html 失败」，地址栏 hash 变成 `#/…/cloud-drive-client/files.html`（缺 `/pages/` 段），且坏 hash 被记住，之后每次刷新都循环报错。
- **原因**：ofa.js 走 `@latest`，新版本把 `goto("./x.html")` 的相对解析基准从页面路径改成了 **app 根目录**，`./files.html` 被解析成 `…/client/files.html`。
- **正确写法**：不依赖 goto 的相对解析，按页面自身 src 显式构造绝对路由：
  ```js
  location.hash = "#" + new URL("files.html", this.src).pathname;
  ```
  见本页 `gotoFiles()` / `gotoHome()`。注意 `pathname` 自带前导 `/`，拼 hash 用 `"#"` 不要 `"#/"`（否则产生 `#//…` 双斜杠坏路由）。

### 2. 页面模块内动态 `import("/gh/…")` 报 Failed to resolve module specifier
- **现象**：`confirm` / `prompt` / `toast` 等在点击事件里 `await import("/gh/ofajs/senti-ui@latest/…")` 抛 `TypeError: Failed to resolve module specifier`。
- **原因**：ofa.js 把页面 `<script>` 编译成 **data: URL 模块**执行，data: 模块没有 base，无法解析 `/` 开头的根路径。
- **正确写法**：在模块初始化期统一经 `load()` 预载到闭包（`export default async ({ load }) => { const { default: toast } = await load("/gh/…/toast.js"); … }`），事件回调里直接用闭包变量。

### 3. 页面注册保留名冲突 → 整页白屏
- **现象**：console 报「注册参数有误，'proto'上的'refresh'已被占用」或 `'data'上的'entries'已被占用'`，页面模块不注册、白屏且无其他报错。
- **原因**：ofa.js 页面实例占用了这些名字（proto：`refresh` / `back` / `goto` / `replace` 等；data：`entries` 等）。
- **正确写法**：用业务语义命名（`refreshAll`、`fileItems`）。遇到「xxx 已被占用」先对照保留名清单改名，不要怀疑加载流程。

### 4. 客户端必须注册同名服务，否则服务器应答丢失
- **现象**：连接后第一条指令（ping）一直「请求超时」，但 `sendToService` 探针显示投递 `delivered: true`。
- **原因**：服务器的应答（含 ReliableChannel 的 ACK）是通过 `sendToService(APP_SERVICE_ID, …)` 回投的；客户端不 `registerService(APP_SERVICE_ID)` 时应答全部 `no_receiver`。
- **正确写法**：`connect()` 时在客户端注册同名服务，`onMessage` 里把信封交给本端 ReliableChannel `handle()`（见 client-core.js）。

### 5. 空间信息属于登录后数据，不得提前暴露
- **教训**：早期版本在登录前就提供「选择空间」步骤（`space-list` 指令公开返回所有空间名），属于隐私泄漏。
- **现行模型**：登录（用户名 + 密码）→ 服务器仅返回**该账号被授权的空间** → 客户端把空间合成为根目录下的文件夹（`list("root")` 时合成，条目带 `virtual: true` 标记，页面据此隐藏重命名/删除）。空间内文件 id 统一编码为 `真实id@spaceId`，由 client-core 解包并在每个指令中显式携带 `spaceId`，服务器逐次校验当前授权（管理员改授权立即生效）。
- 注意 `mkdir` / 上传要兼容 `space:<id>`（空间根）与 `真实id@spaceId`（子目录）两种目录标识（`_unwrapDir`）。

### 6. 客户端刷新后概率连不上：30s 服务发现缓存把应答投给已销毁的 session
- **现象**：只刷新客户端，偶发「连接失败 / 请求超时: ping」，重试又好了。
- **原因**：刷新后 userId 不变、session 更新，但服务器端 `serviceSessionCache`（TTL 30s）还记着旧 session，应答按缓存投给已销毁的会话而丢失；能否成功取决于缓存过期与新 session 注册的时序赛跑。同一身份开多个标签页会把「旧 session 仍在线」的窗口拉得更长。
- **正确写法**：① 服务器应答**定向回投** `ctx.fromSessionId`（可靠消息规范「回 ACK 必须带 sessionId」），见 server-core 的 `_sessionTargets`；② 客户端 ping 握手重试 3 次（client-core `connect()`）；③ 避免同身份多标签页并存。

### 7. `sessionStorage` 用于标签页级 UI 状态记忆
- 登录态等需要跨刷新的用 `/nos/storage` 持久化（如 `session` 键 + 服务器 7 天会话）；tab 位置这类「关页即失效」的记忆用 `sessionStorage`（如 `cloud-drive-server-tab`），符合 AGENTS.md 的例外约定。
