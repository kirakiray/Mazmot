# CONTEXT.md — 凭证管理器（cred-manager）

本文件为 AI 代理提供本应用的架构速查：目录结构、页面职责、数据模型与依赖的平台 API。与代码保持同步维护。

## 应用概览

- **名称**：Credential Manager（凭证管理器），官方应用（`official-apps/cred-manager/`），应用市场分发。
- **定位**：管理 NoneOS 凭证——用户卡片（profile）、带自定义字段与链式引用的签名证书、组织账户（离线身份 + owner/staff 证书），以及本地持有的全部凭证。
- **无自有存储**：所有数据存在 NoneOS 用户凭证库（`user.cred`）与 `/mz/cert`、`/mz/org` 系统级模块中，本应用不直接使用 `/nos/storage`。

## 目录结构

```
├── AGENTS.md            # AI 开发规范（自包含）
├── CONTEXT.md           # 本文件
├── __app.json           # 应用市场元数据 + files 分发清单
├── app.json             # 运行时应用清单（name/entry/appConfig/i18n）
├── index.html           # 入口 HTML：ofa.js + router + st-boot 主题引导 + o-router/o-app
├── app-config.js        # home 路由指向 pages/query-user.html；侧栏常驻的轻量切页动画配置
├── comps/
│   └── cert-item.html   # m-cert-item 证书条目组件（可折叠列表项，多页面复用）
└── pages/
    ├── home.html        # 布局页：左侧栏导航 + slot 内容区（所有子页的 parent）
    ├── query-user.html  # 查询用户 + 签发证书（默认首页）；顶部可选择配对服务器以解析配对码
    ├── my-info.html     # 我的信息：改用户名、复制我的用户 ID / 公钥 / 配对码；生成配对码前可选择配对服务器
    ├── known-users.html # 已知用户：本地缓存的 profile 卡片列表
    ├── claim.html       # 领取证书（仅作为 my-certs 弹窗内嵌 o-page 使用，无 parent）
    ├── my-certs.html    # 本地证书列表（tab 过滤 + 领取/导入弹窗）
    ├── cert-detail.html # 证书详情（含链式展开 + JSON 源数据）
    ├── orgs.html        # 组织列表 + 创建组织
    └── org-detail.html  # 组织详情：员工签证 / 重签 / 导入 / 吊销 / 删除组织
```

## 路由与页面层级

- 入口 `index.html` → `o-app src="./app-config.js"`，`home` 指向 `pages/query-user.html`。
- 除 `claim.html` 外，所有 `pages/*.html` 都 `export const parent = "./home.html"`，嵌套在 `home.html` 的 `slot` 内（侧栏常驻）。`claim.html` 故意不挂 parent：它只经 `my-certs.html` 的 dialog 内 `<o-page src="./claim.html">` 内嵌使用，挂 parent 会把侧栏 layout 套进弹窗。
- 页面间跳转用 `this.app.goto("./pages/xxx.html?...")`（相对路径以应用根目录为基准）。
- 跨页面传待查询用户：`known-users.html` 写 `this.app.__pendingQueryUser = userId` 后跳 `query-user.html`，后者在 `attached` 中消费并清空。
- `home.html` 侧栏高亮逻辑：`routerChange` / `ready` 时按当前页面路径匹配；`cert-detail` 归入「本地证书」高亮，`org-detail` 归入「组织管理」高亮。
- `home.html` 的 `.content` 有两个 ofa 路由切换 hack（源码注释详述）：`position: relative` 锚定旧子页 absolute 定位；`::slotted(o-page) { width: 100% }` 防旧页宽度塌缩。**改动布局时勿删**。

## 数据模型

### 证书（存于用户凭证库 `user.cred`）

| 字段 | 说明 |
| --- | --- |
| `id` | 证书唯一标识（链式引用 key） |
| `role` | 角色（`profile` 为用户资料卡保留值，列表页一律过滤） |
| `issuer` / `subject` | 签发者 / 主体用户 ID |
| `signTime` / `expire` | 签发时间戳 / 过期时间戳（`null` = 永不过期） |
| `signature` / `publicKey` | 签名与签发者公钥 |
| 其他任意字段 | 自定义字段，随证书一并签名；值可为 `[chain_key:<id>]` 形式的链式引用 |

