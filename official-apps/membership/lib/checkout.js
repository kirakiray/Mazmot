// 会员购买流程的纯函数：校验与展示格式化（不依赖 DOM / 网络）。
// 服务端返回的金额一律是「分」，时长是秒；这里只做前端展示与表单校验。

/** 邮箱格式（宽松，与服务端一致）。 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

/** 用户名：3-20 位字母、数字、下划线或短横线。 */
export function isValidUsername(username) {
  return /^[A-Za-z0-9_-]{3,20}$/.test(String(username || "").trim());
}

/** 邮箱脱敏：`abcdef@x.com` → `ab***@x.com`。 */
export function maskEmail(email) {
  const text = String(email || "").trim();
  const at = text.indexOf("@");
  if (at <= 0) return text;
  const name = text.slice(0, at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***${text.slice(at)}`;
}

/**
 * Mock Stripe 卡信息校验（只做格式）：16 位数字 + MM/YY + 3-4 位 CVC。
 * 真实支付接进来后这段会被 Stripe Elements 替换，页面不要依赖“卡号是否真实”。
 */
export function isValidMockCard({ number, expiry, cvc } = {}) {
  const digits = String(number || "").replace(/\s+/g, "");
  return (
    /^\d{16}$/.test(digits) &&
    /^\d{2}\/\d{2}$/.test(String(expiry || "").trim()) &&
    /^\d{3,4}$/.test(String(cvc || "").trim())
  );
}

/** 分 → `$10` / `$10.00`（整数分时省略小数）。 */
export function priceText(cents, currency = "USD") {
  const value = Number(cents) || 0;
  const symbol = currency === "USD" ? "$" : "";
  const amount = value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
  return `${symbol}${amount}`;
}

/** 计费周期文案（`month` → `/ 月`）。 */
export function periodText(interval) {
  if (interval === "year") return "/ 年";
  if (interval === "month") return "/ 月";
  return "";
}

/** Unix 秒 → 本地 `YYYY-MM-DD`。 */
export function formatDate(seconds) {
  const date = new Date((Number(seconds) || 0) * 1000);
  if (!date.getTime()) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 从邀请码里解出服务端地址（仅用于展示；解析失败返回空串）。
 * 邀请码格式与 mz/ai/supplier/relay.js 一致：Base64URL(JSON `{"u":…,"k":…}`)。
 */
export function inviteServerUrl(code) {
  try {
    const raw = atob(
      String(code || "")
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(String(code || "").trim().length / 4) * 4, "="),
    );
    const data = JSON.parse(raw);
    return typeof data.u === "string" ? data.u : "";
  } catch {
    return "";
  }
}
