// Synchratex 收费服务端客户端（会员购买 / 找回中转 key）。
//
// 所有“模拟”都在服务端：验证码由服务端生成并随响应返回（mockCode），
// 支付是服务端 mock Stripe；本模块只负责请求与错误归一化，不在前端写死业务数据。
//
// 服务端地址约定：
// - 本地（localhost / 127.0.0.1 / [::1]）默认 http://127.0.0.1:47901（Synchratex 服务端本地默认端口）；
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
 * @param {{method?: string, body?: any, headers?: Record<string,string>}} [options]
 */
export async function request(path, options = {}) {
  const { method = "GET", body, headers: extraHeaders } = options;
  const headers = { Accept: "application/json", ...(extraHeaders || {}) };
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
 * 生成 X-Relay-Auth 身份签名（NoneOS user.sign，ECDSA P-256）。
 * 服务端 binding 接口要求证明“拥有该 userId 的私钥”，否则知道 userId 就能取走 key。
 * @param {{userId: string, sign: Function}} user
 * @param {string} method
 * @param {string} path
 * @param {string} [bodyText]
 */
export async function relayAuthHeader(user, method, path, bodyText = "") {
  if (!user || typeof user.sign !== "function") {
    throw new Error("当前用户没有私钥，无法生成身份签名");
  }
  const bodyHash = await createHashHex(bodyText);
  const signed = await user.sign({
    k: "relay-auth",
    userId: user.userId,
    ts: Date.now(),
    method,
    path,
    bodyHash,
  });
  return btoa(JSON.stringify(signed));
}

/** SHA-256 hex（与 NoneOS getHash 同口径）。 */
async function createHashHex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
 * 下单（服务端 mock Stripe / Stripe Checkout；0 元优惠码由服务端直接发货）。
 * `planId` 可覆盖发码时选的套餐；`discountCode` 为支付页输入的优惠码。
 */
export function checkout(ticketId, planId, discountCode) {
  return request("/api/membership/checkout", {
    method: "POST",
    body: {
      ticketId,
      ...(planId ? { planId } : {}),
      ...(discountCode ? { discountCode } : {}),
    },
  });
}

/**
 * 优惠码试算：返回指定套餐优惠后的原价 / 让利 / 实付 / 是否免费。
 * 需要已验证的票据（ticketId）来校验「同一用户只能用一次」。
 */
export function previewDiscount(ticketId, planId, code) {
  return request("/api/membership/discount/preview", {
    method: "POST",
    body: { ticketId, planId, code },
  });
}

/** 按 Mazmot 用户 ID 查询绑定（找回中转 key）；authHeader 必须是由该用户私钥签出的 X-Relay-Auth。 */
export function binding(mazmotUserId, authHeader = "") {
  return request(
    `/api/membership/binding?mazmotUserId=${encodeURIComponent(mazmotUserId)}`,
    { headers: authHeader ? { "X-Relay-Auth": authHeader } : {} },
  );
}

/** 套餐列表（金额单位「分」）。 */
export function plans() {
  return request("/api/plans");
}

/**
 * 解邀请码：URL-safe Base64 的 {"k": bearkey, "u": serverUrl}。
 * @param {string} code
 * @returns {{bearkey: string, serverUrl: string} | null}
 */
export function decodeInvite(code) {
  try {
    const raw = atob(
      String(code || "")
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(String(code || "").trim().length / 4) * 4, "="),
    );
    const data = JSON.parse(raw);
    if (typeof data.k !== "string" || typeof data.u !== "string") return null;
    return { bearkey: data.k, serverUrl: normalizeBase(data.u) };
  } catch {
    return null;
  }
}

/**
 * 用邀请码里的 bearkey 请求 /v1/*，返回 `{ status, data }`。
 * @param {string} inviteCode
 * @param {string} path
 */
async function relayRequest(inviteCode, path) {
  const invite = decodeInvite(inviteCode);
  if (!invite) return { status: 0, data: null };
  try {
    const res = await fetch(`${invite.serverUrl}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${invite.bearkey}`,
      },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { error: { message: String((err && err.message) || err) } } };
  }
}

/** 当前会员的 token 用量（/v1/usage）。 */
export function usage(inviteCode) {
  return relayRequest(inviteCode, "/v1/usage");
}

/** 当前会员可用的模型列表（/v1/models）。 */
export function models(inviteCode) {
  return relayRequest(inviteCode, "/v1/models");
}

/** 服务器命名（邀请码里的服务器展示名）。 */
export function serverInfo(serverUrl = SYNCHRATEX_BASE) {
  return fetch(`${normalizeBase(serverUrl)}/v1/server`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}
