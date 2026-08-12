# Tic-Tac-Toe 联机模板 Context

> 演示应用间点对点数据通信：房间方（host）发布带 `host` 参数的分享链接，加入方（customer）打开链接后通过 NoneOS Core user 建立 P2P 连接，随后双方通过同步落子消息进行一局井字棋对战。

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
    └── home.html     # 首页模块（<template page>）：棋盘 UI + 落子同步 + 胜负判定
```

## 角色与游戏规则

| 角色       | 进入方式                       | 棋子 | 顺序 |
| ---------- | ------------------------------ | ---- | ---- |
| 房间方 host | 直接打开应用（URL 无 `host` 参数） | X    | 先手 |
| 加入方 customer | 打开带 `?host=<userId>` 的链接   | O    | 后手 |

- 棋盘为长度 9 的一维数组，下标对应 3×3 网格（0-2 第一行，3-5 第二行，6-8 第三行）。
- 每次落子由落子方本地先更新棋盘，再通过 `sendReliable` 可靠投递业务消息 `{ kind: "move", index, mark }` 给对端，对端收到后本地复现。
- 胜负判定双方各自独立计算（八条获胜线），不依赖对端判定结果。
- 任意一方点击「再来一局」会本地重置棋盘并通过 `sendReliable` 发 `{ kind: "restart" }` 通知对端同步重置。

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量。
- **模板替换**：`__template.json` 声明 `app.json` / `index.html` / `pages/home.html` 中的 `Mazmot Tic-Tac-Toe` 字符串在生成实例时替换为 `APP_NAME`。
- **P2P 无后端**：对战基于点对点，房间方标签页一旦关闭，加入方无法继续对战。涉及关闭 / 切后台 / 断网提醒的 UI 均以此为前提。
- **无权威方**：双方都能本地修改棋盘，依赖"收到消息才落子"的约定维持一致性，**不存在**防作弊校验。Demo 性质，不要在生产场景套用。

## 首页模块数据字段（`pages/home.html`）

`export default async ({ load }) => ({ data, proto, ready, detached })` 返回的实例状态：

| 字段             | 类型     | 用途                                                       |
| ---------------- | -------- | ---------------------------------------------------------- |
| `role`           | string   | `"loading"` / `"host"` / `"customer"`，决定渲染分支        |
| `myUserId`       | string   | 当前用户 ID（房间方发布时带进链接）                         |
| `hostUserId`     | string   | 加入方模式从 URL `host` 参数解析出的对端 ID                |
| `connected`      | boolean  | 是否已建立对战连接                                         |
| `board`          | array    | 长度 9 的棋盘，元素 `""` / `"X"` / `"O"`                   |
| `currentTurn`    | string   | `"X"` / `"O"`，当前轮到谁                                  |
| `result`         | string\|null | 对局结果：`null` / `"X"` / `"O"` / `"draw"`             |
| `winLine`        | array\|null | 获胜的三格索引（响应式，供模板高亮 `.win` 类）           |
| `myMark`         | string   | 我方棋子 `"X"` / `"O"`                                     |
| `scoreX` / `scoreO` | number | 双方累计胜场（含平局外的胜者）                          |
| `rounds`         | number   | 已对战局数                                                 |
| `hostStatus`     | string   | 房间方状态文案                                             |
| `customerStatus` | string   | 加入方状态文案                                             |
| `generating`     | boolean  | 是否正在生成分享链接                                       |
| `genStatus`      | string   | 生成链接进度文案                                           |
| `shareUrl`       | string   | 已生成的对战链接                                           |
| `myLinkType`     | string   | 当前连接方式：`""`（未知）/ `"rtc"`（WebRTC 直连）/ `"relay"`（服务器中转） |
| `peerOnline`     | boolean  | 对端是否在线（默认 `true`，事件触发后修正）                |
| `peerUserId`     | string   | 对端 userId，用于事件匹配（房间方在首条消息到达时写入，加入方连接成功后写入） |

非响应式实例属性（以 `_` 前缀，不参与模板渲染）：

- `this._user`：NoneOS Core user 对象。
- `this._svc`：`registerService` 返回的服务句柄，`detached` 时 `unregister()`。
- `this._customerRemote` / `this._customerUserId`（房间方侧）：对端引用，首条消息到达时写入。
- `this._remoteUser`（加入方侧）：`connectUser` 返回的远端对象。
- `this._eventsBound`：是否已绑定对端事件监听，避免重复绑定。
- `this._unbindConnected` / `this._unbindDisconnected` / `this._unbindRtt` / `this._unbindRtcState`：四个事件解绑函数，`detached` 时调用。

## 模块常量

- `NAMESPACE = "default"`：与项目默认命名空间一致（`lib/share-mgr.js` 同名）。
- `SERVICE_ID = "tic-tac-toe"`：双方共同注册的服务标识。
- `WIN_LINES`：八条获胜线（行 3、列 3、对角 2），用于 `checkWinner()`。

## 消息协议

所有业务消息都通过 `sendReliable(payload)` 发送，该方法自动在外面包一层**可靠投递信封**，底层调用 `sendToService(SERVICE_ID, envelope, { waitForService })`：

```
业务消息（sendReliable 的 payload）    线上信封（sendToService 的 data）
{ kind: "move", index, mark }    →    { msgId, kind: "data", payload: { kind: "move", ... } }
                                    ←  { msgId, kind: "ack" }   （接收方回的确认）
