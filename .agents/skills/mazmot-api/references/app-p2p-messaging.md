# 应用间 P2P 通信（分享链接 + 双向消息）

> 本文档讲清楚一个通用模式：**两个 Mazmot 应用如何通过一条分享链接建立点对点通道，并进行双向消息通信**。底层能力来自 noneos-core（`user` / `DataPublisher`）与 Mazmot 的 `mz/share-mgr.js`，请配合对应技能阅读。

## 读本文前需知（前置概念）

文档里的代码片段都遵循以下约定，先理解这几条再往下看：

- **"两个应用实例" = 同一份应用代码、两个用户各跑一个**。不是两套代码：host 用户在自己的 Mazmot 里直接打开应用，customer 用户通过 host 发来的分享链接安装（或免安装跳转）后打开**同一份**应用的另一个实例。两端代码完全一样，靠 URL 判定谁是 host、谁是 customer。
- **代码运行在哪**：所有用 `this.xxx` / `load(...)` 的片段，都是 ofa.js **页面模块**（`<template page>` 内的 `export default async ({ load }) => ({ data, proto, ready, detached })`）。`this` 指向页面组件实例；`load` 是页面模块构造函数注入的动态加载函数（可加载 `/nos/*`、`/mz/*`、远程 URL 等模块）。方法挂在 `proto` 上，响应式数据放在 `data`，非响应式对象用 `_` 前缀直接挂到 `this`。
- **分享链接 / 接收端安装 / `appParams`**：host 调 `publishApp(app, { appParams: { host: myUserId } })` 把自己的 userId 注入链接 query；customer 打开链接后，Mazmot 的 `/apps/run-app/` 接收端会自动完成下载/安装，最终 `location.replace("/$<namespace>/<dirName>/client/index.html?host=<hostUserId>")` 启动应用——所以应用层**不需要自己处理下载**，只需读 URL 上的 `host` 参数即可。完整接收端流程见 [SKILL.md §4](../SKILL.md) 与第 §二 节。
- **`publishApp` / `getUser` 等是异步函数**，返回 Promise；加载方式为 `const { publishApp } = await load("/mz/share-mgr.js")`、`const { getUser } = await load("/nos/user/main.js")`。
- **命名空间（NAMESPACE）**：Mazmot 默认 `"default"`，与 `mz/share-mgr.js` 一致。双方必须用同一个 NAMESPACE 才能在 P2P 网络互相发现。
- **非响应式对象用 `_` 前缀**：NoneOS Core 返回的 `user` / `remoteUser` 等是复杂对象，挂到 ofa.js 组件 `this` 上时变量名**必须**以 `_` 开头（如 `this._user`），否则会被 ofa.js 响应式系统转换导致异常。

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

## 最小完整骨架（先看这个）

下面是一个**可跑的最小空壳**——把字段、方法、生命周期都拼在一起，复制后把 `// TODO: 业务` 替换成你的实际逻辑即可。后续各节是各模块的详细解释。**如果你只想照着搭应用，可以只看这一节 + §五（消息收发）+ §六（事件）+ §七（销毁）。**

### 响应式数据字段（放在 `data`）

| 字段             | 类型    | 初始值         | 用途                                                       |
| ---------------- | ------- | -------------- | ---------------------------------------------------------- |
| `role`           | string  | `"loading"`    | `"loading"` / `"host"` / `"customer"`，决定渲染分支        |
| `myUserId`       | string  | `""`           | 当前用户 ID（host 发布时带进链接）                         |
| `hostUserId`     | string  | 从 URL 解析    | customer 模式从 URL `host` 参数解析出的对端 ID             |
| `connected`      | boolean | `false`        | 是否已完成握手（host：收到对端首条消息；customer：在线检测通过） |
| `peerUserId`     | string  | `""`           | 对端 userId，用于 `remote_user_*` / `rtt_update` / `rtc_state` 事件匹配 |
| `peerOnline`     | boolean | `true`         | 对端是否在线（默认 `true`，事件 / 收发结果触发后修正）      |
| `myLinkType`     | string  | `""`           | 连接方式：`""`（未知）/ `"rtc"`（WebRTC 直连）/ `"relay"`（服务器中转） |
| `shareUrl`       | string  | `""`           | host 已生成的分享链接（仅 host 用到）                      |
| `generating`     | boolean | `false`        | host 是否正在生成链接（仅 host 用到）                      |
| `genStatus`      | string  | `""`           | host 生成链接进度 / 失败文案（仅 host 用到）               |
| *（业务字段）*    | —       | —              | 你自己的游戏 / 协同状态（棋盘、计分、列表等）              |

### 非响应式实例属性（以 `_` 前缀，直接挂 `this`）

| 属性                                | 哪一端有     | 用途                                              |
| ----------------------------------- | ------------ | ------------------------------------------------- |
| `this._user`                        | 双方         | NoneOS Core user 对象（`getUser(NAMESPACE)` 返回）|
| `this._svc`                         | 双方         | `registerService` 返回的服务句柄，`detached` 时 `unregister()` |
| `this._customerRemote` / `_customerUserId` | host    | 对端引用，首条消息到达时从 `ctx.remoteUser` / `ctx.fromUserId` 写入 |
| `this._remoteUser`                  | customer     | `connectUser` 返回的远端对象                      |
| `this._eventsBound`                 | 双方         | 是否已绑定对端事件，避免重复绑定                  |
| `this._unbindConnected` / `_unbindDisconnected` / `_unbindRtt` / `_unbindRtcState` | 双方 | 四个事件解绑函数，`detached` 时调用 |
| *（业务用的 timer / 句柄）*         | —            | 如 `this._timer`（`setInterval` / `setTimeout` 句柄），`detached` 时清理 |

