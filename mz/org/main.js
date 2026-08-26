// mz/org —— 组织账户机制（系统级）
//
// 组织 = 一个独立的 NoneOS 用户（命名空间 org:<name>，私钥在创建设备上生成）。
// 创建时由 org 用户给创建者签 role="owner" 证书（组织认证其所有者），
// 之后组织以自己的名义给员工签发证书（默认 role="staff"，可自定义 + extras）。
// 业务应用凭「证书 issuer === 某 org 的 userId」做员工权限判断。
//
// 组织记录与签发历史都存本设备（getStorage("mz-orgs") / getStorage("mz-cert")），
// 组织身份迁移到其他设备属用户导出/导入范畴，本模块不处理。
// 页面模块用法：const { createOrg, listOrgs } = await load("/mz/org/main.js");

// 组织名规则：小写字母/数字/中划线，1-32 位（命名空间 org:<name> 的一部分）
export const validateOrgName = (name) => {
  return /^[a-z0-9-]{1,32}$/.test(String(name ?? ""));
};

// 组织资料标记：写在 org 用户自签 profile 的自定义字段里，
// 任何人查询该用户卡片时都能识别"这是组织账户"
export const ORG_PROFILE_TYPE = "org";
export const isOrgProfile = (profile) =>
  !!profile && profile.type === ORG_PROFILE_TYPE;

const ORG_ROLE_OWNER = "owner";
const ORG_ROLE_STAFF = "staff";

const getOrgStore = async () => {
  const { getStorage } = await import("/nos/storage/main.js");
  return getStorage("mz-orgs");
};

const readOrgList = async () => {
  const store = await getOrgStore();
  return (await store.getItem("orgs")) || [];
};

const writeOrgList = async (list) => {
  const store = await getOrgStore();
  await store.setItem("orgs", list);
};

const getOrgUser = async (name) => {
  const { getUser } = await import("/nos/user/main.js");
  // org 用户保持离线：私钥只在签发时本地使用，不连接信令服务器，
  // 对外通信（员工领取等）一律经创建者 default 用户托管转发
  return getUser(`org:${name}`);
};

/**
 * 创建组织：生成 org:<name> 用户 → org 给创建者签 owner 证书 → 记录组织清单
 * @param {object} options
 * @param {string} options.name 组织标识（slug，validateOrgName 规则）
 * @param {string} [options.displayName] 组织展示名（默认同 name，之后可改）
 * @returns {Promise<{name, userId, ownerCert}>}
 */
export const createOrg = async ({ name, displayName }) => {
  if (!validateOrgName(name)) {
    throw new Error(`无效的组织名：${name}（需为 1-32 位小写字母/数字/中划线）`);
  }
  const list = await readOrgList();
  if (list.some((o) => o.name === name)) {
    throw new Error(`组织 ${name} 已存在`);
  }

  const { ensureUser } = await import("/mz/share-mgr.js");
  const creator = await ensureUser();

  const orgUser = await getOrgUser(name);
  await orgUser.updateInfo({
    username: displayName || name,
    type: ORG_PROFILE_TYPE,
  });

  // 组织给创建者签 owner 证书（永不过期）：持有者即组织的最高管理者；
  // extras 带 type/org 标记，持有者在凭证列表里能看出这是哪个组织颁发的；
  // 同时 import 进创建者本地凭证库，创建者可在「本地证书」看到并出示
  const ownerCert = await orgUser.cred.issue({
    subject: creator.userId,
    role: ORG_ROLE_OWNER,
    expire: null,
    type: ORG_PROFILE_TYPE,
    org: name,
  });
  await creator.cred.import(ownerCert);

  const record = {
    name,
    namespace: `org:${name}`,
    userId: orgUser.userId,
    ownerUserId: creator.userId,
    createdAt: Date.now(),
  };
  await writeOrgList([...list, record]);
  return { ...record, ownerCert };
};

/**
 * 本设备上的组织清单
 * @returns {Promise<Array<{name, namespace, userId, ownerUserId, createdAt}>>}
 */
export const listOrgs = readOrgList;

/**
 * 按名称取组织用户实例（仅创建设备可用；不存在私钥时是全新空身份）
 * @param {string} name
 */
export const getOrg = getOrgUser;

/**
 * 修改组织资料（与个人 updateInfo 同一套：合并更新并自动重签）
 * @param {string} name
 * @param {object} patch 如 { username: "新展示名" }
 */
export const updateOrgInfo = async (name, patch) => {
  const orgUser = await getOrgUser(name);
  return orgUser.updateInfo(patch);
};

/**
 * 以组织名义给员工签发证书，并计入该组织的签发历史（吊销留痕）
 * @param {object} options
 * @param {string} options.org 组织名
 * @param {string} options.subject 员工 userId
 * @param {string} [options.role] 默认 "staff"
 * @param {number|null} [options.expire] 时间戳 | null 永不过期 | 缺省 30 天
 * @param {object} [options.extras] 自定义字段（部门/职位等，随证书签名）
 */
