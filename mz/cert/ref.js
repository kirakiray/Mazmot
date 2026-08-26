// 凭证引用语法：[<type>:<payload>]
// type 为注册制扩展点：本期 chain_key = 槽位引用（role-issuer-subject，即 core
// 记录 id 字段，抗更新）；未来可注册 chain_id（指纹版本引用）等新类型。
// 未注册类型按普通字符串渲染，不影响老数据。
export const REF_PATTERN = /^\[([a-z0-9_]{1,16}):(.*)\]$/;
export const REF_TYPES = ["chain_key"];

export const parseRef = (value) => {
  const m = REF_PATTERN.exec(String(value ?? ""));
  if (!m) return null;
  const [, type, payload] = m;
  return REF_TYPES.includes(type) ? { type, payload } : null;
};

export const buildRef = (type, payload) => `[${type}:${payload}]`;

// chain_key payload（role-issuer-subject）拆回三段；userId 为公钥哈希不含 "-"，
// 按前两个 "-" 拆即可无损还原（与 core normalizeKey 同规则）
export const normalizeChainKey = (payload) => {
  const i1 = payload.indexOf("-");
  const i2 = payload.indexOf("-", i1 + 1);
  if (i1 < 0 || i2 < 0) return null;
  return {
    role: payload.slice(0, i1),
    issuer: payload.slice(i1 + 1, i2),
    subject: payload.slice(i2 + 1),
  };
};

// chain_key payload（role-issuer-subject）的缩短展示，完整值放 title
export const shortenRef = (parsed) => {
  if (!parsed) return "";
  if (parsed.type === "chain_key") {
    const i1 = parsed.payload.indexOf("-");
    const i2 = parsed.payload.indexOf("-", i1 + 1);
    if (i1 < 0 || i2 < 0) return parsed.payload.slice(0, 24) + "…";
    const role = parsed.payload.slice(0, i1);
    const issuer = parsed.payload.slice(i1 + 1, i2).slice(0, 8);
    const subject = parsed.payload.slice(i2 + 1).slice(0, 8);
    return `${role}: ${issuer}… → ${subject}…`;
  }
  return parsed.payload.slice(0, 24) + "…";
};
