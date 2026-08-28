# mz/cert —— 系统级证书能力使用指南

`/mz/cert/main.js` 是 Mazmot 对 noneos-core `user.cred`（凭证管理器）的系统级封装，加上 Mazmot 自己的链式引用语法与签发历史服务。任何 Mazmot 应用（含官方应用与用户自建应用）需要「签发 / 领取 / 吊销证书」「查询用户卡片」「链式授权」时都应使用它，不要直接散落调用 `user.cred`。

## 0. 加载方式

```javascript
// 页面模块 / 组件内（推荐，符合 /nos 与 /mz 的加载时机约束）
export default async ({ load }) => {
  const {
    issueCert, claimCert, revokeCert,
    lookupProfile, verifyProfileCard,
    appendIssueHistory, listIssued, mergeIssuedView,
    buildRef, parseRef, buildChain, collectChainFields, certFingerprint,
  } = await load("/mz/cert/main.js");
  // ...
};

// 入口 HTML / Core 已就绪的 app-config.js 也可以静态 import
import { issueCert } from "/mz/cert/main.js";
```

模块顶层不 import `/nos/*`：`ensureUser`（身份复用 `/mz/share-mgr.js` 的 default 命名空间用户）、`verifyData`、storage 都在调用时按需动态加载，因此页面模块顶层静态 import 该模块也是安全的。

## 1. 核心概念（先读，避免踩坑）

### 1.1 证书的两层标识

| 名称 | 是什么 | 用途 |
|---|---|---|
| **key（存储主键 `id` 字段）** | `${role}-${issuer}-${subject}` | 槽位标识：管存储（同 key 续签按 signTime 覆盖）、管拉取（`claimCert` 的精确 key） |
| **版本指纹 `certFingerprint(signature)`** | `sha256_hex(signature)` | "这一版"的稳定 ID：内容变一字节即变，跨设备一致，用于对账/防重/展示 |

不要用 `user.verify(profile)` 验别人的卡片——它固定用**当前用户自己的公钥**，验对方自签的 profile 必然 `false`。请用 `verifyProfileCard`。

### 1.2 送达是拉取模式（无推送）

core 已移除 `shareCert` 推送。签发方 `issueCert` 后证书只存在**签发方的本地凭证库**；接收方必须 `claimCert(签发者userId, role)` 在线拉取（自动验签入库、按 signTime 收敛、幂等）。签发方离线则拉取失败。

### 1.3 吊销无痕，历史由 mz/cert 补

core 的 `cred.delete(id)` 是物理删除（无软删除/tombstone）。`appendIssueHistory` + `listIssued` 提供"签发过什么、哪些已吊销"的审计视图，存储在 `getStorage("mz-cert")` 的 `issue-history` 键（系统级共享，非应用私有；首次访问自动迁移旧版 `cred-manager` 空间数据）。

## 2. API 详解

### 2.1 签发 —— `issueCert`

```javascript
const cert = await issueCert({
  subject: "对方userId",       // 必填，被授权者
  role: "editor",              // 必填，角色
  expire: Date.now() + 7 * 24 * 3600 * 1000,
  // expire: 时间戳（绝对时间，随内容签名，无法篡改）
  //       | null（永不过期）| 不传（默认 30 天）
  extras: {                    // 可选，自定义字段，全部随证书签名
    permission: "all",
    parent: "[chain_key:admin-alice-bob]",   // 链式引用，见 §3
  },
});
// → 完整证书记录 { id, role, issuer, subject, signTime, expire?, signature, ...extras }
// extras 的 key 不得使用保留字：id/role/issuer/subject/signTime/expire/signature/publicKey（抛错）
```

签发后建议立即记历史（可选但推荐）：

```javascript
await appendIssueHistory({
  id: cert.id, role: cert.role, subject: cert.subject,
  signTime: cert.signTime, expire: cert.expire || null,
});
```

### 2.2 领取 —— `claimCert`

```javascript
const cert = await claimCert("保管人userId", "editor");
// → 证书记录（已自动验签并写入我的本地凭证库，重复领取安全）
// → null：无匹配（role/签发者不符，或保管人离线）

// 领取经他人托管的组织证书：保管人 = 转发者（创建者），issuerId = 组织
const cert = await claimCert("创建者userId", "staff", { issuerId: "组织userId" });
// core 的 getRecord 支持拉取他方托管的第三方证书（key 按精确 issuer 匹配）
```