export const issueStaffCert = async ({
  org,
  subject,
  role = ORG_ROLE_STAFF,
  expire,
  extras = {},
}) => {
  if (!org || !subject) throw new Error("org and subject are required");
  const orgUser = await getOrgUser(org);
  // 默认带 type/org 标记（员工领取后也能看出证书来自哪个组织），extras 在后可覆盖
  const cert = await orgUser.cred.issue({
    subject,
    role,
    expire,
    type: ORG_PROFILE_TYPE,
    org,
    ...extras,
  });

  // 托管转发：把证书导入创建者 default 用户的凭证库（core 的 getRecord 支持
  // 拉取他方托管的第三方证书），员工领取时填创建者的用户 ID 即可，
  // org 账户全程离线，外部不直接接触组织身份
  const { ensureUser } = await import("/mz/share-mgr.js");
  const me = await ensureUser();
  try {
    await me.cred.import(cert);
  } catch (err) {
    console.warn("托管员工证书到 default 用户失败：", err);
  }

  const { appendIssueHistory } = await import("/mz/cert/main.js");
  await appendIssueHistory(
    {
      id: cert.id,
      role,
      subject,
      signTime: cert.signTime,
      expire: cert.expire || null,
    },
    { issuerId: orgUser.userId },
  );
  return cert;
};

/**
 * 组织已签发的证书列表（现行 + 已吊销）。
 * org 签发的证书存 org 用户的凭证库，因此对 org 用户查询、按 org userId 过滤历史
 * @param {string} org
 */
export const listOrgIssued = async (org) => {
  const orgUser = await getOrgUser(org);
  const { listIssuedBy } = await import("/mz/cert/main.js");
  return listIssuedBy(orgUser, orgUser.userId);
};

/**
 * 吊销组织的某张证书（org 用户的本地凭证库删除）
 * @param {string} org
 * @param {string} certId
 */
export const revokeOrgCert = async (org, certId) => {
  const orgUser = await getOrgUser(org);
  await orgUser.cred.delete(certId);
};

// 收集 org 凭证库中该组织签发的全部证书（排除 profile 自签）
const listOrgIssuedCerts = async (orgUser) => {
  const certs = [];
  for await (const cert of orgUser.cred.values({}, { includeExpired: true })) {
    if (cert.role === "profile" || cert.issuer !== orgUser.userId) continue;
    certs.push(cert);
  }
  return certs;
};

/**
 * 把组织已签发的证书导入 owner（创建者 default 用户）本地凭证库。
 * 幂等：已在库中的证书 import 会失败，跳过即可
 * @param {string} org
 * @returns {Promise<number>} 新导入的证书数
 */
export const importOrgCerts = async (org) => {
  const orgUser = await getOrgUser(org);
  const { ensureUser } = await import("/mz/share-mgr.js");
  const me = await ensureUser();
  let imported = 0;
  for (const cert of await listOrgIssuedCerts(orgUser)) {
    try {
      await me.cred.import(cert);
      imported += 1;
    } catch (err) {
      // 已存在（重复导入）等情况直接跳过
    }
  }
  return imported;
};

/**
 * 重新签发：把组织现行证书按当前时间重签一遍并导入 owner 凭证库。
 * 用途：修复旧证书缺失的 type/org 标记、更新签发时间；证书内容（角色/主体/自定义字段）
 * 原样保留，已过期的证书跳过（时效证书过期即失效，不自动续期）。
 * @param {string} org
 * @returns {Promise<object[]>} 新签发的证书列表
 */
export const reissueOrgCerts = async (org) => {
  const orgUser = await getOrgUser(org);
  const { ensureUser } = await import("/mz/share-mgr.js");
  const me = await ensureUser();
  const { appendIssueHistory } = await import("/mz/cert/main.js");
  const BUILTIN_KEYS = [
    "id", "role", "issuer", "subject", "signTime",
    "expire", "signature", "publicKey",
  ];
  const now = Date.now();
  const out = [];
  for (const cert of await listOrgIssuedCerts(orgUser)) {
    if (cert.expire && cert.expire < now) continue; // 已过期不重签
    const extras = Object.fromEntries(
      Object.entries(cert).filter(([k]) => !BUILTIN_KEYS.includes(k)),
    );
    // 默认补全 type/org 标记，证书上已有的自定义字段优先
    const fresh = await orgUser.cred.issue({
      subject: cert.subject,
      role: cert.role,
      expire: cert.expire || null,
      type: ORG_PROFILE_TYPE,
      org,
      ...extras,
    });
    await me.cred.import(fresh);
    await appendIssueHistory(
      {
        id: fresh.id,
        role: fresh.role,
        subject: fresh.subject,
        signTime: fresh.signTime,
        expire: fresh.expire || null,
      },
      { issuerId: orgUser.userId },
    );
    out.push(fresh);
  }
  return out;
};

/**
 * 删除组织：从清单移除记录，并 deleteUser 清掉该命名空间的全部身份数据
 * （不可逆，调用方应做二次确认）
 * @param {string} name
 */
export const deleteOrg = async (name) => {
  const list = await readOrgList();
  if (!list.some((o) => o.name === name)) return;
  const { deleteUser } = await import("/nos/user/main.js");
  await deleteUser(`org:${name}`);
  await writeOrgList(list.filter((o) => o.name !== name));
};
