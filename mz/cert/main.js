// mz/cert —— Mazmot 系统级证书能力（封装 noneos-core user.cred）
//
// 分层：
// - ref.js / chain.js / fingerprint.js：纯函数（无用户/DOM 依赖），可直接 re-export
// - 本文件：需要当前用户实例的封装（签发 / 领取 / 吊销 / profile 查询与验签），
//   ensureUser / verifyData 均按需动态加载，顶层不 import /nos/*（页面模块经
//   load("/mz/cert/main.js") 使用时不受 Core 加载时机约束）
//
// 页面模块用法：
//   const load = ...  // export default async ({ load }) => ...
//   const { issueCert, verifyProfileCard } = await load("/mz/cert/main.js");

export {
  REF_PATTERN,
  REF_TYPES,
  parseRef,
  buildRef,
  shortenRef,
  normalizeChainKey,
} from "./ref.js";
export { buildChain, CHAIN_MAX_DEPTH, collectChainFields } from "./chain.js";
export { certFingerprint } from "./fingerprint.js";

// 证书保留字段：签名/存储语义专用，自定义字段不得占用
const RESERVED_KEYS = [
  "id", "role", "issuer", "subject", "signTime",
  "expire", "signature", "publicKey",
];

const ensureUser = async () => {
  const { ensureUser: fn } = await import("/mz/share-mgr.js");
  return fn();
};

/**
 * 签发证书（用当前用户私钥签名，写入本地凭证库）
 * @param {object} options
 * @param {string} options.subject 被授权者 userId
 * @param {string} options.role 角色
 * @param {number|null} [options.expire] 过期时间戳；null = 永不过期，缺省 30 天
 * @param {object} [options.extras] 自定义字段（值可为字符串或 [type:payload] 引用，
 *                   见 ref.js；保留字段名抛错）
 * @returns {Promise<object>} 签发出的证书记录（含 id / signature）
 */
export const issueCert = async ({ subject, role, expire, extras = {} }) => {
  if (!subject) throw new Error("subject is required");
  if (!role) throw new Error("role is required");
  for (const key of Object.keys(extras)) {
    if (RESERVED_KEYS.includes(key)) {
      throw new Error(`自定义字段名 ${key} 是保留字`);
    }
  }
  const user = await ensureUser();
  return user.cred.issue({ subject, role, expire, ...extras });
};

/**
 * 按精确 key 在线领取证书（core 拉取模式，自动验签入库，幂等）
 * @param {string} holderId 证书保管人 userId（从谁那里拉取）。
 *   个人证书 = 签发者本人；组织证书 = 托管转发者（创建者 default 用户）
 * @param {string} role 角色
 * @param {object} [options] { issuerId }：证书的实际签发者 userId，
 *   缺省等于 holderId；领取组织经他人转发的证书时传组织的 userId
 * @returns {Promise<object|null>} 证书记录；未命中 / 对方离线时 null 或抛错
 */
export const claimCert = async (holderId, role, { issuerId } = {}) => {
  if (!holderId || !role) throw new Error("holderId and role are required");
  const user = await ensureUser();
  return user.cred.getRecord(holderId, {
    role,
    issuer: issuerId || holderId,
    subject: user.userId,
  });
};

/**
 * 吊销（从本地凭证库删除记录；core 无软删除，删除即本地不再认可）
 * @param {string} certId 证书记录 id（role-issuer-subject）
 */
export const revokeCert = async (certId) => {
  const user = await ensureUser();
  await user.cred.delete(certId);
};

/**
 * 查询用户卡片（profile），优先本地缓存
 * @param {string} userId
 * @param {object} [options] { force: true } 时强制在线拉取（requestProfile）
 */
export const lookupProfile = async (userId, { force = false } = {}) => {
  const user = await ensureUser();
  return force
    ? user.cred.requestProfile(userId)
    : user.cred.getProfile(userId);
};

/**
 * 验证用户卡片：用数据内嵌公钥验签 + subject/issuer 一致性校验。
 * 注意不能用 user.verify（它只认当前用户自己的公钥，验别人的卡片必然 false）
 * @param {object} profile getProfile / requestProfile 返回的资料对象
 * @param {string} targetId 期望的目标 userId
 * @returns {Promise<boolean>}
 */
