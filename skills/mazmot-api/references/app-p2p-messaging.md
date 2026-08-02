# 应用间 P2P 通信（分享链接 + 双向消息）

> 本文档讲清楚一个通用模式：**两个 Mazmot 应用如何通过一条分享链接建立点对点通道，并进行双向消息通信**。底层能力来自 noneos-core（`user` / `DataPublisher`）与 Mazmot 的 `lib/share-mgr.js`，请配合对应技能阅读。

## 适用场景

- 两个用户各打开同一个应用的实例，需要实时双向通信（对战、协同、演示等）。
- 不想自建信令/后端，接受「发布者必须在线」这一前提。
- 通信内容为结构化 JSON 文本（不传输二进制）。

## 角色划分

| 角色           | 进入方式                           | 职责                                              |
| -------------- | ---------------------------------- | ------------------------------------------------- |
| 发起方 host    | 直接打开应用（URL 无 `host` 参数） | 注册服务 → 生成带 `host=<myUserId>` 的分享链接 → 等待对端首条消息 |
| 接收方 customer | 打开带 `?host=<userId>` 的链接     | 注册服务 → `connectUser(hostUserId)` → 在线后主动发首条消息让 host 感知 |

判定依据只有一个：URL query 里有没有 `host` 参数。这个参数不是 Mazmot 的保留键（保留键是 `u` / `h`），而是**应用业务参数**，由 host 发布链接时通过 `appParams` 注入。

## 整体流程

```
┌───────── host ─────────┐                ┌──────── customer ─────────┐
│ registerService        │                │ registerService           │
│ generateLink()         │                │                           │
│   appParams:{host:me}  │                │                           │
│   ↓ shareUrl           │  ←分享链接←     │ 打开链接 → run-app 安装    │
│ (等待)                 │                │   ↓ 跳转入口(带?host=..)  │
│                        │                │ connectUser(hostUserId)   │
│                        │                │ isRemoteUserOnline 双检    │
│                        │                │   ↓ 在线                   │
│                        │                │ sendToService(首条消息)    │
│ onMessage(首条) ←───────┼────────────────┼─ customer 上线             │
│   记录对端 / connected  │                │                           │
│   bindPeerEvents()      │                │                           │
│         ↕ 双向 sendToService / onMessage ↕                          │
└────────────────────────┘                └───────────────────────────┘
```

## 一、host：生成带身份的分享链接

核心是把 **自己的 userId** 作为业务参数塞进链接，对方打开后才能反向连回自己。

```js
async generateLink() {
  // 1. 从 location.pathname 解析自身身份（格式 /$<namespace>/<dirName>/client/index.html）
  const self = this.parseSelfIdentity();
  if (!self) throw new Error("无法识别当前应用的目录路径");

  // 2. 并行加载依赖（页面模块内用 /nos/ /lib/ 前缀，ever-cache 用完整 URL）
  const [fsMod, cacheMod, shareMgr] = await Promise.all([
    load("/nos/fs/main.js"),
    load("https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js"),
    load("/lib/share-mgr.js"),
  ]);
  const { init } = fsMod;
  const { storage } = cacheMod;
  const { publishApp, generateAppId } = shareMgr;

  // 3. 从 storage.apps 找本应用记录（用于补 appId / 回写 payloadHash）
  const apps = (await storage.apps) || [];
  const { dirName } = self;
  const record =
    apps.find((a) => a.name === dirName || a.virtualDirName === dirName) ||
    apps.find((a) => (a.dirName || "").endsWith("/" + dirName)) || null;

  // 4. 取目录句柄，补 appId
  const rootDir = await init(self.namespace);
  const handle = await rootDir.get(dirName);
  let appId = (record && record.appId) || "";
  if (!appId) {
    appId = await generateAppId(dirName);
    if (record) { record.appId = appId; await storage.setItem("apps", apps); }
  }

  // 5. 组装 app 对象并发布
  const app = {
    _handle: handle, _recordName: dirName,
    name: (record && record.name) || "my-app",
    version: (record && record.version) || "0.1.0",
    desc: (record && record.desc) || "",
    icon: (record && record.icon) || "📦",
    appId,
  };

  // 6. 关键：把自己的 userId 作为 host 参数带到链接里
  const { shareUrl, payloadHash } = await publishApp(app, {
    appId,
    appParams: { host: this.myUserId },   // ← 对端靠这个反向连你
    onProgress: ({ text }) => { /* 更新进度文案 */ },
  });

  // 7. payloadHash 回写记录（下次分享可幂等复用 chunks）
  if (record && payloadHash) {
    record.payloadHash = payloadHash;
    await storage.setItem("apps", apps);
  }
  this.shareUrl = shareUrl;
}
```

**解析自身身份**用这个正则（路径格式由 Mazmot 运行时约定）：

```js
parseSelfIdentity() {
  const m = location.pathname.match(/^\/\$(.+?)\/(.+?)\/client\/index\.html$/);
  return m ? { namespace: m[1], dirName: m[2] } : null;
}
```