### 2.3 吊销 —— `revokeCert`

```javascript
await revokeCert(cert.id);   // = cred.delete，本地凭证库物理删除
```

吊销后 `listIssued` 中该条目显示为 `revoked: true`（前提是签发时记过历史）。

### 2.4 用户卡片 —— `lookupProfile` + `verifyProfileCard`

```javascript
// 查询（getProfile：本地缓存优先，无缓存才联网）
const profile = await lookupProfile(userId);
// 强制在线刷新（requestProfile：总是走网络，按 signTime 收敛，超时自动重发）
const fresh = await lookupProfile(userId, { force: true });

// 验签：内嵌公钥验签 + subject/issuer 一致性（防张冠李戴）
const ok = await verifyProfileCard(profile, userId);
// profile: { role:"profile", issuer, subject, publicKey, username, signTime, signature }
```

### 2.5 签发列表与吊销留痕 —— `listIssued` / `mergeIssuedView`

```javascript
const items = await listIssued();            // 我签发过的全部（现行 + 已吊销）
const items = await listIssued(subjectId);   // 只看签给某个用户的

// 条目结构（时间戳为原始值，展示格式化由应用负责）：
// { id, role, subject, signTime, expire, revoked: boolean, expired: boolean }
```

`mergeIssuedView(liveCerts, history, now?)` 是合并逻辑的纯函数导出（`liveCerts` 传 cred.query 结果，`history` 传历史条目数组），供测试或自定义数据源复用。

### 2.6 配对码（短码换用户卡片）—— `/mz/cert/pairing.js`

对接 cred-hub 的 `/pairing/register` / `/pairing/resolve`，解决首次交换需手输超长 userId 的问题。**服务器只做中转：resolvePairingCard 返回的是未验签原始数据，调用方必须照常 `verifyProfileCard(profile, profile.subject)`。**

```javascript
import { requestPairingCode, resolvePairingCard, PAIRING_CODE_PATTERN }
  from "/mz/cert/pairing.js";   // 纯客户端封装，页面模块可顶层静态导入

// 取码方：提交本地最新签名 profile 卡片 → { code: "6或8位小写数字", expiresAt }（服务端按活跃量自适应码长；倒计时用 expiresAt，别猜窗口）
const card = await user.cred.getProfile(user.userId);   // 无卡片先引导用户生成资料
const { code, expiresAt } = await requestPairingCode(card);
// 同一用户 5 分钟窗口内重复提交幂等（同码覆盖）；服务端地址默认 http://localhost:8787，
// 可经 getStorage("mz-cert") 的 "pairing-server" 键覆盖

// 查询方：凭码解析完整卡片
const profile = await resolvePairingCard(code);
await verifyProfileCard(profile, profile.subject);
```

输入框兼容判定：`PAIRING_CODE_PATTERN`（6-10 位小写字母数字；userId 是更长的十六进制串不会误命中）。参考实现：cred-manager 的 my-info.html（取码 + 倒计时）/ query-user.html（短码分支）。

### 2.7 实时互授 —— `official-apps/cred-manager/lib/live-share.js`

在配对码 + 拉取模式之上补一条**实时通道**：双方打开 cred-manager「互授」页后，基于 noneos-core 用户服务通信（`LocalUser.registerService` / `RemoteUser.sendToService`，服务 appId `cred-share-v1`）互见卡片、发现对方保管的与自己相关的证书。**拉取模式**：服务消息只传匹配通知与证书元数据清单，证书本体始终走 `claimCert`（core 按精确 key 拉取、自动验签入库），不经消息传签名内容。要点：

- **可靠性自建**（noneos-core 只保证尽力投递）：消息信封 `{ msgId, kind: "data"|"ack", payload }`；接收方先回 ACK（`ctx.fromSessionId` 定向）再去重；发送方 3s 超时复用同一 msgId 重发（≤3 次）；同目标串行队列，ACK 不进队列；`list-response` 用 `replyTo` 关联请求。
- **在线约束**：服务只在 cred-manager 打开期间注册（页面 `attached` 注册 / `detached` 注销），对端离线时发送方直接得到「对方不在线」，拉取也要求保管人在线（core 拉取模式固有限制）。
- **本地存储**（`getStorage("mz-cert")`）：`incoming-matches` / `outgoing-matches`（均 7 天过期，上限 50 条）。

