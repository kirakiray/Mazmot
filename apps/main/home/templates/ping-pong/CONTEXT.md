# Ping-Pong 通信模板 Context

> 演示应用间点对点数据通信：发起方（host）发布带 `host` 参数的分享链接，接收方（customer）打开链接后通过 NoneOS Core user 建立 P2P 连接，随后双方进入**回合制**循环——一方发一条带 emoji 的消息、对方收到后延迟 1 秒再发自己的，依次轮流把内容填入 10×10 表格（底色区分自己 / 对方），满 100 格后自动清空循环。顶部状态栏实时显示本端视角的对端连接方式（`WebRTC 直连` / `服务器中转` / `对方离线`）。

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
    ├── home.html     # 首页模块（<template page>）：双角色通信 UI + 全部业务逻辑
    └── servers.html  # 握手服务器查看页（<template page>）：列出已配置的信令/握手服务器及其连接状态 / 延迟 / 版本
```

## 角色与通信模型

| 角色           | 进入方式                           | 职责                                                                                  |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| 发起方 host    | 直接打开应用（URL 无 `host` 参数） | 注册服务 → **自动生成**分享链接（带 `appParams.host = myUserId`）→ 收到对端首条消息后立即发第一个 ping，开启回合制循环 |
| 接收方 customer | 打开带 `?host=<userId>` 的链接     | 注册服务 → `connectUser(hostUserId)` → 在线检测通过后发一条 `ready` 信号触发 host 开局 |

- 消息载荷固定为 `{ kind: "ping" | "pong" | "ready", emoji? }`，`emoji` 从内置 `EMOJIS` 数组（40 个常用表情/动物/水果/活动 emoji）中随机挑选，是实际展示的对话内容。
- **回合制驱动**（非各自独立计时）：收到对方一条消息 → 把对方内容填入表格（`side:"peer"`）→ `setTimeout(REPLY_DELAY)` 延迟 1 秒 → 发送自己的一条并填入自己格子（`side:"self"`）。因此填格顺序严格为：host 第 1 格 → customer 第 2 格 → host 第 3 格 ……
- 表格满 100 格后 `resetCells()` 自动清空并继续循环。
- `ready` 是接收方的就绪信号，仅用于触发 host 发第一个 ping，本端不据此填格。

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
| `cells`          | array    | 长度 100 的表格，每项 `{ emoji, side: "" \| "self" \| "peer" }`，按到达顺序行优先填入（idx 0~9 第一行，10~19 第二行……） |
| `cellCursor`     | number   | 下一个要填入的格子索引（0~99），到 100 触发清空循环         |
| `selfCount`      | number   | 自己已填入的格子数（统计栏展示）                           |
| `peerCount`      | number   | 对方已填入的格子数（统计栏展示）                           |
| `hostStatus`     | string   | 发起方状态文案（正在自动生成连接… / 接收方已连接，正在轮流填格 / 失败信息） |
| `customerStatus` | string   | 接收方状态文案（正在连接发起方… / 已连接，正在轮流填格 / 发起方不在线…） |
| `generating`     | boolean  | 是否正在生成分享链接                                       |
| `genStatus`      | string   | 生成链接进度文案                                           |
| `shareUrl`       | string   | 已生成的通信链接                                           |
| `myLinkType`     | string   | 本端视角的对端连接方式：`""` / `"rtc"` / `"relay"`，驱动顶部徽章 |
| `peerOnline`     | boolean  | 对端是否在线（默认 `true`，事件 / 收发结果触发后修正）      |
| `peerUserId`     | string   | 对端 userId，用于 `remote_user_*` / `rtt_update` / `rtc_state` 事件匹配   |

非响应式实例属性（以 `_` 前缀，不参与模板渲染）：

- `this._user`：NoneOS Core user 对象。
- `this._svc`：`registerService` 返回的服务句柄，`detached` 时 `unregister()`。
- `this._customerRemote` / `this._customerUserId`（发起方侧）：对端引用，首条消息到达时写入。
- `this._remoteUser`（接收方侧）：`connectUser` 返回的远端对象。
- `this._timer`：`setTimeout` 句柄（回合制延迟），`detached` 时 `clearTimeout`。
- `this._stopped`：是否已停止回合制循环（`detached` 时置 `true`，`scheduleNextSend` / `sendNextPing` / `sendNextPong` 入口处判断短路）。
- `this._eventsBound`：是否已绑定 `remote_user_*` / `rtt_update` / `rtc_state` 事件，避免重复绑定。
- `this._unbindConnected` / `this._unbindDisconnected` / `this._unbindRtt` / `this._unbindRtcState`：对应事件的解绑函数，`detached` 时依次调用。

## 消息协议

通过 `sendToService(SERVICE_ID, data)` 发送，`data` 形状：

| `kind`    | 其他字段 | 方向           | 用途                                                       |
| --------- | -------- | -------------- | ---------------------------------------------------------- |
| `"ready"` | —        | customer→host  | 接收方就绪信号，触发 host 发第一个 ping 并开启回合制（本端不填格） |
| `"ping"`  | `emoji`  | host→customer  | 发起方发的对话内容                                         |
| `"pong"`  | `emoji`  | customer→host  | 接收方发的对话内容                                         |

## 握手服务器查看页（`pages/servers.html`）

独立页面模块，列出当前应用所属命名空间已配置的全部信令/握手服务器及其连接状态。仅查看，不主动发起新连接。

**入口**：发起方在尚未与接收方建立连接时（`role === 'host' && !connected`），首页顶部右侧出现「查看握手服务器」按钮，点击 `this.goto("./pages/servers.html")` 跳转；页面左上角「←」调用 `this.back()` 返回首页。该按钮在已连接后自动隐藏，避免在通信进行中误离开（离开会 detach 首页并停止回合制循环）。

**响应式数据字段**：

| 字段          | 类型     | 用途                                                                 |
| ------------- | -------- | -------------------------------------------------------------------- |
| `loading`     | boolean  | 是否正在加载用户/服务器信息                                          |
| `refreshing`  | boolean  | 「刷新」按钮是否执行中（禁用按钮 + 文案切换）                        |
| `servers`     | array    | 服务器列表，每项 `{ url, connected, rtt, latencyLevel, version }`    |

非响应式实例属性：`this._user`（NoneOS Core user 对象）、`this._unbindHandlers`（事件解绑函数数组）。

**`latencyLevel` 取值**：`null` / `"good"`（<100ms，绿）/ `"medium"`（<300ms，橙）/ `"high"`（≥300ms，红），由 `getLatencyLevel(rtt)` 计算，驱动延迟标签颜色。

**依赖的 NoneOS Core server API**（`user.server`）：

- `await getServers()`：返回已配置的服务器 URL 字符串数组（持久化于 IndexedDB，同 namespace 共享）。
- `connectedUrls`：只读 getter，当前已握手成功的 URL 数组。
- `await connect(url)`：对同一 URL 复用已有连接，返回 `{ success, version }`。本页**仅对已在 `connectedUrls` 中的服务器调用**以获取版本号，不对未连接服务器调用，以免被动建立新连接。
- `await testLatency(url)`：返回 `{ rtt, oneWayLatency }`（毫秒）。
- 事件：`server_connected`（`detail.url` / `detail.version`）、`server_disconnected`（`detail.url`）、`latency_test`（`detail.url` / `detail.rtt` / `detail.oneWayLatency`），`ready` 时绑定、`detached` 时解绑。

**关键流程**：

1. `ready` 内 `load("/nos/user/main.js")` → `getUser(NAMESPACE)` 取得与首页同身份的 user 实例（同命名空间复用密钥与连接状态）。
2. `loadServers()`：`getServers()` 取列表 → 与 `connectedUrls` 求交得到 `connected` → 对已连接者 `probeAt()`：`connect()` 复用连接拿版本 + `testLatency()` 测延迟。
3. 绑定三个事件：连接建立 → `setConnected(url,true,version)` 并补测延迟；断开 → 清空延迟/版本；延迟事件 → `applyLatency()` 更新 rtt。
4. 「刷新」按钮：重新执行 `loadServers()`（保留上次延迟/版本避免闪烁）。

## 模块常量

- `NAMESPACE = "default"`：与项目默认命名空间一致（`lib/share-mgr.js` 同名）。
- `SERVICE_ID = "ping-pong"`：双方共同注册的服务标识。
- `REPLY_DELAY = 1000`：收到对方消息后，延迟多少毫秒再发送自己的（驱动回合制节奏）。
- `EMOJIS`：对话内容候选 emoji 数组（40 项，含表情 / 动物 / 水果 / 活动 / 符号等），由 `proto.randomEmoji()` 随机返回。

## 依赖的外部 API

### NoneOS Core user（`/nos/user/main.js`）

通过 `const { getUser } = await load("/nos/user/main.js"); const user = await getUser(NAMESPACE);` 获取：

- `user.userId`：当前用户 ID。
- `user.registerService(serviceId, { onMessage(data, ctx) })`：注册服务；返回含 `unregister()` 的句柄。`ctx.fromUserId` / `ctx.remoteUser` 标识发送方。
- `user.connectUser(userId)`：连接远端用户，返回 remote 对象。
- `user.isRemoteUserOnline(userId)`：返回 boolean，判断对端是否在线。
- `user.bind(eventName, handler)`：监听事件，返回解绑函数。本模板使用以下事件：
  - `remote_user_connected`：`event.detail.{ userId, remoteUser, initiatedBy }`，主动 `connectUser` 成功或对端首条消息被动建连时触发。
  - `remote_user_disconnected`：`event.detail.{ userId, reason, error }`，主动 `disconnectUser` 或连接异常时触发。
  - `rtt_update`：`event.detail.{ userId, sessionId, rtt, via }`，底层测量出 RTT 后触发，用于刷新 `myLinkType`。
  - `rtc_state`：`event.detail.{ userId, sessionId, state }`，WebRTC DataChannel 状态变化时触发。`state === "connected"` 表示 RTC 协商成功、DataChannel 已 open，此时把 `myLinkType` 立即切到 `rtc`（避免等下一次 `sendToService` 返回才刷新徽章）；`disconnected` / `failed` / `closed` 时回退为 `relay`。
- `remote.sendToService(serviceId, data, options?)`：向对端服务发消息；返回**结果数组**，每项形如 `{ status, delivered?, sessionId?, via? }`：
  - `status: "ok"` + `delivered: true`：送达，`via` 为 `"rtc"`（WebRTC 直连）或 `"server"`（服务器中转 = relay），本模板据此更新 `myLinkType`。
  - `status: "offline"` / `"error"` / `"discovery_failed"`：未送达，本模板据此将对端标记为离线。
- **RTC 触发机制（重要）**：NoneOS Core 默认让首次发送走服务器中转，从第二次开始**在后台静默尝试 WebRTC 直连**，DataChannel 就绪后自动切到 RTC。因此徽章在握手初期显示「服务器中转」属正常现象，需有数次 ping/pong 往返 + ICE 协商完成（通常几秒到十几秒）后才会切到「WebRTC 直连」。若长期停留在 relay，通常是 NAT 穿透失败（对称型 NAT / UDP 被防火墙阻断 / 双端在同一 localhost 等场景），与上层应用代码无关。

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
2. **自动触发** `generateLink()`（fire-and-forget，不阻塞服务注册）：
   - `hostStatus` 切到「正在自动生成连接...」；
   - 生成期间输入框 placeholder 显示「正在自动生成链接...」，按钮文案固定为「复制」并禁用；
   - 生成完成后 `shareUrl` 写入输入框展示；
   - 失败时 `genStatus` 显示错误信息（不影响服务注册与消息接收）。
3. UI 等待接收方第一条消息到达。
4. 首条消息到达时：
   - 写入 `_customerUserId` / `_customerRemote` / `peerUserId`；
   - 置 `connected = true`、`hostStatus` 切到「接收方已连接，正在轮流填格」；
   - 调用 `bindPeerEvents()` 绑定 `remote_user_*` / `rtt_update` / `rtc_state`；
   - **立即调用 `sendNextPing()` 发第一个 ping 并填入第 1 格**，开启回合制循环（不再等下一条入站消息）。
5. 后续每条入站消息（pong）都 `fillCell(emoji,"peer")` 填对方格，并触发 `scheduleNextSend()` 延迟 1 秒后发自己的 ping。

### 3. 接收方初始化（`initCustomer`）

1. `registerService(SERVICE_ID, { onMessage })` 接收发起方发来的 ping。
2. `connectUser(hostUserId)` 写入 `_remoteUser` / `peerUserId`，再 `isRemoteUserOnline(hostUserId)` 复检。
3. 在线：
   - 置 `connected = true`、`customerStatus` 切到「已连接，正在轮流填格」；
   - 调用 `bindPeerEvents()`；
   - 主动发一条 `{ kind: "ready" }` 信号触发 host 开局（本端不填格）。
4. 不在线：置 `peerOnline = false`，`customerStatus` 切到「发起方不在线，请稍后再试」。
5. 收到 host 的 ping 时 `fillCell(emoji,"peer")` 填对方格，并触发 `scheduleNextSend()` 延迟 1 秒后发自己的 pong。

### 4. 回合制循环（`scheduleNextSend` / `sendNextPing` / `sendNextPong`）

- 收到对方一条消息 → `fillCell(emoji,"peer")` 填对方格 → `scheduleNextSend()`：`clearTimeout` 旧 timer 后 `setTimeout(REPLY_DELAY)` 排入下一次发送。
- 定时器到期后按角色调用 `sendNextPing`（host）或 `sendNextPong`（customer）：
  1. `randomEmoji()` 取一个 emoji；
  2. `sendToService(SERVICE_ID, { kind, emoji })`；
  3. 返回后 `applySendResults(results)` 更新连接方式 / 在线状态；
  4. 发送成功后 `fillCell(emoji,"self")` 填入自己的下一格、`selfCount++`；失败仅 `console.error`，不重试、不打断循环。
- `fillCell` 在 `cellCursor >= 100` 时先 `resetCells()` 清空再填，从而满 100 格自动循环。
- `_stopped` 在 `detached` 时置 `true`，`scheduleNextSend` / `sendNextPing` / `sendNextPong` 入口处判断后短路返回，确保离开页面后不再发送。

### 5. 连接状态与上下线事件（`bindPeerEvents` / `markPeerOnline`）

- 在握手成功后绑定（仅绑定一次，用 `_eventsBound` 防重）：
  - `remote_user_connected`：对端 `userId === peerUserId` 时，若 `peerOnline` 为 false 则切换为 true。
  - `remote_user_disconnected`：匹配 `peerUserId` 时，若当前在线则切换为 false。
  - `rtt_update`：匹配 `peerUserId` 且 `detail.via` 非空时调用 `setLinkTypeFromVia()`。
  - `rtc_state`：匹配 `peerUserId` 时，`state === "connected"` 立即把 `myLinkType` 设为 `rtc`（这是徽章由 relay 切到 rtc 的关键时机，不等下一次 `sendToService` 返回）；`disconnected` / `failed` / `closed` 时若当前是 rtc 则回退到 relay，但**不**据此判定对端下线（下线由 `remote_user_disconnected` 或 `sendToService` 返回 `offline` 判定）。
- `markPeerOnline(online)` 通过比较旧值避免重复赋值，仅更新 `peerOnline`，**不再推任何日志**（本模板无日志区）。
- 顶部徽章文案与样式由模板内联表达式根据 `peerOnline` + `myLinkType` 计算得出（`offline` / `rtc` / `relay` / 连接中）。

### 6. 生成通信链接（`generateLink`，发起方专用，自动触发）

1. `parseSelfIdentity()` 从 `location.pathname`（格式 `/$<namespace>/<dirName>/client/index.html`）解析自身身份。
2. 并行加载 `fs` / `ever-cache` / `share-mgr`。
3. 从 `storage.apps` 找记录、缺 `appId` 则 `generateAppId` 并写回。
4. `rootDir.get(dirName)` 取目录句柄，组装 `app` 对象。
5. `publishApp(app, { appId, appParams: { host: myUserId }, onProgress })`。
6. `payloadHash` 写回 `record.payloadHash`，`shareUrl` 写入输入框展示，`genStatus` 提示「链接已生成，点击「复制」按钮分享给对方」。
7. **不自动复制到剪贴板**——复制动作完全交给用户点击「复制」按钮触发（由 `handleCopyLink` 调用 `copyToClipboard`）。

### 7. 销毁（`detached`）

`this._stopped = true` 终止回合制循环；`clearTimeout(this._timer)` 清掉挂起的延迟发送；依次调用 `_unbindConnected` / `_unbindDisconnected` / `_unbindRtt` / `_unbindRtcState` 解绑事件；`this._svc.unregister()` 反注册服务，避免泄漏句柄。

## 自身身份解析

`parseSelfIdentity()` 使用正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 匹配 `location.pathname`，捕获 `{ namespace, dirName }`。匹配失败返回 `null`，由调用方抛错。
