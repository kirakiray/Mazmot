# mz/org —— 组织账户机制使用指南

`/mz/org/main.js` 提供系统级「组织账户」：组织本质是一个**独立的 NoneOS 用户**（命名空间 `org:<name>`，私钥在创建设备上生成），用于公司/团队类业务的身份与授权。

## 0. 核心模型

```
个人用户 (default 命名空间)
   │ 创建组织 createOrg({ name })
   ▼
组织用户 org:<name>（独立密钥对，本设备持有私钥）
   │ 创建时给创建者签 role="owner" 证书（永不过期）──► 创建者持有「组织所有者」凭证
   │ issueStaffCert({ org, subject, role="staff", ... })
   ▼
员工证书（issuer = 组织 userId，subject = 员工 userId）
```

- **角色命名**：所有者 `owner`（代替随意命名的 super-admin，业界惯例）；员工默认 `staff`，签发时可自定义。
- **组织标记**：org 用户的自签 profile 自定义字段带 `type: "org"`（`isOrgProfile(profile)` 判别），查询组织卡片都能识别这是组织账户。
- **离线身份 + 托管转发（重要）**：org 用户**从不连接信令服务器**（私钥只在签发时本地使用），对外一切通信经创建者 default 用户：
  - `issueStaffCert` 签发后自动 `me.cred.import(cert)` 把证书**托管**进创建者的 default 凭证库（core 的 `getRecord` 原生支持拉取他方托管的第三方证书）；
  - 员工领取：`claimCert(创建者userId, role, { issuerId: 组织userId })`——从创建者那拉、key 指向组织签发；
  - 外部用户永远不接触 org 账户，规避组织身份暴露；员工拿到的证书 issuer 仍是组织 userId、组织签名，密码学信任不变，创建者只是"快递员"。
- **信任链**：组织认证所有者（创建即签 owner 证书）；组织认证员工（staff 证书）。业务应用做权限判断的方式：**验证员工证书的 `issuer === 某组织的 userId`**（组织 userId 可通过 owner 证书 / 组织公开身份核实）。
- **设备局限**：组织私钥只存在于创建设备（迁移属用户导出/导入范畴，本模块不处理）。组织清单存 `getStorage("mz-orgs")`，签发历史与个人共用 `getStorage("mz-cert")` 的 `issue-history`（条目带 `issuer` 字段区分）。

## 1. 加载方式

```javascript
export default async ({ load }) => {
  const {
    createOrg, listOrgs, getOrg, updateOrgInfo,
    issueStaffCert, listOrgIssued, revokeOrgCert, deleteOrg,
    validateOrgName,
  } = await load("/mz/org/main.js");
};
```

## 2. API 详解

### 2.1 创建组织 —— `createOrg`

```javascript
const org = await createOrg({
  name: "acme-labs",          // 必填，slug：1-32 位小写字母/数字/中划线（validateOrgName）
  displayName: "ACME 实验室",  // 可选展示名，默认同 name，之后可改
});
// → { name, namespace: "org:acme-labs", userId, ownerUserId, createdAt, ownerCert }
// 副作用：生成 org 用户 + org 给创建者签 role="owner"、expire=null 证书 + 记入组织清单
// 重名抛错
```

### 2.2 清单与实例

```javascript
const orgs = await listOrgs();   // 本设备全部组织记录
const orgUser = await getOrg("acme-labs");   // org 用户实例（LocalUser）
```

### 2.3 修改组织资料 —— `updateOrgInfo`

```javascript
await updateOrgInfo("acme-labs", { username: "新展示名" });   // 与个人 updateInfo 同一套（合并 + 自动重签）
```

### 2.4 员工证书 —— `issueStaffCert` / `listOrgIssued` / `revokeOrgCert`

```javascript
const cert = await issueStaffCert({
  org: "acme-labs",
  subject: "员工userId",
  role: "staff",               // 缺省 staff，可自定义（如 manager / finance）
  expire: null,                // 时间戳 | null 永不过期 | 缺省 30 天
  extras: { department: "rd" }, // 自定义字段（支持 [chain_key:...] 引用，同 /mz/cert）
});
// 自动计入签发历史（issuer = org userId），吊销留痕与个人共用一套

const list = await listOrgIssued("acme-labs");
// → 同 /mz/cert 的 listIssued 条目（现行 + 已吊销；查 org 用户凭证库）

await revokeOrgCert("acme-labs", cert.id);   // org 凭证库删除
```

员工领取（经创建者托管转发）：`claimCert(创建者defaultUserId, role, { issuerId: 组织userId })`（凭证管理器「领取证书」页有对应输入项），需**创建者**在线，组织全程离线。注意 `issueStaffCert` 已自动把证书托管进创建者凭证库，员工侧的 owner 证书同理也在创建者手中。

### 2.5 删除组织 —— `deleteOrg`

```javascript
await deleteOrg("acme-labs");   // 移除清单记录 + deleteUser("org:acme-labs")
```

**不可逆**（清除组织身份、已签证书与相关数据），调用方必须二次确认。

## 3. 业务应用接入示例（员工权限判断）

```javascript
// 应用内：只允许持有效 staff 证书的用户修改数据
const { ensureUser } = await load("/mz/share-mgr.js");
const user = await ensureUser();
const ORG_USER_ID = "…组织 userId…";       // 应用侧配置
const staffCerts = (await user.cred.query({ role: "staff" }))
  .filter((c) => c.issuer === ORG_USER_ID); // issuer 是组织 → 组织签发的员工凭证
const isStaff = staffCerts.length > 0;      // query 默认已过滤过期
```

## 4. 参考实现

- 官方应用 [official-apps/cred-manager/pages/orgs.html](../../../../../official-apps/cred-manager/pages/orgs.html)：创建 / 改名 / 签发员工证书 / 组织已签发列表（含吊销）/ 删除组织。
- 证书详情跨命名空间：`cert-detail.html?id=<certId>&ns=org:<name>` 用组织命名空间解析（org 签发的证书存 org 用户凭证库）。
- 纯函数测试 [mz/org/test/org.sb.html](../../../../../mz/org/test/org.sb.html)（validateOrgName）。