> 链接本身由 `share-mgr.js` 生成，形如
> `{origin}/apps/run-app/?u=<publisherUserId>&h=<payloadHash>&host=<hostUserId>`。
> `u` / `h` 是 Mazmot 保留键，`host` 是应用业务参数。详见 [SKILL.md §4](../SKILL.md)。

## 二、接收端：run-app 的处理

应用层**不需要自己处理下载/安装**。接收方打开链接后，`/apps/run-app/` 会完成：

1. `connectUser(u)` → `requestManifest(h)` → 校验签名者 → 逐块下载 → 组装写入虚拟目录
2. `location.replace("/$<namespace>/<dirName>/client/index.html?host=<hostUserId>")`

于是应用被以**带 `?host=<userId>` 的 URL** 启动——应用层只需读这个参数即可判定角色。安装失败任何一步都会进错误页，**不要吞错**。

## 三、应用入口：角色判定与身份获取

```js
// 页面模块 export default async ({ load }) => { ... }
const NAMESPACE = "default"; // 必须与 lib/share-mgr.js 一致，双方才能在 P2P 网络互相发现
const SERVICE_ID = "my-app-service"; // 双方共同注册的服务标识

const sp = new URLSearchParams(location.search);
const hostUserId = sp.get("host") || "";
const isCustomer = !!hostUserId;

// ...
async ready() {
  const { getUser } = await load("/nos/user/main.js");
  const user = await getUser(NAMESPACE);
  this._user = user;            // 非响应式对象，必须 _ 前缀
  this.myUserId = user.userId;  // 自己的 userId（host 发布时带进链接）

  if (isCustomer) await this.initCustomer();
  else await this.initHost();
}
```

> ⚠️ NoneOS Core 返回的 `user` / `remoteUser` 等是**非响应式复杂对象**，挂到 ofa.js 组件 `this` 上时变量名必须以 `_` 开头（如 `this._user`），避免被响应式系统转换导致异常。

## 四、P2P 握手

### host 端

```js
initHost() {
  this.role = "host";
  const self = this;
  this._svc = this._user.registerService(SERVICE_ID, {
    onMessage(data, ctx) {
      // 第一条消息到达 → 记录对端、置已连接、绑定事件
      if (!self._customerUserId) {
        self._customerUserId = ctx.fromUserId;
        self._customerRemote = ctx.remoteUser;
        self.peerUserId = ctx.fromUserId;
        self.connected = true;
        self.bindPeerEvents();
        // 可选：立即发首条消息开启交互循环
      }
      // 后续消息按业务处理
      self.handleIncoming(data);
    },
  });
  // 后台自动生成链接（fire-and-forget，不阻塞服务注册）
  this.generateLink().catch((err) => console.error(err));
}
```

### customer 端

```js
async initCustomer() {
  this.role = "customer";
  const self = this;
  this._svc = this._user.registerService(SERVICE_ID, {
    onMessage(data, ctx) { self.handleIncoming(data); },
  });

  try {
    const remote = await this._user.connectUser(this.hostUserId);
    this._remoteUser = remote;
    this.peerUserId = this.hostUserId;

    const online = await this._user.isRemoteUserOnline(this.hostUserId);
    if (!online) { this.peerOnline = false; return; }

    this.connected = true;
    this.bindPeerEvents();
    // 主动发首条消息，让 host 感知自己已上线（host 的 onMessage 第一次会落到上面的 if 分支）
    const results = await this._remoteUser.sendToService(SERVICE_ID, { kind: "hello" /*, ...业务字段 */ });
    this.applySendResults(results);
  } catch (err) {
    console.error("连接发起方失败：", err);
  }
}
```

> `connectUser` + `isRemoteUserOnline` 双检是为了避免 `connectUser` 成功但对端实际已离线的边界情况。

## 五、消息收发

### 发送

```js
const results = await this._remoteUser.sendToService(SERVICE_ID, { kind: "move", index: 4 });
this.applySendResults(results);
```

`sendToService` 返回**结果数组**（一个 session 一项），每项形如：

| `status`                 | 含义                 | 附加字段            |
| ------------------------ | -------------------- | ------------------- |
| `"ok"` + `delivered:true` | 送达                 | `via`、`sessionId`  |
| `"offline"`              | 对端无在线标签页     | —                   |
| `"error"`                | 发送异常             | —                   |
| `"discovery_failed"`     | 未能发现对端         | —                   |

`via` 取值：`"rtc"`（WebRTC 直连）/ `"server"`（服务器中转 = relay）。

```js
applySendResults(results) {
  if (!Array.isArray(results) || results.length === 0) return;
  const ok = results.find((r) => r && r.status === "ok");
  if (ok) {
    if (ok.via) this.setLinkTypeFromVia(ok.via);
    if (!this.peerOnline) this.peerOnline = true;
  } else {
    const offline = results.some((r) => r &&
      ["offline", "error", "discovery_failed"].includes(r.status));
    if (offline && this.peerOnline) this.peerOnline = false;
  }
}
```

