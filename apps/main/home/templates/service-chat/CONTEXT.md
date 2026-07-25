# Service Chat 模板 Context

> 服务商 / 客户双角色的点对点聊天示例。服务商点击「与我聊天」生成带 `host=<userId>` 的分享链接；客户打开链接后自动以客户身份连回服务商。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── app.json          # 应用元数据：icon="💬"
├── index.html        # 入口 HTML：加载 ofa.js + Material 主题 + <o-router>/<o-app>
├── app-config.js     # 导出 home = ./pages/home.html
└── pages/
    └── home.html     # 首页模块：根据 URL 判断 host / customer 角色并渲染
```

## 常量

- `NAMESPACE = "mazmot"`：服务商与客户必须一致的 NoneOS Core 用户命名空间，直接复用项目默认命名空间。
- `SERVICE_ID = "chat"`：消息服务 ID；`registerService` / `sendToService` 均使用它。

## 角色判定

`pages/home.html` 顶部：

```js
const sp = new URLSearchParams(location.search);
const hostUserId = sp.get("host") || "";
const isCustomer = !!hostUserId;
```

- **服务商（host）**：URL 无 `?host=`，`ready()` → `initHost()`。
- **客户（customer）**：URL 带 `?host=<userId>`，`ready()` → `initCustomer()`，自动 `connectUser(hostUserId)`。
- **loading**：user 就绪前的临时态。

## 关键流程

### 服务商 initHost

1. `this._svc = user.registerService(SERVICE_ID, { onMessage })`。
2. `onMessage` 里记录第一个连进来的客户 (`ctx.fromUserId` / `ctx.remoteUser`)，更新 `hostStatus`，把消息压进 `messages`。
3. 未有客户时页面显示分享链接输入框 + 「生成链接 / 复制」按钮：首次点击调用 `generateChatLink()` 生成并复制，再次点击直接复制已生成的 `shareUrl`。

### 服务商 generateChatLink

1. `parseSelfIdentity()` → `{ namespace, dirName }`。
2. `load(...)` 并行拿 `/nos/fs/main.js`、ever-cache、`/apps/main/lib/share-mgr.js`。
3. 从 `storage.apps` 找当前应用记录（按 `dirName` 匹配），缺 `appId` 时 `generateAppId(dirName)` 生成并回写。
4. 关键：`publishApp(app, { appId, appParams: { host: this.myUserId }, onProgress })`，把自己的 `userId` 放进 `appParams.host`。
5. 复制返回的 `shareUrl` 到剪贴板。

### 客户 initCustomer

1. 同样 `registerService(SERVICE_ID, { onMessage })` 接收服务商回复。
2. `remote = await user.connectUser(hostUserId)` 并把 `remote` 存到 `this._remoteUser`。
3. `user.isRemoteUserOnline(hostUserId)` 更新 `customerStatus`。

### 消息发送 sendMessage

- 客户：`this._remoteUser.sendToService(SERVICE_ID, { text }, { waitForService: 3000 })`，根据 `results[*].status` 判断投递结果 (`ok` / `offline` / `no_receiver` / 其它)。
- 服务商：`this._customerRemote.sendToService(SERVICE_ID, { text })`。
- 发送成功后本地 push `{ text, type: "sent" }`，`scrollToBottom()` 平滑滚动。

## 数据字段

- `role`：`"loading" | "host" | "customer"`。
- `myUserId`：本机 `user.userId`。
- `hostUserId`：客户端从 URL 读到的服务商 userId。
- `messages`：`[{ text, type: "sent" | "received" }, ...]`。
- `inputText` / `generating` / `genStatus` / `shareUrl` / `hostStatus` / `customerStatus`：UI 态。
- 非响应式字段（`_` 前缀）：`_user` / `_svc` / `_remoteUser` / `_customerRemote` / `_customerUserId`。

## 扩展指引

- **多客户支持**：当前只记录第一个客户，若要一对多请改用 `Map<fromUserId, remoteUser>` 存放，并按会话拆分 `messages`。
- **消息持久化**：可用 ever-cache 存 `messages`，避免刷新丢失。
- **服务发现**：`registerService` 支持多种消息服务，可在同一 user 下再注册 `SERVICE_ID = "file-transfer"` 等扩展能力。
- **生命周期**：新增服务必须在 `detached()` 里 `unregister()`，避免多次挂载导致重复回调。