export const verifyProfileCard = async (profile, targetId) => {
  if (!profile) return false;
  if (profile.subject !== targetId || profile.issuer !== targetId) {
    return false; // profile 是自签证书，两者都应是持有者本人，防止张冠李戴
  }
  const { verifyData } = await import("/nos/crypto/crypto-verify.js");
  return verifyData(profile);
};

// ———— 签发历史 / 吊销留痕 ————
// core 的 cred 没有软删除（delete 即无痕），签发方应用靠这里保留"签发过什么、
// 哪些已吊销"的审计视图。存 getStorage("mz-cert") 的 issue-history 键。

const getHistoryStore = async () => {
  const { getStorage } = await import("/nos/storage/main.js");
  const store = getStorage("mz-cert");
  if (!(await store.getItem("issue-history"))) {
    // 一次性迁移：旧版本存放在应用私有空间 cred-manager，搬进系统空间
    try {
      const oldList = await getStorage("cred-manager").getItem(
        "issue-history",
      );
      if (oldList && oldList.length) {
        await store.setItem("issue-history", oldList);
      }
    } catch (err) {
      console.warn("迁移旧签发历史失败：", err);
    }
  }
  return store;
};

/**
 * 追加一条签发历史（签发成功后调用）
 * @param {object} entry { id, role, subject, signTime, expire }
 * @param {object} [options] { issuerId }：签发者 userId（默认当前用户；
 *   组织账户签发时传 org 用户的 userId，见 /mz/org）
 */
export const appendIssueHistory = async (entry, { issuerId } = {}) => {
  const store = await getHistoryStore();
  const list = (await store.getItem("issue-history")) || [];
  list.push({ ...entry, issuer: issuerId || undefined });
  await store.setItem("issue-history", list);
};

/**
 * 纯函数：cred 现行记录 + 签发历史 → 合并视图（历史里有、凭证库已没有 = 已吊销）
 * @param {object[]} liveCerts cred.query 结果（调用方自行过滤 profile/issuer）
 * @param {object[]} history appendIssueHistory 追加过的历史条目
 * @param {number} [now] 当前时间戳（过期判断）
 * @returns {object[]} [{ id, role, subject, signTime, expire, revoked, expired }]
 */
export const mergeIssuedView = (liveCerts, history, now = Date.now()) => {
  const liveIds = new Set();
  const live = liveCerts.map((c) => {
    liveIds.add(c.id);
    // 保留原始字段（signature 等）供指纹计算，仅附加视图标志
    return { ...c, revoked: false, expired: !!c.expire && c.expire < now };
  });
  const revoked = history
    .filter((h) => !liveIds.has(h.id))
    .map((h) => ({
      ...h,
      expire: h.expire || null,
      revoked: true,
      expired: !!h.expire && h.expire < now,
    }));
  return [...live, ...revoked];
};

/**
 * 通用：对指定凭证库用户查询某签发者的签发列表（现行 + 历史合并）。
 * live 记录与历史都在该用户的存储里查（org 签发的证书存 org 用户的凭证库）。
 * @param {object} storeUser 凭证库所属用户实例（个人 / 组织）
 * @param {string} issuerId 签发者 userId
 * @param {string} [subject] 被授权者过滤
 */
export const listIssuedBy = async (storeUser, issuerId, subject, { legacy = false } = {}) => {
  const live = (
    await storeUser.cred.query(subject ? { subject } : {}, {
      includeExpired: true,
    })
  ).filter((c) => c.role !== "profile" && c.issuer === issuerId);
  const store = await getHistoryStore();
  const history = ((await store.getItem("issue-history")) || []).filter(
    (h) =>
      (!subject || h.subject === subject) &&
      (h.issuer ? h.issuer === issuerId : legacy),
  );
  return mergeIssuedView(live, history);
};

/**
 * 当前用户签发过的证书列表（现行 + 已吊销），可按被授权者过滤
 * @param {string} [subject] 被授权者 userId，缺省返回全部
 * @param {object} [options] { issuerId }：签发者 userId（默认当前用户；
 *   查组织的签发记录请用 /mz/org 的 listOrgIssued）
 * @returns {Promise<object[]>} 同 mergeIssuedView 条目结构（附 issuer 透传字段）
 */
export const listIssued = async (subject, { issuerId } = {}) => {
  const user = await ensureUser();
  const issuer = issuerId || user.userId;
  // legacy：无 issuer 字段的历史条目视为当前（default）用户签发
  return listIssuedBy(user, issuer, subject, { legacy: issuer === user.userId });
};
