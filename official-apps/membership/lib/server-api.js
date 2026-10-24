// Synchratex 收费服务端客户端（会员购买 / 找回中转 key）。
//
// 所有“模拟”都在服务端：验证码由服务端生成并随响应返回（mockCode），
// 支付是服务端 mock Stripe；本模块只负责请求与错误归一化，不在前端写死业务数据。
//
// 服务端地址约定：
// - 本地（localhost / 127.0.0.1 / [::1]）默认 http://127.0.0.1:47901（synchratex-server 的默认端口）；
// - 其他域名（如线上 mazmot.noneos.com）默认指向线上 https://api.synchratex.com；
// - 两种场景都可用 window.SYNCHRATEX_API_BASE 覆盖。

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const DEFAULT_BASE = LOCAL_HOSTS.includes(location.hostname)
  ? "http://127.0.0.1:47901"
  : "https://api.synchratex.com";

/** 规范化 base URL：去掉末尾 `/`，非 http(s) 或空值时回退默认地址。 */
export function normalizeBase(value) {
  const text = String(value || "").trim();
  if (!text || !/^https?:\/\//i.test(text)) return DEFAULT_BASE;
  return text.replace(/\/+$/, "");
}

export const SYNCHRATEX_BASE = normalizeBase(window.SYNCHRATEX_API_BASE);

/**
 * 发一个 JSON 请求，返回 `{ status, data }`（data 解析失败时为 null）。
 * @param {string} path
 * @param {{method?: string, body?: any}} [options]
 */
export async function request(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${SYNCHRATEX_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/**
 * 发送邮箱验证码（服务端 mock）。
 * @param {{email: string, username: string, mazmotUserId: string, planId: string}} payload
 */
export function sendCode(payload) {
  return request("/api/membership/verify/send", { method: "POST", body: payload });
}

/** 校验验证码。 */
export function confirmCode(ticketId, code) {
  return request("/api/membership/verify/confirm", {
    method: "POST",
    body: { ticketId, code },
  });
}

/**
 * 下单（服务端 mock Stripe 支付成功后返回邀请码）。
 * `planId` 可覆盖发码时选的套餐（支付步骤里用户还能改月度/年度）。
 */
export function checkout(ticketId, planId) {
  return request("/api/membership/checkout", {
    method: "POST",
    body: { ticketId, ...(planId ? { planId } : {}) },
  });
}

/** 按 Mazmot 用户 ID 查询绑定（找回中转 key）。 */
export function binding(mazmotUserId) {
  return request(
    `/api/membership/binding?mazmotUserId=${encodeURIComponent(mazmotUserId)}`,
  );
}

/** 套餐列表（金额单位「分」）。 */
export function plans() {
  return request("/api/plans");
}

/** 服务器命名（邀请码里的服务器展示名）。 */
export function serverInfo(serverUrl = SYNCHRATEX_BASE) {
  return fetch(`${normalizeBase(serverUrl)}/v1/server`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}