页面用法见 `pages/live-share.html`；导出的 API：`registerShareService(user, { onMatch, listCerts })`、`notifyMatch(remoteUser, card)`、`requestCertList(remoteUser, subject)`、`isPeerReachable(user, peerId)` 及匹配列表的存储函数。

## 3. 链式引用语法 —— `[<type>:<payload>]`

证书自定义字段的值可以放一个**引用字符串**实现"链式证书"（授权来源指向另一张证书）：

```
语法：    "[" type ":" payload "]"
type：    [a-z0-9_]{1,16} 的注册制类型令牌，本期仅 chain_key
payload： 不含 "]" 的字符串
```

| API | 用途 |
|---|---|
| `buildRef(type, payload)` | 构建引用字符串 |
| `parseRef(value)` | 解析；未注册类型 / 普通字符串 → `null`（按普通文本渲染） |
| `normalizeChainKey(payload)` | chain_key payload（`role-issuer-subject`）按前两个 `-` 拆回 `{role, issuer, subject}`（与 core `normalizeKey` 同规则） |
| `shortenRef(parsed)` | 缩短展示（如 `editor: aaa… → bbb…`），完整值放 `title` |

**为什么用 key 而不是指纹做链引用**：key 是槽位引用，链上任何一环续签更新（同 key 新 signTime 覆盖）后引用依然有效，链条无需重签；指纹绑定"某一版"，一更新就悬空。指纹的定位是版本对账，两者分层使用。

**一条字段值只放一个引用**；要多个引用（DAG / 多个授权来源）就加多个字段。未注册类型（含将来的 `chain_id` 等）原样灰显，不影响老数据。

## 4. 链视图 —— `buildChain` / `collectChainFields`

### 4.1 `buildChain`：从一张证书出发遍历链

```javascript
const nodes = await buildChain(
  rootCert,                                    // 完整证书记录（含自定义字段）
  async (id) => byId[id] ?? null,              // resolveCert：本地凭证库解析（依赖注入）
  async (cert) => certFingerprint(cert.signature), // 可选，节点指纹
);
// → [{ depth, id, role, issuer, subject, status, fingerprint, viaField }]
//    status: "ok" | "expired" | "missing"（本地缺失，不远程拉取）
```

- 自动扫描证书全部自定义字段上的 chain_key 引用并递归；
- **环检测**（任何人都能构造 A→B→A，已访问即停）+ 深度上限 32（`CHAIN_MAX_DEPTH`）；
- 纯函数、依赖注入，便于单测与自定义数据源。

### 4.2 `collectChainFields`：证书详情页的一步到位整理

```javascript
const { plain, chains } = await collectChainFields(
  cert,                                        // 目标证书
  async (id) => byId[id] ?? null,
  async (c) => certFingerprint(c.signature),
);
// plain: [{ key, value }]      —— 普通自定义字段
// chains: [{ field, nodes }]   —— 每个链字段展开好的节点列表（同 buildChain）；
//                                 引用证书本地缺失时该链为单个 missing 根节点
```

### 4.3 典型页面用法（byId 索引）

```javascript
const user = await ensureUser();               // /mz/share-mgr.js
const byId = {};
for await (const cert of user.cred.values({}, { includeExpired: true })) {
  if (cert.role !== "profile") byId[cert.id] = cert;
}
const { plain, chains } = await collectChainFields(cert, async (id) => byId[id] ?? null);
```

## 5. 参考实现

- 官方应用 [official-apps/cred-manager/](../../../../../official-apps/cred-manager/)：签发（query-user.html）、领取（claim.html）、本地证书列表（my-certs.html）、证书详情 + 链视图（cert-detail.html）、已知用户（known-users.html）。
- 纯函数测试 [mz/cert/test/](../../../../../mz/cert/test/)：`ref.sb.html`（语法往返/拒绝规则/key 拆分）、`chain.sb.html`（遍历/环检测/缺失/collectChainFields）、`history.sb.html`（mergeIssuedView）。
