# Ping-Pong 通信模板 Context

> 演示应用间点对点数据通信：发起方（host）发布带 `host` 参数的分享链接，接收方（customer）打开链接后通过 NoneOS Core user 建立 P2P 连接，随后双方每 2 秒互发一条 `ping` / `pong` + 时间字符串，在日志区展示收发记录。顶部状态栏实时显示本端视角的对端连接方式（`WebRTC 直连` / `服务器中转` / `对方离线`），日志区在握手与上下线时插入 `system` 类型消息。

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
    └── home.html     # 首页模块（<template page>）：双角色通信 UI + 全部业务逻辑
```

## 角色与通信模型

| 角色       | 进入方式                       | 职责                                                                                  |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 发起方 host | 直接打开应用（URL 无 `host` 参数） | 注册服务 → 生成分享链接（带 `appParams.host = myUserId`）→ 收到对端首条消息后启动 ping 循环 |
| 接收方 customer | 打开带 `?host=<userId>` 的链接   | 注册服务 → `connectUser(hostUserId)` → 在线检测通过后启动 pong 循环                    |

- 消息载荷固定为 `{ kind: "ping" \| "pong", time: <HH:MM:SS> }`，host 发 ping，customer 发 pong。
- 双方各自独立计时（默认 `PING_INTERVAL = 2000ms`），不依赖对方回复触发下一帧。
- 接收方收到消息后只做日志记录与计数，不回发确认（无 ACK 协议）。

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量。
- **模板替换**：`__template.json` 声明 `app.json` / `index.html` / `pages/home.html` 中的 `Mazmot Ping-Pong` 字符串在生成实例时替换为 `APP_NAME`。
- **P2P 无后端**：通信基于点对点，发起方标签页一旦关闭，接收方即无法送达消息。涉及关闭 / 切后台 / 断网提醒的 UI 均以此为前提。

## 首页模块数据字段（`pages/home.html`）

`export default async ({ load }) => ({ data, proto, ready, detached })` 返回的实例状态：

| 字段             | 类型     | 用途                                                       |
| ---------------- | -------- | ---------------------------------------------------------- |
| `role`           | string   | `"loading"` / `"host"` / `"customer"`，决定渲染分支        |
| `myUserId`       | string   | 当前用户 ID（发起方发布时带进链接）                         |
| `hostUserId`     | string   | 接收方模式从 URL `host` 参数解析出的对端 ID                |
| `connected`      | boolean  | 是否已完成握手（发起方：收到对端首条消息；接收方：在线检测通过） |
| `logs`           | array    | 通信日志，每项 `{ text, type: "sent" \| "received" \| "system" }` |
| `sentCount`      | number   | 累计发送成功条数（统计栏展示）                             |
| `receivedCount`  | number   | 累计接收条数（统计栏展示）                                 |
| `pingIntervalSec`| number   | 发送周期（秒），供模板文案展示                             |
| `hostStatus`     | string   | 发起方状态文案（等待连接 / 已连接 / 失败信息）             |
| `customerStatus` | string   | 接收方状态文案                                             |
| `generating`     | boolean  | 是否正在生成分享链接                                       |
| `genStatus`      | string   | 生成链接进度文案                                           |
| `shareUrl`       | string   | 已生成的通信链接                                           |
| `myLinkType`     | string   | 本端视角的对端连接方式：`""` / `"rtc"` / `"relay"`，驱动顶部徽章 |
| `peerOnline`     | boolean  | 对端是否在线；状态切换时自动推一条 `system` 类型日志        |
| `peerUserId`     | string   | 对端 userId，用于 `remote_user_*` / `rtt_update` 事件匹配   |

非响应式实例属性（以 `_` 前缀，不参与模板渲染）：

- `this._user`：NoneOS Core user 对象。
- `this._svc`：`registerService` 返回的服务句柄，`detached` 时 `unregister()`。
- `this._customerRemote` / `this._customerUserId`（发起方侧）：对端引用，首条消息到达时写入。
- `this._remoteUser`（接收方侧）：`connectUser` 返回的远端对象。
- `this._timer`：`setInterval` 句柄，`detached` 时 `clearInterval`。
- `this._eventsBound`：是否已绑定 `remote_user_*` / `rtt_update` 事件，避免重复绑定。
- `this._unbindConnected` / `this._unbindDisconnected` / `this._unbindRtt`：对应事件的解绑函数，`detached` 时依次调用。

## 模块常量

- `NAMESPACE = "mazmot"`：与项目默认命名空间一致（`lib/share-mgr.js` 同名）。
- `SERVICE_ID = "ping-pong"`：双方共同注册的服务标识。
- `PING_INTERVAL = 2000`：双方各自发送消息的周期（毫秒）。

## 依赖的外部 API

### NoneOS Core user（`/nos/user/main.js`）

通过 `const { getUser } = await load("/nos/user/main.js"); const user = await getUser(NAMESPACE);` 获取：

- `user.userId`：当前用户 ID。
- `user.registerService(serviceId, { onMessage(data, ctx) })`：注册服务；返回含 `unregister()` 的句柄。`ctx.fromUserId` / `ctx.fromSessionId` / `ctx.remoteUser` 标识发送方。
- `user.connectUser(userId)`：连接远端用户，返回 remote 对象。
- `user.isRemoteUserOnline(userId)`：返回 boolean，判断对端是否在线。
- `user.bind(eventName, handler)`：监听事件，返回解绑函数。本模板使用以下事件：
  - `remote_user_connected`：`event.detail.{ userId, remoteUser, initiatedBy }`，主动 `connectUser` 成功或对端首条消息被动建连时触发。
  - `remote_user_disconnected`：`event.detail.{ userId, reason, error }`，主动 `disconnectUser` 或连接异常时触发。
  - `rtt_update`：`event.detail.{ userId, sessionId, rtt, via }`，底层测量出 RTT 后触发，用于实时刷新连接方式。
- `remote.sendToService(serviceId, data, options?)`：向对端服务发消息；返回**结果数组**，每项形如 `{ status, delivered?, sessionId?, via? }`：
  - `status: "ok"` + `delivered: true`：送达，`via` 为 `"rtc"`（WebRTC 直连）或 `"server"`（服务器中转 = relay），本模板据此更新 `myLinkType`。
  - `status: "offline"` / `"error"` / `"discovery_failed"`：未送达，本模板据此将对端标记为离线并推下线日志。

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

`location.search` 含 `host=<userId>` → 接收方模式（`initCustomer`）；否则 → 发起方模式（`initHost`）。失败兜底回退到 `host` 并显示错误。

### 2. 发起方初始化（`initHost`）

1. `registerService(SERVICE_ID, { onMessage })`。
2. UI 显示"生成链接"按钮，等待接收方第一条消息到达。
3. 首条消息到达时：
   - 写入 `_customerUserId` / `_customerRemote` / `peerUserId`；
   - 置 `connected = true`、`hostStatus` 切到"已连接"；
   - 调用 `bindPeerEvents()` 绑定 `remote_user_*` / `rtt_update`；
   - 推一条 `[time] 对方（接收方）已上线` 的 `system` 日志；
   - `startPingLoop()` 启动心跳。
4. 后续每条入站消息都推入日志、累加 `receivedCount`，并纠正 `peerOnline = true`。

### 3. 接收方初始化（`initCustomer`）

1. `registerService(SERVICE_ID, { onMessage })` 接收发起方发来的 ping。
2. `connectUser(hostUserId)` 写入 `_remoteUser` / `peerUserId`，再 `isRemoteUserOnline(hostUserId)` 复检。
3. 在线：
   - 置 `connected = true`、`customerStatus` 切到"已连接"；
   - 调用 `bindPeerEvents()`；
   - 推一条 `[time] 已连接到发起方` 的 `system` 日志；
   - `startPongLoop()` 启动心跳。
4. 不在线：置 `peerOnline = false`，推 `[time] 发起方不在线` 的 `system` 日志，UI 给出重试提示。

### 4. ping / pong 循环（`startPingLoop` / `startPongLoop`）

- 双方各自 `setInterval(send, PING_INTERVAL)`。
- 发起方先立即 `send()` 一次，再进入周期；接收方直接进入周期（首条 pong 约在 2 秒后发出）。
- 每次 `sendToService` 返回后调用 `applySendResults(results)`：
  - 命中 `status:"ok"` → 读取 `via` 调用 `setLinkTypeFromVia()` 刷新顶部徽章（rtc / relay），并纠正 `peerOnline = true`；
  - 全部未送达且 `status` 为 `offline` / `error` / `discovery_failed` → `markPeerOnline(false)` 推一条 `[time] 对方已下线` 的 `system` 日志。
- 每次发送成功后 `pushLog("[time] → ping|pong", "sent")` 并 `sentCount++`；失败仅 `console.error`，不重试、不打断定时器。

### 5. 连接状态与上下线事件（`bindPeerEvents` / `markPeerOnline`）

- 在握手成功后绑定（仅绑定一次，用 `_eventsBound` 防重）：
  - `remote_user_connected`：对端 `userId === peerUserId` 时，若 `peerOnline` 为 false 则切换为 true 并推上线日志。
  - `remote_user_disconnected`：匹配 `peerUserId` 时，若当前在线则切换为 false 并推下线日志。
  - `rtt_update`：匹配 `peerUserId` 且 `detail.via` 非空时调用 `setLinkTypeFromVia()`，让顶部徽章实时跟随底层连接方式。
- `markPeerOnline(online)` 通过比较旧值避免重复推日志，状态切换时同步更新 `peerOnline` 与一条 `system` 类型日志。
- 顶部徽章文案与样式由模板内联表达式根据 `peerOnline` + `myLinkType` 计算得出（`offline` / `rtc` / `relay` / 连接中）。

### 6. 生成通信链接（`generateLink`，发起方专用）

1. `parseSelfIdentity()` 从 `location.pathname`（格式 `/$<namespace>/<dirName>/client/index.html`）解析自身身份。
2. 并行加载 `fs` / `ever-cache` / `share-mgr`。
3. 从 `storage.apps` 找记录、缺 `appId` 则 `generateAppId` 并写回。
4. `rootDir.get(dirName)` 取目录句柄，组装 `app` 对象。
5. `publishApp(app, { appId, appParams: { host: myUserId }, onProgress })`。
6. `payloadHash` 写回 `record.payloadHash`，`shareUrl` 复制到剪贴板并展示。

### 7. 销毁（`detached`）

`clearInterval(this._timer)` 停止心跳；依次调用 `_unbindConnected` / `_unbindDisconnected` / `_unbindRtt` 解绑事件；`this._svc.unregister()` 反注册服务，避免泄漏句柄。

## 自身身份解析

`parseSelfIdentity()` 使用正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 匹配 `location.pathname`，捕获 `{ namespace, dirName }`。匹配失败返回 `null`，由调用方抛错。