页面派生字段（非持久化，仅在列表渲染时附加）：

- `fromMe`：`issuer === 当前用户 ID`（我签发的）。
- `others`：issuer 与 subject 都不是我（为他方托管的证书，如 org 替员工签发经我转交的副本）。
- `revoked` / `expired`：吊销标记 / `expire < Date.now()`。

### 链式引用（`[chain_key:<certId>]`）

- 生成：签发时点字段旁的链接图标 → 弹窗列出本地证书（排除 profile）→ `buildRef("chain_key", cert.id)` 写入字段 value。
- 解析与展示：`parseRef` / `shortenRef` / `normalizeChainKey` 把引用拆出 role/issuer/subject；`cert-detail.html` 用 `collectChainFields` 递归展开整条链（含 valid / expired / missing 状态）。

### 用户资料卡（profile）

- `known-users.html` 用 `user.cred.query({ role: "profile" })` 列出缓存的资料（含自己）；`subject` 即 userId，`username` / `signTime` 为展示字段。
- 组织账户的 profile 用 `/mz/org/main.js` 的 `isOrgProfile(profile)` 判别。

### 组织

- 组织 = 独立离线身份（`getUser("org:<name>")`），由创建者托管转发；创建者自动持有 owner 证书。
- 组织证书存组织用户的凭证库，详情页经 `?ns=org:<name>` 命名空间访问。
- 员工领证：在「领取证书」页填**创建者的用户 ID**（保管人）+ 角色，可选 `actualIssuer` 填组织 ID。

## 依赖的平台 API

### `/mz/share-mgr.js`

- `ensureUser()`：获取当前 NoneOS 用户（惰性初始化）。返回对象含 `userId`、`getInfo()`、`updateInfo(partial)`（合并更新并自动签名）、`cred`（凭证库，见下）。
- `user.cred`：`values({}, { includeExpired: true })`（异步迭代全部证书）、`query(key, opts)`、`import(certObj)`、`delete(certId)`、`deleteProfile(userId)`。

### `/mz/cert/main.js`

| 导出 | 用途（使用处） |
| --- | --- |
| `issueCert({ subject, role, expire, extras })` | 签发证书（query-user） |
| `revokeCert(certId)` | 吊销（从本地凭证库删除，query-user） |
| `appendIssueHistory(record)` / `listIssued(targetId)` | 签发历史（吊销后仍保留，query-user） |
| `claimCert(issuerId, role, { issuerId: actualIssuer })` | 按精确 key 在线拉取证书，返回 `null` 表示未找到（claim） |
| `lookupProfile(targetId, { force })` | 拉取用户资料；默认本地缓存优先，`force: true` 强制在线（query-user） |
| `verifyProfileCard(profile, targetId)` | 验证资料卡签名（query-user） |
| `buildRef(type, payload)` / `parseRef(raw)` / `shortenRef(ref)` | 链式引用的生成与解析 |
| `normalizeChainKey(key)` / `collectChainFields(cert, getById, fingerprintOf)` | 证书 id 归一化 / 自定义字段链展开（cert-item、cert-detail） |
| `certFingerprint(signature)` | 证书指纹（异步） |

### `/mz/org/main.js`

| 导出 | 用途 |
| --- | --- |
| `createOrg({ name })` | 创建组织（创建者成 owner） |
| `listOrgs()` | 组织清单（`{ name, userId, createdAt }`） |
| `getOrg(name)` | 组织用户对象（`getInfo()` 等） |
| `updateOrgInfo(name, { username })` | 改组织展示名 |
| `issueStaffCert({ org, subject, role, expire })` | 以组织身份签员工证书，托管到创建者账户 |
| `listOrgIssued(name)` | 该组织已签发证书（含已吊销） |
| `revokeOrgCert(name, certId)` / `deleteOrg(name)` | 吊销 / 删除组织 |
| `importOrgCerts(name)` / `reissueOrgCerts(name)` | 组织证书导入本地库（幂等）/ 按当前时间重签 |
| `isOrgProfile(profile)` | 判断 profile 是否组织账户 |