```

业务 `payload.kind` 取值：

| `kind`    | 其他字段       | 方向         | 用途                                   |
| --------- | -------------- | ------------ | -------------------------------------- |
| `"hello"` | `mark`         | customer→host | 加入方上线通知（首条消息触发 host 的 `connected=true`）|
| `"move"`  | `index`, `mark` | 双向         | 落子同步，`index` 0-8，`mark` "X"/"O"  |
| `"restart"` | —            | 双向         | 请求对端重置棋盘开启新一局             |

可靠投递机制（参考 `noneos-core-docs/references/reliable-messaging.md`）：

- **msgId**：每条消息自动生成唯一 ID（`m-{timestamp}-{seq}`）
- **ACK 确认**：接收方收到 `data` 消息后立即回 `{ kind: "ack", msgId }`（带 `sessionId` 定向回复）
- **超时重发**：发送方 3s 内未收到 ACK 则重发（复用同一 msgId），最多重试 3 次
- **msgId 去重**：接收方按 msgId 记录 5 分钟内已处理的消息，重发导致的重复只执行一次业务逻辑
- **串行队列**：同一目标的发送操作排队执行，前一条收到 ACK 后才发下一条

## 依赖的外部 API

### NoneOS Core user（`/nos/user/main.js`）

通过 `const { getUser } = await load("/nos/user/main.js"); const user = await getUser(NAMESPACE);` 获取：

- `user.userId`：当前用户 ID。
- `user.registerService(serviceId, { onMessage(data, ctx) })`：注册服务；返回含 `unregister()` 的句柄。`ctx.fromUserId` / `ctx.remoteUser` 标识发送方。
- `user.connectUser(userId)`：连接远端用户，返回 remote 对象。
- `user.isRemoteUserOnline(userId)`：返回 boolean，判断对端是否在线。
- `user.bind(eventName, handler)`：订阅全局事件，返回解绑函数。本模板订阅的事件见下文「对端事件」。
- `remote.sendToService(serviceId, data, options?)`：向对端服务发消息；返回 `results` 数组，每项形如 `{ status, via }`，`status === "ok"` 表示送达，`via` 取值 `"rtc"` / `"server"` 等用于推断连接方式。本模板的 `sendReliable` 传 `{ waitForService: ACK_TIMEOUT }` 以避免首条消息因对端尚未注册服务而空耗一轮重试。

### 模块级可靠投递层（`sendReliable` / `handleIncoming`）

页面模块内部实现的信封层，不依赖外部库。模块级状态（非响应式，定义在 `export default` 工厂函数内）：

- `pendingAcks`（Map）：msgId → `{ resolve, reject, timer, tries }`，发送方等待 ACK 的条目。
- `seenIds`（Map）：msgId → 首次接收时间戳，接收方去重记录（TTL 5 分钟，每次接收后 `pruneSeen` 清理过期项）。
- `sendQueues`（Map）：队列 key（对端 userId） → 尾部 Promise，实现串行发送链。
- `msgSeq`（number）：msgId 自增序号。

Proto 方法：

- `getRemote()`：按角色返回当前发送目标（host → `_customerRemote`，customer → `_remoteUser`）。
- `sendReliable(payload)`：把业务 payload 包成 `{ msgId, kind: "data", payload }` 信封，排入串行队列，通过 `sendToService` 发出并等 ACK；3s 超时重发，最多 3 次。ACK 到达时 resolve，重试耗尽时 reject。内部也会调用 `applySendResults(results)` 更新连接状态。
- `handleIncoming(data, ctx)`：接收方统一入口。先判 ACK 分支（`resolveAck`）；否则先回 ACK（`ctx.remoteUser.sendToService` 带 `sessionId` 定向回复），再按 msgId 去重，最后拆信封分发到 `onRemoteMove` / `onRemoteRestart` / hello。

#### 对端事件（`bindPeerEvents` 订阅）

订阅时均会校验 `event.detail.userId === peerUserId`，仅响应本局对端：

| 事件                        | detail 关键字段       | 用途                                                                                       |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `remote_user_connected`     | `userId`             | 对端上线 → `peerOnline = true`                                                             |
| `remote_user_disconnected`  | `userId`             | 对端下线 → `peerOnline = false`                                                            |
| `rtt_update`                | `userId`, `via`      | 实时刷新连接方式徽章（`via="rtc"` → WebRTC 直连，其他 → 服务器中转）                       |
| `rtc_state`                 | `userId`, `state`    | WebRTC 协商状态：`connected` 切到 rtc，`disconnected`/`failed`/`closed` 回退到 relay       |

### share-mgr（仓库根 `lib/share-mgr.js`）

通过 `const { publishApp, generateAppId } = await load("/lib/share-mgr.js")` 获取：

- `generateAppId(dirName)`：根据目录名生成稳定的应用 ID。
- `publishApp(app, options)`：发布应用到 P2P 网络。
  - `app` 形状：`{ _handle, _recordName, name, version, desc, icon, appId }`。
  - `options`：`{ appId, appParams, onProgress }`。本模板固定传 `appParams: { host: this.myUserId }`。
  - 返回 `{ shareUrl, payloadHash }`。

### NoneOS Core storage（`/nos/storage/main.js`）

通过 `const { getStorage } = await load("/nos/storage/main.js")` 获取，主系统应用列表用 `getStorage("mazmot")` 空间：

- `await storage.getItem("apps")`：读取本地应用记录数组（每项含 `name` / `virtualDirName` / `dirName` / `appId` / `payloadHash` 等）。
- `await storage.setItem("apps", apps)`：写回记录。

### NoneOS Core fs（`/nos/fs/main.js`）

- `const { init } = await load("/nos/fs/main.js"); const rootDir = await init(namespace);`
- `await rootDir.get(dirName)`：获取应用目录句柄（供 `publishApp` 读取文件清单）。

## 关键流程

### 1. 角色判定（`ready` 内一次性完成）

`location.search` 含 `host=<userId>` → 加入方模式（`initCustomer`）；否则 → 房间方模式（`initHost`）。失败兜底回退到 `host` 并显示错误。

### 2. 房间方初始化（`initHost`）

1. `myMark = "X"`，`hostStatus = "正在自动生成连接..."`。
2. `registerService(SERVICE_ID, { onMessage })`。
3. 立即在后台调用 `this.generateLink()` 自动生成对战链接（不阻塞服务注册；浏览器剪贴板 API 需用户手势，自动调用可能写不进剪贴板，故生成后只展示链接，复制动作仍由用户点击「复制」按钮完成）。
4. UI 等待加入方第一条消息到达时写入 `_customerUserId` / `_customerRemote`、置 `peerUserId` / `connected = true`，并调用 `bindPeerEvents()` 绑定对端事件。

### 3. 加入方初始化（`initCustomer`）

1. `myMark = "O"`。
2. `registerService(SERVICE_ID, { onMessage })` 接收房间方的落子。
3. `connectUser(hostUserId)` + `isRemoteUserOnline(hostUserId)` 双检。
4. 在线即写入 `peerUserId` / `connected = true`，调用 `bindPeerEvents()`，并通过 `sendReliable` 主动发一条 `{ kind: "hello" }` 让房间方感知自己已加入。`sendReliable` 内部的 `sendToService` 返回值会交给 `applySendResults` 推断初始连接方式。

### 4. 落子（`placeAt` → `applyAfterMove`）

1. UI 点击空格 → `canPlaceAt` 校验（自己回合 + 空格 + 未结束）。
2. 本地 `board[index] = mark`。
3. `applyAfterMove`：`checkWinner` → 有胜者则 `finishGame`；棋盘满则平局；否则切换 `currentTurn`。
4. `sendReliable` 发 `{ kind: "move", index, mark }` 给对端（带 ACK 确认 + 超时重发）。
5. 对端 `handleIncoming` 拆信封后调用 `onRemoteMove` 校验并复现落子，走相同的 `applyAfterMove`，同时回 ACK。

### 5. 重开（`requestRestart` / `onRemoteRestart`）

- 点击「再来一局」：本地 `resetBoard` + 通过 `sendReliable` 发 `{ kind: "restart" }`。
- 收到 `restart`：本地 `resetBoard`。
- 比分（`scoreX` / `scoreO` / `rounds`）保留累计。

### 6. 生成对战链接（`generateLink`，房间方专用）

由 `initHost` 在后台自动触发（无需用户点击）。流程：

1. `parseSelfIdentity()` 从 `location.pathname`（格式 `/$<namespace>/<dirName>/client/index.html`）解析自身身份。
2. 并行加载 `fs` / `storage` / `share-mgr`。
3. 从 `getStorage("mazmot")` 的 `apps` 键找记录、缺 `appId` 则 `generateAppId` 并写回。
4. `rootDir.get(dirName)` 取目录句柄，组装 `app` 对象。
5. `publishApp(app, { appId, appParams: { host: myUserId }, onProgress })`。
6. `payloadHash` 写回 `record.payloadHash`，`shareUrl` 展示在输入框。

> 注：方法末尾仍会调用 `copyToClipboard(shareUrl)`，但因为是后台自动触发（无用户手势），浏览器剪贴板写入通常会被拒绝；真正的复制动作由用户点击「复制」按钮（`handleCopyLink`）完成。

### 7. 销毁（`detached`）

依序清理可靠投递层的定时器与队列（`pendingAcks` / `sendQueues`），再调用四个事件解绑函数（`_unbindConnected` / `_unbindDisconnected` / `_unbindRtt` / `_unbindRtcState`）取消对端事件订阅，最后 `this._svc.unregister()` 反注册服务，避免泄漏句柄。

### 8. 连接方式徽章更新（双方共用）

页面顶部状态文案旁的 `.link-badge` 实时显示当前对战通信用的是 **WebRTC 直连**（绿色）还是 **服务器中转**（橙色），或对端离线（红色）。状态来源（按优先级合并）：

1. **sendReliable 内部的 sendToService 返回值**：`placeAt` / `requestRestart` / `initCustomer` 的 hello 都走 `sendReliable`，后者在每次 `sendToService` 后调用 `applySendResults`，命中 `status === "ok"` 时按 `via` 字段推断连接方式；全部失败（offline / error / discovery_failed）则把 `peerOnline` 置为 `false`。
2. **`rtt_update` 事件**：Core 周期性上报 RTT 时附带 `via`，`bindPeerEvents` 监听后调用 `setLinkTypeFromVia` 实时刷新。
3. **`rtc_state` 事件**：Core 后台静默升级 WebRTC，`state === "connected"` 立即把徽章切到 rtc；`disconnected` / `failed` / `closed` 回退到 relay。
4. **`remote_user_connected` / `remote_user_disconnected` 事件**：仅更新 `peerOnline`，控制徽章是显示离线红点还是连接方式。
5. **收消息兜底**：`onRemoteMove` 收到对端落子时强制把 `peerOnline` 置为 `true`（说明对端确实在线）。

UI 文案：在线时按 `myLinkType` 显示「WebRTC 直连 / 服务器中转 / 连接中...」；离线时显示「对方离线」。

## 自身身份解析

`parseSelfIdentity()` 使用正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 匹配 `location.pathname`，捕获 `{ namespace, dirName }`。匹配失败返回 `null`，由调用方抛错。