### 接收

在 `registerService` 的 `onMessage(data, ctx)` 回调里处理：

- `ctx.fromUserId`：发送方 userId
- `ctx.fromSessionId`：发送方会话 id
- `ctx.remoteUser`：可用来直接 `ctx.remoteUser.sendToService(...)` 回复

消息协议由应用自定义，建议带 `kind` 字段做分发，例如 `{ kind: "move", index, mark }`、`{ kind: "restart" }`、`{ kind: "hello" }`。

## 六、连接状态与事件

握手成功后绑定一次（用 `_eventsBound` 防重）。所有事件都校验 `event.detail.userId === peerUserId`，只响应当前对端。

```js
bindPeerEvents() {
  if (this._eventsBound || !this._user || !this.peerUserId) return;
  const self = this;
  const peerId = this.peerUserId;

  this._unbindConnected = this._user.bind("remote_user_connected", (e) => {
    if (e?.detail?.userId === peerId && !self.peerOnline) self.peerOnline = true;
  });
  this._unbindDisconnected = this._user.bind("remote_user_disconnected", (e) => {
    if (e?.detail?.userId === peerId && self.peerOnline) self.peerOnline = false;
  });
  this._unbindRtt = this._user.bind("rtt_update", (e) => {
    if (e?.detail?.userId === peerId && e.detail.via) self.setLinkTypeFromVia(e.detail.via);
  });
  this._unbindRtcState = this._user.bind("rtc_state", (e) => {
    if (e?.detail?.userId !== peerId) return;
    const s = e.detail.state;
    if (s === "connected") { self.setLinkTypeFromVia("rtc"); self.peerOnline = true; }
    else if (["disconnected", "failed", "closed"].includes(s)) {
      if (self.myLinkType === "rtc") self.myLinkType = "relay";
    }
  });
  this._eventsBound = true;
}

setLinkTypeFromVia(via) {
  const next = via === "rtc" ? "rtc" : via ? "relay" : "";
  if (next && next !== this.myLinkType) this.myLinkType = next;
}
```

### RTC 静默升级（重要）

NoneOS Core 默认让**首次发送走服务器中转**，从第二次开始在后台静默尝试 WebRTC 直连，DataChannel 就绪后自动切 RTC。因此：

- 握手初期 UI 显示「服务器中转」是**正常现象**，通常几秒~十几秒（需数次往返 + ICE 协商）后才切「WebRTC 直连」。
- `rtc_state` 的 `state === "connected"` 是徽章从 relay 切到 rtc 的**关键时机**，不要等下一次 `sendToService` 返回。
- 长期停留在 relay 通常是 NAT 穿透失败（对称型 NAT / UDP 被防火墙阻断 / 双端同 localhost 等），**与上层应用代码无关**。
- `rtc_state` 断开只回退徽章到 relay，**不要**据此判定对端下线——下线由 `remote_user_disconnected` 或 `sendToService` 返回 `offline` 判定。

## 七、销毁（detached）

```js
detached() {
  // 停止业务循环（如有 setInterval / setTimeout）
  // 解绑事件
  [this._unbindConnected, this._unbindDisconnected, this._unbindRtt, this._unbindRtcState]
    .forEach((fn) => { try { fn && fn(); } catch (_) {} });
  this._eventsBound = false;
  // 反注册服务，避免泄漏句柄
  if (this._svc) { try { this._svc.unregister(); } catch (_) {} }
}
```

## 关键约定与边界

- **命名空间必须一致**：双方都用 `getUser(NAMESPACE)` 且 `NAMESPACE` 相同（项目默认 `"default"`，与 `lib/share-mgr.js` 一致），否则在 P2P 网络里无法互相发现。
- **服务 ID 必须一致**：双方 `registerService(SERVICE_ID, ...)` 用同一个 `SERVICE_ID`。
- **发布者必须在线**：接收端从发布者 IndexedDB 拉 chunk；host 标签页关闭后，未拉完的 chunk 无法继续，且已建立的 P2P 连接也会断。涉及关闭/切后台/断网的 UI 都要以此为前提。
- **只支持 UTF-8 文本**：消息载荷是 JSON，不要塞二进制。应用文件分享同样只支持文本（见 [SKILL.md §4](../SKILL.md)）。
- **无权威方 / 无防作弊**：双方都能本地改状态，依赖「收到消息才改」的约定维持一致性。Demo 性质，不要套用到需要强一致/防作弊的生产场景。
- **URL 前缀**：页面模块内 `/nos/*`、`/lib/*` 用本地前缀（由 NoneOS Core Service Worker 拦截，离线可用、跨域安全）；`ever-cache` 不走 ofa.js 仓库前缀，沿用完整 jsdelivr URL（见上文代码示例）。
- **非响应式对象用 `_` 前缀**：`this._user` / `this._remoteUser` / `this._svc` 等挂到 ofa.js 组件实例时必须以 `_` 开头。
