# Service Chat 模板 Context

> 演示服务商 / 客户双角色点对点聊天：服务商发布带 `host` 参数的分享链接，客户打开链接后通过 NoneOS Core user 通信建立 P2P 聊天。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── __template.json   # 模板元数据 + 生成时替换规则（APP_NAME / APP_DESC_JSON / CREATED_AT）
├── app.json          # 应用元数据：name / version / icon / entry / appConfig
├── index.html        # 入口 HTML：加载 ofa.js + Material 主题变量 + <o-router>/<o-app>
├── app-config.js     # 应用配置：导出 home 路由 + pageAnime 切换动画
└── pages/
    └── home.html     # 首页模块（<template page>）：双角色聊天 UI + 全部业务逻辑
```

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量。
- **模板替换**：`__template.json` 声明 `app.json` / `index.html` / `pages/home.html` 中的 `Mazmot Service Chat` 字符串在生成实例时替换为 `APP_NAME`。

## 首页模块数据字段（`pages/home.html`）

`export default async ({ load }) => ({ data, proto, ready, detached })` 返回的实例状态：

| 字段             | 类型     | 用途                                                   |
| ---------------- | -------- | ------------------------------------------------------ |
| `role`           | string   | `"loading"` / `"host"` / `"customer"`，决定渲染分支    |
| `myUserId`       | string   | 当前用户 ID（服务商发布时带进链接）                    |
| `hostUserId`     | string   | 客户模式从 URL `host` 参数解析出的服务商 ID            |
| `messages`       | array    | 聊天记录，每项 `{ text, type: "sent" \| "received" }`  |
| `inputText`      | string   | 输入框双向绑定值                                       |
| `hostStatus`     | string   | 服务商状态文案（等待连接 / 客户已连接 / 失败信息）     |
| `customerStatus` | string   | 客户状态文案                                           |
| `generating`     | boolean  | 是否正在生成分享链接                                   |
| `genStatus`      | string   | 生成链接进度文案                                       |
| `shareUrl`       | string   | 已生成的聊天链接                                       |

非响应式实例属性（以 `_` 前缀，不参与模板渲染）：

- `this._user`：NoneOS Core user 对象。
- `this._svc`：`registerService` 返回的服务句柄，`detached` 时 `unregister()`。
- `this._customerRemote` / `this._customerUserId`（服务商侧）/ `this._remoteUser`（客户侧）：对端引用。

## 模块常量

- `NAMESPACE = "mazmot"`：与项目默认命名空间一致（`lib/share-mgr.js` 同名）。
- `SERVICE_ID = "chat"`：服务商与客户共同注册的服务标识。

## 依赖的外部 API

### NoneOS Core user（`/nos/user/main.js`）

通过 `const { getUser } = await load("/nos/user/main.js"); const user = await getUser(NAMESPACE);` 获取：

- `user.userId`：当前用户 ID。
- `user.registerService(serviceId, { onMessage(data, ctx) })`：注册服务；返回含 `unregister()` 的句柄。`ctx.fromUserId` / `ctx.remoteUser` 标识发送方。
- `user.connectUser(userId)`：连接远端用户，返回 remote 对象。
- `user.isRemoteUserOnline(userId)`：返回 boolean，判断对端是否在线。
- `remote.sendToService(serviceId, data, options?)`：向对端服务发消息；`options.waitForService` 设超时。返回结果数组，每项 `status ∈ {"ok","offline","no_receiver","unknown"}`。

### share-mgr（仓库根 `lib/share-mgr.js`）

通过 `const { publishApp, generateAppId } = await load("/lib/share-mgr.js")` 获取：

- `generateAppId(dirName)`：根据目录名生成稳定的应用 ID。
- `publishApp(app, options)`：发布应用到 P2P 网络。
  - `app` 形状：`{ _handle, _recordName, name, version, desc, icon, appId }`。
  - `options`：`{ appId, appParams, onProgress }`。本模板固定传 `appParams: { host: this.myUserId }`。
  - 返回 `{ shareUrl, payloadHash }`。

### ever-cache（`https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js`）

通过 `const { storage } = await load(...)` 获取：

- `await storage.apps`：读取本地应用记录数组（每项含 `name` / `virtualDirName` / `dirName` / `appId` / `payloadHash` 等）。
- `await storage.setItem("apps", apps)`：写回记录。

### NoneOS Core fs（`/nos/fs/main.js`）

- `const { init } = await load("/nos/fs/main.js"); const rootDir = await init(namespace);`
- `await rootDir.get(dirName)`：获取应用目录句柄（供 `publishApp` 读取文件清单）。

## 关键流程

### 1. 角色判定（`ready` 内一次性完成）

`location.search` 含 `host=<userId>` → 客户模式（`initCustomer`）；否则 → 服务商模式（`initHost`）。失败兜底回退到 `host` 并显示错误。

### 2. 服务商初始化（`initHost`）

1. `registerService(SERVICE_ID, { onMessage })`。
2. UI 显示"生成链接"按钮，等待第一条客户消息到达时记录 `_customerUserId` / `_customerRemote`。
3. 进入聊天界面后用 `_customerRemote.sendToService(...)` 回复。

### 3. 客户初始化（`initCustomer`）

1. `registerService(SERVICE_ID, { onMessage })` 接收服务商回复。
2. `connectUser(hostUserId)` + `isRemoteUserOnline(hostUserId)` 双检。
3. 发消息走 `_remoteUser.sendToService(SERVICE_ID, { text }, { waitForService: 3000 })`，按返回 `status` 更新 UI。

### 4. 生成聊天链接（`generateChatLink`，服务商专用）

1. `parseSelfIdentity()` 从 `location.pathname`（格式 `/$<namespace>/<dirName>/client/index.html`）解析自身身份。
2. 并行加载 `fs` / `ever-cache` / `share-mgr`。
3. 从 `storage.apps` 找记录、缺 `appId` 则 `generateAppId` 并写回。
4. `rootDir.get(dirName)` 取目录句柄，组装 `app` 对象。
5. `publishApp(app, { appId, appParams: { host: myUserId }, onProgress })`。
6. `payloadHash` 写回 `record.payloadHash`，`shareUrl` 复制到剪贴板并展示。

### 5. 销毁（`detached`）

`this._svc.unregister()` 反注册服务，避免泄漏句柄。

## 自身身份解析

`parseSelfIdentity()` 使用正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 匹配 `location.pathname`，捕获 `{ namespace, dirName }`。匹配失败返回 `null`，由调用方抛错。