### `/nos/*` 与 `/ncomp/*`

- `/nos/locale-text/locale-text.html`（`<locale-text>` 双语组件）与 `/nos/locale-text/get-locale-text.js`（`getLocaleText({cn, en}, params)`）：所有文案与占位符。
- `/nos/n-icon/n-icon.html`：图标。
- `/ncomp/user-name/user-name.html`（`<n-user-name user-id>`）、`/ncomp/user-status/user-status.html`（`<n-user-status>` 在线状态点）：用户展示组件。
- `/nos/user/main.js` 的 `getUser("org:<name>")`：cert-detail 在 `?ns=` 命名空间下取组织用户（组件内 `load()` 按需加载）。

## 关键流程

### 查询用户（query-user.html，默认首页）

顶部选择「配对服务器」（`mz-cert` 存储空间的 `pairing-server` 键，默认 `https://asia-1.cred-hub.noneos.com`，可选本地 `http://localhost:8787`）。输入 userId 或配对码 → 配对码经 `resolvePairingCard` 解析 → `verifyProfileCard` 验签渲染卡片（失败红色徽标 + toast 警告）→ 展示「我签发给该用户的证书」列表。

### 签发个人证书（query-user.html）

填 role + 有效期（7/30/90/365 天 / 永不 / 自定义 datetime）+ 可选自定义字段（可插入 chain_key 引用）→ `issueCert` → `appendIssueHistory` → 刷新列表。证书留在**我的**凭证库，由对方主动领取。自定义字段名禁止保留字（见 AGENTS.md）。

### 领取证书（claim.html，嵌于 my-certs 弹窗）

输入保管人 userId + 角色（可选实际签发者 = 组织 ID）→ `claimCert` 在线拉取（需对方在线）→ core 自动验签、按 signTime 收敛入库（幂等）。

### 本地证书（my-certs.html）

`user.cred.values()` 遍历（排除 profile，含过期）→ tab：全部 / 我签发的（fromMe）/ 签发给我的（!fromMe && !others）/ 其他人的（others）。操作：删除（`cred.delete`）、领取弹窗、导入弹窗（粘贴 JSON → 字段校验 `id/issuer/subject/role/signature` → `cred.import`）。

### 证书详情（cert-detail.html）

`?id=<certId>`（可加 `?ns=org:<name>`）→ `normalizeChainKey` + `cred.query` 定位证书 → 展示基本信息 / 普通自定义字段 / 链式字段递归展开（用本地证书 id 索引解析，缺失标 missing）/ 只读 JSON 源数据（悬停显示复制按钮）。

### 组织管理（orgs.html / org-detail.html）

创建组织（slug 命名）→ 列表点击进详情 → 改展示名 / 从已知用户点选员工签发 staff 证书（角色默认 staff，有效期 30/90/365 天或永不）/ 查看组织已签发（含吊销）/ 重签 / 导入本地 / 吊销 / 删除组织（confirm 二次确认）。

## 组件：comps/cert-item.html（`m-cert-item`）

- 可折叠 `st-list-item`，展示证书角色徽标（我签发 / 签发给我 / 其他人的 / 组织签发 / 已吊销 / 已过期 / 链式）、签发者与主体（`n-user-name`）、时间、指纹、自定义字段（chain_key 引用渲染为徽章）。
- props（`:prop` 绑定）：`cert`（整条记录）、`mine` / `others` / `orgMode`（布尔，控制徽标类别）。
- 事件：`open-detail`（bubbles，携带 `{ id, cert }`），**跳转由宿主页面处理**（组件不持有路由）；宿主经 `on:open-detail="$host.gotoDetail($event)"` 接管。
- 操作按钮（删除 / 吊销）由宿主经 `<slot name="actions">` 注入。
- 内部用 `load()` 按需加载 `/mz/cert/main.js` 与 locale-text；`watch: cert` + `attached` 时重算派生展示字段。
