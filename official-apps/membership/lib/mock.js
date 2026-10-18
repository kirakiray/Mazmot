// 会员购买流程的本地模拟数据与纯函数。
// 本应用是「收费模式」的交互演示：没有后端、没有网络请求，
// 套餐、验证码、历史邮箱全部写死在这里，方便后续替换成真实下单接口。
// 纯函数（无 DOM / 无 /nos/* 依赖），便于 test/mock.sb.html 单测。

/** 会员套餐（mock） */
export const MEMBER_PLAN = {
  id: "pro-year",
  name: { cn: "Mazmot Pro 年度会员", en: "Mazmot Pro Yearly" },
  priceCNY: 199,
  durationDays: 365,
  perks: {
    cn: ["全部官方应用", "AI 开发额度", "优先技术支持"],
    en: ["All official apps", "AI builder quota", "Priority support"],
  },
};

/** 演示验证码：不走真实邮件，输入它即视为验证通过 */
export const MOCK_VERIFY_CODE = "111111";

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 邮箱格式校验（宽松：xxx@yyy.zz）。
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return EMAIL_RE.test(String(email || "").trim());
}

/**
 * 用户名校验：3-20 位字母、数字、下划线或短横线。
 * 与 noneos-core 用户体系兼容（不含空格与中文，避免同步到别端时出问题）。
 * @param {string} username
 * @returns {boolean}
 */
export function isValidUsername(username) {
  return USERNAME_RE.test(String(username || "").trim());
}

/**
 * 邮箱脱敏：`abcdef@gmail.com` → `ab***@gmail.com`。
 * @param {string} email
 * @returns {string}
 */
export function maskEmail(email) {
  const text = String(email || "").trim();
  const at = text.indexOf("@");
  if (at <= 0) return text;
  const name = text.slice(0, at);
  const domain = text.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***${domain}`;
}

/**
 * 校验演示验证码（忽略首尾空白）。
 * @param {string} code
 * @returns {boolean}
 */
export function checkVerifyCode(code) {
  return String(code || "").trim() === MOCK_VERIFY_CODE;
}

/**
 * 生成模拟会员记录（购买成功后写进本地存储）。
 * @param {{ email: string, username: string, now?: number }} input
 * @returns {{
 *   planId: string,
 *   planName: { cn: string, en: string },
 *   priceCNY: number,
 *   email: string,
 *   username: string,
 *   orderId: string,
 *   startAt: number,
 *   expireAt: number,
 * }}
 */
export function createMockMembership({ email, username, now = Date.now() }) {
  const startAt = now;
  const expireAt = startAt + MEMBER_PLAN.durationDays * 24 * 60 * 60 * 1000;
  // 订单号用本地时间拼接（toISOString 会转 UTC，跨时区测试/展示不一致）
  const date = new Date(startAt);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return {
    planId: MEMBER_PLAN.id,
    planName: MEMBER_PLAN.name,
    priceCNY: MEMBER_PLAN.priceCNY,
    email: String(email || "").trim(),
    username: String(username || "").trim(),
    orderId: `MOCK-${stamp}`,
    startAt,
    expireAt,
  };
}

/**
 * 时间戳 → 本地 `YYYY-MM-DD`（会员有效期展示用）。
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