### 可跑的空壳代码

```js
export default async ({ load }) => {
  const NAMESPACE = "default"; // 必须，双方一致才能互相发现
  const SERVICE_ID = "my-app-service"; // 必须，双方一致

  // 角色判定：URL 带 host 参数 → customer
  const sp = new URLSearchParams(location.search);
  const hostUserId = sp.get("host") || "";

  return {
    data: {
      role: "loading",
      myUserId: "",
      hostUserId,
      connected: false,
      peerUserId: "",
      peerOnline: true,
      myLinkType: "",
      // host 专用
      shareUrl: "",
      generating: false,
      genStatus: "",
      // TODO: 你的业务字段
    },

    proto: {
      // === 工具：从 sendToService 返回值 / via 字段推断连接方式 ===
      setLinkTypeFromVia(via) {
        const next = via === "rtc" ? "rtc" : via ? "relay" : "";
        if (next && next !== this.myLinkType) this.myLinkType = next;
      },

      // === 工具：统一处理 sendToService 返回值 ===
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
      },

      // === 处理收到的消息（业务在这里分发）===
      handleIncoming(data) {
        if (!data || typeof data !== "object") return;
        // 收到消息说明对端在线
        if (!this.peerOnline) this.peerOnline = true;
        // TODO: 按 data.kind 分发业务逻辑
        //   if (data.kind === "move") { ... }
        //   else if (data.kind === "restart") { ... }
      },

      // === 绑定对端事件（握手成功后调用一次）===
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
      },

      // === host 初始化 ===
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
              // self._customerRemote.sendToService(SERVICE_ID, { kind: "hello" }).then(self.applySendResults.bind(self));
            }
            self.handleIncoming(data);
          },
        });
        // 后台自动生成链接（见 §一），不阻塞服务注册
        this.generateLink().catch((err) => console.error("生成链接失败：", err));
      },

      // === customer 初始化 ===
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
          // 主动发首条消息让 host 感知上线
          const results = await this._remoteUser.sendToService(SERVICE_ID, { kind: "hello" });
          this.applySendResults(results);
        } catch (err) {
          console.error("连接 host 失败：", err);
        }
      },

      // === 生成分享链接（host 专用，完整实现见 §一）===
      async generateLink() {
        // 见 §一「host：生成带身份的分享链接」完整实现
        // 核心：publishApp(app, { appParams: { host: this.myUserId } })
      },

      // === 发送业务消息（示例）===
      async sendSomething() {
        if (!this.connected) return;
        const remote = this.role === "host" ? this._customerRemote : this._remoteUser;
        if (!remote) return;
        const results = await remote.sendToService(SERVICE_ID, { kind: "move" /*, ...业务字段 */ });
        this.applySendResults(results);
      },
    },

    // === 生命周期 ===
    async ready() {
      const { getUser } = await load("/nos/user/main.js");
      const user = await getUser(NAMESPACE);
      this._user = user;
      this.myUserId = user.userId;
      if (hostUserId) await this.initCustomer();
      else await this.initHost();
    },

    detached() {
      // 停止业务循环（如有 setInterval / setTimeout）
      // if (this._timer) { clearInterval(this._timer); this._timer = null; }
      // 解绑事件
      [this._unbindConnected, this._unbindDisconnected, this._unbindRtt, this._unbindRtcState]
        .forEach((fn) => { try { fn && fn(); } catch (_) {} });
      this._eventsBound = false;
      // 反注册服务
      if (this._svc) { try { this._svc.unregister(); } catch (_) {} }
    },
  };
};
```

> 这段空壳覆盖了 §三 ~ §七 的所有通用逻辑；§一（生成链接的完整代码）和 §二（接收端做了什么）按需阅读。

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

  // 2. 并行加载依赖（页面模块内用 /nos/ /mz/ 本地前缀）
  const [fsMod, storageMod, shareMgr] = await Promise.all([
    load("/nos/fs/main.js"),
    load("/nos/storage/main.js"),
    load("/mz/share-mgr.js"),
  ]);
  const { init } = fsMod;
  const storage = storageMod.getStorage("mazmot");
  const { publishApp, generateAppId } = shareMgr;

  // 3. 从 storage 的 apps 键找本应用记录（用于补 appId / 回写 payloadHash）
  const apps = (await storage.getItem("apps")) || [];
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

- **命名空间必须一致**：双方都用 `getUser(NAMESPACE)` 且 `NAMESPACE` 相同（项目默认 `"default"`，与 `mz/share-mgr.js` 一致），否则在 P2P 网络里无法互相发现。
- **服务 ID 必须一致**：双方 `registerService(SERVICE_ID, ...)` 用同一个 `SERVICE_ID`。
- **发布者必须在线**：接收端从发布者 IndexedDB 拉 chunk；host 标签页关闭后，未拉完的 chunk 无法继续，且已建立的 P2P 连接也会断。涉及关闭/切后台/断网的 UI 都要以此为前提。
- **只支持 UTF-8 文本**：消息载荷是 JSON，不要塞二进制。应用文件分享同样只支持文本（见 [SKILL.md §4](../SKILL.md)）。
- **无权威方 / 无防作弊**：双方都能本地改状态，依赖「收到消息才改」的约定维持一致性。Demo 性质，不要套用到需要强一致/防作弊的生产场景。
- **URL 前缀**：页面模块内 `/nos/*`、`/mz/*` 用本地前缀（由 NoneOS Core Service Worker 拦截，离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net/...` 完整 URL（见上文代码示例）。
- **非响应式对象用 `_` 前缀**：`this._user` / `this._remoteUser` / `this._svc` 等挂到 ofa.js 组件实例时必须以 `_` 开头。
