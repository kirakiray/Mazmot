# 云盘服务器 Context

> 云盘服务器，由 base 模板创建。入口 HTML → app-config → 首页模块。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── app.json          # 应用元数据：name / version / icon / entry / appConfig / permissions
├── index.html        # 入口 HTML：加载 ofa.js + 定义 Material 主题变量 + <o-router>/<o-app>
├── app-config.js     # ofa.js 应用配置：导出 home 路由与页面切换动画 pageAnime
├── lib/              # 业务工具库：protocol.js（协议常量，与 cloud-drive-client 同副本）/ reliable.js（ReliableChannel，同副本）/ server-core.js（CloudDriveServer 核心）；test/reliable.sb.html 单元测试
└── pages/
    └── home.html     # 首页模块（<template page>）：展示 appName / appDesc
```

## lib/ 核心模块

> `protocol.js` 与 `reliable.js` 在本应用与 `official-apps/cloud-drive-client/lib/` 内是**相同副本**（保持应用自包含、可独立安装分享）。修改协议或可靠层时**必须双侧同步**。

### `protocol.js`（纯函数/常量，与客户端同副本）

`APP_SERVICE_ID`（"cloud-drive-v1"）、`USER_NAMESPACE`（"cloud-drive"，双方 getUser 命名空间）、`CHUNK_SIZE`（48KB）、`RESUME_MIN_SIZE`（256KB）、`MSG` 消息类型表；`bytesToBase64` / `base64ToBytes` / `formatBytes` / `formatTime` / `newId` / `sha256Hex` / `chunkIndexes` / `fileIcon`。

### `reliable.js` —— ReliableChannel（纯模块，可注入传输层，与客户端同副本）

解决 `sendToService` 尽力投递的静默丢包（详见 noneos-core-docs「应用层可靠消息投递」）：

```js
const ch = new ReliableChannel({
  send: async (envelope) => boolean,  // 交给传输通道（返回是否受理）
  onData: (payload, envelope) => {},  // 收到去重后的业务数据
  timeout, maxRetry, maxPayload,       // 默认 3000ms / 5 次 / 112KB
});
await ch.send(payload);                // ACK 到达 resolve，重试耗尽 reject；同目标串行
transport 收到信封后调用 ch.handle(envelope)；  // 数据与 ACK 都走这里
ch.destroy();                          // 通道销毁时 reject 所有在途发送
```

要点：信封 `{msgId, kind:"data"|"ack", payload}`；重发复用同一 msgId；接收端 **ACK 先于去重回**；payload 超限立即 reject（不占重试）。测试 `test/reliable.sb.html` 用有损线路模拟丢包/黑洞/重复 ACK。

### `server-core.js` —— `new CloudDriveServer(user, onEvent)`

`start()`（registerService + storage/fs 初始化）/ `stop()`；空间管理 `listSpaces / createSpace（虚拟） / createLocalSpace(handle)（挂载本地文件夹，需调用方检测 window.showDirectoryPicker，仅 Chromium） / deleteSpace`；本地空间 `kind:"local"`，挂载句柄存 `mount:<spaceId>`，文件读写直接作用于真实目录（fileId 为相对路径，暂不支持重命名）；账号体系 `listAccounts / createAccount({username, password, spaces}) / updateAccount / deleteAccount`；统计 `getStats()`；审计日志 `listAudit() / clearAudit()`（storage 键 `audit`，最新在前上限 500 条：`login`（含 token）/ `refresh-login`（刷新恢复，经 MSG.RESUME）/ `login-fail` / `logout`，字段 `{id, time, type, username, remoteUserId, token?}`）。客户端指令（token 会话，每远端串行处理）：`login / resume（刷新恢复校验 + 记审计）/ logout（注销会话并记审计）/ list / mkdir / rename / remove / up-init（按 clientUploadId 幂等续传）/ up-chunk / up-complete / up-cancel / down-init / down-chunk`。存储布局见文件头注释。

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量，方便整套换肤。
- **元数据同步**：修改 [app.json](app.json) 的 `name` / `description` / `icon` 后，如果这些字段也出现在页面文案里，请顺带更新对应模板/页面。
- **登录记录（审计日志）**：[home.html](pages/home.html) 第三个 tab「登录记录」，数据来自 server-core 的 `listAudit()`（storage 键 `audit`，最新在前，上限 500 条）。记录四类事件：`login`（登录成功，含 token 会话标识）/ `refresh-login`（客户端刷新后凭持久化 token 恢复登录，经 `MSG.RESUME` 指令，服务器校验 token 后记录）/ `login-fail`（用户名或密码错误）/ `logout`（客户端登出时经 `MSG.LOGOUT` 指令通知服务器，服务器注销会话后记录；token 未知也幂等返回 ok）。列表每页 10 条分页（`auditPage` / `auditPageItems` getter + 上/下一页按钮），行内小字号展示时间、账号、会话 token 前缀、来源远端 userId 前缀；各类事件会经 onEvent 自动刷新列表，另有「清空记录」按钮（`clearAudit()`）。

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

### 1. 页面注册保留名冲突 → 整页白屏
- **现象**：console 报「注册参数有误，'proto'上的'refresh'已被占用」，页面模块不注册、白屏且无其他报错。
- **原因**：`refresh` 是 ofa.js 页面实例保留方法（另有 `back` / `goto` / `replace` / `src` 等；data 上的 `entries` 同样被占用）。
- **正确写法**：业务命名避开保留名（本页用 `refreshAll`）。遇到「xxx 已被占用」先对照保留名清单改名。

### 2. 页面模块内动态 `import("/gh/…")` 报 Failed to resolve module specifier
- **现象**：`alert` / `confirm` / `toast` 在事件回调里 `await import("/gh/ofajs/senti-ui@latest/…")` 抛 `TypeError: Failed to resolve module specifier`。
- **原因**：ofa.js 把页面 `<script>` 编译成 **data: URL 模块**执行，data: 模块没有 base，无法解析 `/` 开头的根路径。
- **正确写法**：模块初始化期统一 `await load("/gh/…")` 预载到闭包（本页预载 confirm / alert / toast 与 `/nos/fs/main.js` 的 `open`）。

### 3. `st-menu-item` 图标必须放 `prefix` 插槽
- **现象**：split button 下拉菜单项里 `<n-icon>` 和文字上下排布。
- **原因**：默认插槽是纯文字区，图标混进去后垂直堆叠。
- **正确写法**：`<n-icon slot="prefix" icon="…"></n-icon>` + 默认插槽放文字，无需手写布局样式。

### 4. 挂载本地文件夹仅 Chromium 系浏览器支持
- **现象**：Firefox / Safari 点「挂载本地文件夹」无目录选择器或直接报错。
- **原因**：依赖 File System Access API（`window.showDirectoryPicker` / `/nos/fs` 的 `open()`），仅 Chrome / Edge 等 Chromium 内核实现。
- **正确写法**：调用前检测 `window.showDirectoryPicker`，缺失时用 `alert` 引导换浏览器（见 `mountLocalFolder()`）。虚拟空间的创建不受影响。

### 5. 挂载句柄的持久化与失效重挂
- 本地空间（`kind: "local"`）的挂载句柄存 `getStorage("cloud-drive-server")` 的 `mount:<spaceId>` 键（nos/fs 句柄可直接入库，读回仍是可用句柄）；页面刷新后系统挂载可能失效，`_getMount()` 会探测并重新 `mount()`。删除本地空间只解除登记，**不删除用户磁盘文件**（删除确认文案已区分）。
