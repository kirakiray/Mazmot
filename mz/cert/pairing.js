// mz/cert/pairing —— 配对码（短码交换用户卡片）客户端封装
//
// 与 cred-hub 的 /pairing/register、/pairing/resolve 对接：
// - 取码方提交自己的签名 profile 卡片，换回 6-10 位小写字母数字配对码
// - 查询方凭码解析回完整卡片；拿到卡片后必须照常 verifyProfileCard 本地验签，
//   服务器返回的数据不做任何信任假设
//
// 用法（页面模块内）：
//   const { requestPairingCode, resolvePairingCard } = await load("/mz/cert/pairing.js");

// 服务端地址：可在 getStorage("mz-cert") 的 "pairing-server" 键里覆盖
const DEFAULT_PAIRING_SERVER = "http://localhost:8787";

// 判定输入是否为配对码（userId 是更长的十六进制串，不会命中）
export const PAIRING_CODE_PATTERN = /^[0-9a-z]{6,10}$/;

const getPairingServer = async () => {
  try {
    const { getStorage } = await import("/nos/storage/main.js");
    const server = await getStorage("mz-cert").getItem("pairing-server");
    return (server || DEFAULT_PAIRING_SERVER).replace(/\/+$/, "");
  } catch {
    return DEFAULT_PAIRING_SERVER;
  }
};

/**
 * 提交用户卡片换取配对码。同窗口重复提交幂等（同码覆盖，卡片以最新一次为准）
 * @param {object} card 本地已签名的 profile 卡片（user.cred.getProfile(user.userId)）
 * @returns {Promise<{code: string, expiresAt: number}>} expiresAt 为服务器时间的窗口到期毫秒值（倒计时用它算，别用本地时钟猜窗口）
 */
export const requestPairingCode = async (card) => {
  if (!card) throw new Error("缺少用户卡片");
  const res = await fetch(`${await getPairingServer()}/pairing/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `取码失败（HTTP ${res.status}）`);
  }
  return data;
};

/**
 * 凭配对码解析完整用户卡片（未验签的原始数据，调用方必须自行 verifyProfileCard）
 * @param {string} code 配对码
 * @returns {Promise<object>} 用户卡片；无效/过期时抛错
 */
export const resolvePairingCard = async (code) => {
  const trimmed = (code || "").trim().toLowerCase();
  const res = await fetch(
    `${await getPairingServer()}/pairing/resolve?code=${encodeURIComponent(trimmed)}`,
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `解析失败（HTTP ${res.status}）`);
  }
  return data;
};
