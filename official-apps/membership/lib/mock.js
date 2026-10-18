// 会员购买流程的本地模拟数据与纯函数。
// 本应用是「收费模式」的交互演示：没有后端、没有网络请求，
// 套餐、验证码、历史邮箱全部写死在这里，方便后续替换成真实下单接口。
// 纯函数（无 DOM / 无 /nos/* 依赖），便于 test/mock.sb.html 单测。

/** 会员套餐（mock）：可选月度 / 年度，价格单位美元 */
export const MEMBER_PLANS = [
  {
    id: "monthly",
    name: { cn: "Mazmot Pro 月度会员", en: "Mazmot Pro Monthly" },
    priceUSD: 10,
    period: { cn: "/ 月", en: "/ month" },
    durationDays: 30,
  },
  {
    id: "yearly",
    name: { cn: "Mazmot Pro 年度会员", en: "Mazmot Pro Yearly" },
    priceUSD: 100,
    period: { cn: "/ 年", en: "/ year" },
    durationDays: 365,
    badge: { cn: "省 $20", en: "Save $20" },
  },
];

/** 默认选中下标第一项（月度） */
export const DEFAULT_PLAN_ID = MEMBER_PLANS[0].id;

/** 套餐权益（mock，两种套餐共用） */
export const PLAN_PERKS = {
  cn: ["全部官方应用", "AI 开发额度", "优先技术支持"],
  en: ["All official apps", "AI builder quota", "Priority support"],
};

/**
 * 按 id 取套餐；未知 id 回退默认套餐（月度）。
 * @param {string} planId
 * @returns {(typeof MEMBER_PLANS)[number]}
 */
export function getPlan(planId) {
  return MEMBER_PLANS.find((plan) => plan.id === planId) || MEMBER_PLANS[0];
}

/** 演示验证码：不走真实邮件，输入它即视为验证通过 */
export const MOCK_VERIFY_CODE = "111111";

/**
 * 支付方式（mock）：当前只支持 Stripe，且是虚拟支付——不接真实 SDK、不发网络请求。
 * 测试卡用 Stripe 官方测试卡号 4242 4242 4242 4242。
 */
export const MOCK_PAYMENT = {
  provider: "stripe",
  label: "Stripe",
  testCard: {
    number: "4242 4242 4242 4242",
    expiry: "12/34",
    cvc: "123",
  },
};

/**
 * 校验模拟卡信息：16 位卡号 + MM/YY 有效期 + 3-4 位 CVC。
 * 只做格式校验（虚拟支付，不校验 Luhn、不请求任何网关）。
 * @param {{ number: string, expiry: string, cvc: string }} card
 * @returns {boolean}
 */
export function isValidMockCard({ number, expiry, cvc } = {}) {
  const digits = String(number || "").replace(/\s+/g, "");
  const exp = String(expiry || "").trim();
  const code = String(cvc || "").trim();
  return (
    /^\d{16}$/.test(digits) &&
    /^\d{2}\/\d{2}$/.test(exp) &&
    /^\d{3,4}$/.test(code)
  );
}

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
 * @param {{ planId?: string, email: string, username: string, now?: number }} input
 * @returns {{
 *   planId: string,
 *   planName: { cn: string, en: string },
 *   priceUSD: number,
 *   email: string,
 *   username: string,
 *   orderId: string,
 *   startAt: number,
 *   expireAt: number,
 * }}
 */
export function createMockMembership({
  planId = DEFAULT_PLAN_ID,
  email,
  username,
  now = Date.now(),
}) {
  const plan = getPlan(planId);
  const startAt = now;
  const expireAt = startAt + plan.durationDays * 24 * 60 * 60 * 1000;
  // 订单号用本地时间拼接（toISOString 会转 UTC，跨时区测试/展示不一致）
  const date = new Date(startAt);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return {
    planId: plan.id,
    planName: plan.name,
    priceUSD: plan.priceUSD,
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
