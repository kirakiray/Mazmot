//! cred-hub-cf —— cred-hub 的 Cloudflare Workers + D1 版本
//!
//! 接口与 Rust 版（server/cred-hub）完全一致：
//! - `POST /creds`                  上传 cred，结构/有效期/ECDSA P-256 规范化验签后存储
//! - `GET  /creds/{key}?touch=0`    按 key 取回；默认命中续命，?touch=0 只读
//! - `POST /pairing/register`       签名 profile 卡片换自适应 6/8 位配对码
//! - `GET  /pairing/resolve?code=`  凭码取回完整卡片；未命中才计限流（每 IP 每分钟 30 次）
//! - `GET  /health`                 健康检查
//!
//! 平台差异带来的实现调整（语义不变）：
//! - Worker 内存不跨实例共享 → resolve 失败计数落 D1（resolve_fails 表）
//! - 无后台任务 → 冷数据靠「访问续命 + 写入时按概率惰性清扫」，保留期 CRED_HUB_RETENTION_MS 默认 7 天
//! - /creds 请求体超过 CRED_HUB_MAX_CRED_BYTES（默认 2048 字节）直接 413，不进验签
//! - 配对码密钥持久化在 meta 表（pairing-secret），首次请求生成

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const WINDOW_MS = 5 * 60 * 1000;          // 配对码窗口：5 分钟
const GRACE_MS = WINDOW_MS;               // 跨窗宽限，码共活约 10 分钟
const CODE_LEN_SHORT = 6;                 // 自适应码长下限
const CODE_LEN_LONG = 8;
const SHORT_LEN_ACTIVE_LIMIT = 300;       // 有效码 ≤ 此数发 6 位，否则 8 位
const RESOLVE_FAIL_LIMIT_PER_MIN = 30;    // 未命中解析每 IP 每分钟允许次数
const DEFAULT_RETENTION_MS = 7 * 24 * 3600 * 1000;
const DEFAULT_MAX_CRED_BYTES = 2048;      // 单条 cred 大小上限，可经 CRED_HUB_MAX_CRED_BYTES 调整

// ———— 管理 API 鉴权（Bearer Token，双方共享秘密）———

/// 常数时间字符串比较（长度不同的串也走完整轮次）
function constantTimeEq(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/// 校验 Authorization: Bearer <token>；未配置 token 或不匹配均拒绝
function adminAuthorized(request, env) {
  if (!env.CRED_HUB_ADMIN_TOKEN) return false;
  const given = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  return constantTimeEq(given, env.CRED_HUB_ADMIN_TOKEN);
}

const credSummary = (key, cred, lastAccessMs) => ({
  id: key,
  role: cred.role,
  issuer: cred.issuer,
  subject: cred.subject,
  expire: cred.expire ?? null,
  lastAccessMs,
});

async function handleAdminStats(request, env) {
  const retentionMs =
    parseInt(env.CRED_HUB_RETENTION_MS || "", 10) || DEFAULT_RETENTION_MS;
  const now = nowMs();
  const halfRetention = Math.floor(retentionMs / 2);
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM creds").first();
  const activeRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM creds WHERE last_access_ms >= ?",
  )
    .bind(now - halfRetention)
    .first();
  const pairingRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pairing_cards WHERE expires_at_ms > ?",
  )
    .bind(now)
    .first();
  const total = totalRow.n;
  return json(request, env, 200, {
    ok: true,
    creds: { total, active: activeRow.n, cooling: total - activeRow.n },
    pairing: { activeCodes: pairingRow.n },
    retentionMs,
    nowMs: now,
  });
}

async function handleAdminHot(request, env, { url }) {
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1),
    200,
  );
  const { results } = await env.DB.prepare(
    "SELECT key, cred, last_access_ms FROM creds ORDER BY last_access_ms DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return json(request, env, 200, {
    ok: true,
    items: results.map((r) => credSummary(r.key, JSON.parse(r.cred), r.last_access_ms)),
  });
}

async function handleAdminExpiring(request, env, { url }) {
  let withinDays = parseInt(url.searchParams.get("withinDays") || "30", 10);
  if (!Number.isFinite(withinDays)) withinDays = 30;
  withinDays = Math.min(Math.max(withinDays, 1), 3650);
  const now = nowMs();
  const horizon = now + withinDays * 24 * 3600 * 1000;
  // expire 在 JSON 内，量级为个人服务规模，全量拉取后内存过滤
  const { results } = await env.DB.prepare("SELECT key, cred, last_access_ms FROM creds").all();
  const items = results
    .map((r) => ({ key: r.key, cred: JSON.parse(r.cred), last: r.last_access_ms }))
    .filter(({ cred }) => {
      const expire = parseTimestamp(cred.expire);
      return expire != null && expire > now && expire <= horizon;
    })
    .sort((a, b) => parseTimestamp(a.cred.expire) - parseTimestamp(b.cred.expire))
    .map(({ key, cred, last }) => credSummary(key, cred, last));
  return json(request, env, 200, { ok: true, withinDays, items });
}

// ———— 基础工具 ————

const nowMs = () => Date.now();

const b64decode = (s) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/// 复刻 JS JSON.stringify 的规范化排序：递归按 key 字母序、紧凑无空白
/// （与 Rust 版 to_canonical_json / NoneOS BaseUser._sign 一致）
function toCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(toCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const items = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${toCanonicalJson(value[k])}`);
    return `{${items.join(",")}}`;
  }
  return JSON.stringify(value);
}

/// 时间戳兼容数字毫秒值、纯数字字符串、ISO-8601 字符串（与 Rust 版 parse_timestamp 一致）
function parseTimestamp(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v) return null;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  // 轻量 ISO-8601 解析（形如 2024-01-02T03:04:05.678Z）
  const m = v.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

const tsOf = (cred) => parseTimestamp(cred?.signTime) ?? Number.MIN_SAFE_INTEGER;

async function verifyEcdsa(publicKeyB64, signatureB64, message) {
  let der, sig;
  try {
    der = b64decode(publicKeyB64);
    sig = b64decode(signatureB64);
  } catch {
    throw new Error("base64 解码失败");
  }
  if (sig.length !== 64) {
    throw new Error(`签名格式非法（期望 64 字节 raw r||s，实际 ${sig.length} 字节）`);
  }
  let key;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("公钥解析失败（需 base64 SPKI DER P-256）");
  }
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    sig,
    new TextEncoder().encode(message),
  );
  if (!ok) throw new Error("签名与数据/公钥不匹配");
}

// ———— 校验（与 Rust 版 validate.rs 对齐）———

const requireStrField = (obj, field) => {
  const v = obj[field];
  if (v === undefined || v === null || v === "") {
    throw new Error(`缺少必填字段 ${field}`);
  }
  if (typeof v !== "string" && !(field === "signTime" && typeof v === "number")) {
    throw new Error(
      `字段 ${field} 必须是非空字符串（signTime 可为时间戳数字或 ISO 字符串）`,
    );
  }
};

function checkExpire(obj) {
  if (obj.expire == null) return;
  const signTime = parseTimestamp(obj.signTime);
  const expire = parseTimestamp(obj.expire);
  if (signTime == null) throw new Error("signTime 不是有效时间戳");
  if (expire == null) throw new Error("expire 不是有效时间戳");
  if (expire <= signTime) throw new Error("expire 必须晚于 signTime");
  if (expire < nowMs()) throw new Error("cred 已过期");
}

/// 剥离 signature 后的规范化待签字符串（保留其余全部字段）
function signingBase(data) {
  const { signature, ...rest } = data;
  return toCanonicalJson(rest);
}

/// 完整 cred 校验：结构 / 有效期 / 验签三层
export async function validateCred(cred) {
  if (!cred || typeof cred !== "object" || Array.isArray(cred)) {
    throw new Error("cred 必须是 JSON 对象");
  }
  for (const f of ["id", "role", "issuer", "subject", "signTime", "publicKey", "signature"]) {
    requireStrField(cred, f);
  }
  checkExpire(cred);
  await verifyEcdsa(cred.publicKey, cred.signature, signingBase(cred));
}

/// 用户卡片校验（profile）：不要求 id（core profile API 返回签名载荷视图）、豁免 expire
export async function validateProfileCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new Error("用户卡片必须是 JSON 对象");
  }
  for (const f of ["role", "issuer", "subject", "signTime", "publicKey", "signature"]) {
    requireStrField(card, f);
  }
  await verifyEcdsa(card.publicKey, card.signature, signingBase(card));
}

// ———— HTTP 响应助手 ————

/// CRED_HUB_CORS 配置解析（每次调用时读，热重载/配置变更即时生效）：
/// - "1" 或 "*"：放行任意 Origin（allow-origin: *）
/// - 逗号分隔的 Origin 白名单（如 "https://a.com,https://b.com"）：
///   请求 Origin 命中时回显该 Origin，否则不加 CORS 头（浏览器侧拒绝）
const parseCorsOrigins = (env) => {
  const raw = (env.CRED_HUB_CORS || "").trim();
  if (raw === "1" || raw === "*") return "*";
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : null;
};

function withCors(request, env, response) {
  const allowed = parseCorsOrigins(env);
  if (!allowed) return response;
  const origin = request.headers.get("origin") || "";
  const normalized = origin.replace(/\/+$/, "");
  const match = allowed === "*" || allowed.includes(normalized);
  if (match) {
    // 白名单模式回显具体 Origin（不能写 *，否则带凭据的请求会被浏览器拒绝）
    response.headers.set(
      "access-control-allow-origin",
      allowed === "*" ? "*" : normalized,
    );
    response.headers.set("access-control-allow-methods", "*");
    response.headers.set("access-control-allow-headers", "*");
    response.headers.set("vary", "Origin");
  }
  return response;
}

const json = (request, env, status, body) =>
  withCors(request, env, new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  }));

// ———— handlers ————

async function handleUploadCred(request, env) {
  // 大小限制在验签前检查：超限请求不值得消耗 ECDSA 运算
  const maxBytes =
    parseInt(env.CRED_HUB_MAX_CRED_BYTES || "", 10) || DEFAULT_MAX_CRED_BYTES;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) {
    return json(request, env, 413, {
      ok: false,
      error: `cred 数据超过大小上限 ${maxBytes} 字节（CRED_HUB_MAX_CRED_BYTES）`,
    });
  }
  let cred;
  try {
    cred = JSON.parse(raw);
  } catch {
    return json(request, env, 422, { ok: false, error: "请求体不是合法 JSON" });
  }
  try {
    await validateCred(cred);
  } catch (err) {
    return json(request, env, 422, { ok: false, error: err.message });
  }

  const retentionMs = parseInt(env.CRED_HUB_RETENTION_MS || "", 10) || DEFAULT_RETENTION_MS;
  const now = nowMs();
  const existing = await env.DB.prepare("SELECT cred FROM creds WHERE key = ?")
    .bind(cred.id)
    .first();
  if (existing && tsOf(JSON.parse(existing.cred)) >= tsOf(cred)) {
    return json(request, env, 409, {
      ok: false,
      error: "已存在 signTime 更新（或相同）的同 key 记录",
      id: cred.id,
    });
  }
  await env.DB.prepare(
    `INSERT INTO creds (key, cred, last_access_ms) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET cred = excluded.cred, last_access_ms = excluded.last_access_ms`,
  )
    .bind(cred.id, JSON.stringify(cred), now)
    .run();
  // 无后台任务，写入时按小概率顺带清扫冷数据
  if (Math.random() < 0.05) {
    await env.DB.prepare("DELETE FROM creds WHERE last_access_ms < ?")
      .bind(now - retentionMs)
      .run();
  }
  return json(request, env, 201, { ok: true, id: cred.id });
}

async function handleGetCred(request, env, { key, url }) {
  const touch = url.searchParams.get("touch") !== "0";
  const row = await env.DB.prepare("SELECT cred FROM creds WHERE key = ?").bind(key).first();
  if (!row) {
    return json(request, env, 404, { ok: false, error: "未找到该 key 的 cred 数据", id: key });
  }
  if (touch) {
    await env.DB.prepare("UPDATE creds SET last_access_ms = ? WHERE key = ?")
      .bind(nowMs(), key)
      .run();
  }
  return json(request, env, 200, JSON.parse(row.cred));
}

async function loadPairingSecret(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'pairing-secret'").first();
  if (row) return new Uint8Array(row.v);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('pairing-secret', ?)").bind(secret).run();
  return secret;
}

async function deriveCode(secret, userId, windowIndex, len) {
  const enc = new TextEncoder();
  const material = new Uint8Array(
    secret.length + enc.encode(userId).length + 1 + enc.encode(String(windowIndex)).length,
  );
  material.set(secret, 0);
  material.set(enc.encode(userId), secret.length);
  material.set(enc.encode(":"), secret.length + enc.encode(userId).length);
  material.set(
    enc.encode(String(windowIndex)),
    secret.length + enc.encode(userId).length + 1,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  return Array.from(digest.slice(0, len), (b) => ALPHABET[b % 36]).join("");
}

async function handlePairingRegister(request, env) {
  let card;
  try {
    card = await request.json();
  } catch {
    return json(request, env, 422, { ok: false, error: "请求体不是合法 JSON" });
  }
  try {
    await validateProfileCard(card);
  } catch (err) {
    return json(request, env, 422, { ok: false, error: err.message });
  }
  if (card.role !== "profile") {
    return json(request, env, 422, {
      ok: false,
      error: "配对码仅接受用户卡片（role=profile）",
    });
  }
  const userId = card.subject || "";
  if (!userId || card.issuer !== userId) {
    return json(request, env, 422, {
      ok: false,
      error: "用户卡片必须自签（issuer 与 subject 一致）",
    });
  }

  const now = nowMs();
  const windowIndex = Math.floor(now / WINDOW_MS);
  const expiresAtMs = (windowIndex + 1) * WINDOW_MS;

  // 同用户旧窗口的码立即作废 + 清理过期条目，再按剩余活跃量决定码长
  await env.DB.prepare("DELETE FROM pairing_cards WHERE subject = ?").bind(userId).run();
  await env.DB.prepare("DELETE FROM pairing_cards WHERE expires_at_ms <= ?").bind(now).run();
  const activeRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pairing_cards WHERE expires_at_ms > ?",
  )
    .bind(now)
    .first();
  const len = activeRow.n <= SHORT_LEN_ACTIVE_LIMIT ? CODE_LEN_SHORT : CODE_LEN_LONG;

  const secret = await loadPairingSecret(env);
  const code = await deriveCode(secret, userId, windowIndex, len);
  await env.DB.prepare(
    "INSERT INTO pairing_cards (code, subject, card, expires_at_ms) VALUES (?, ?, ?, ?)",
  )
    .bind(code, userId, JSON.stringify(card), expiresAtMs + GRACE_MS)
    .run();

  return json(request, env, 200, { ok: true, code, expiresAt: expiresAtMs });
}

async function handlePairingResolve(request, env, { url }) {
  const ip =
    request.cf?.clientIp ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";
  const code = (url.searchParams.get("code") || "").trim().toLowerCase();

  const row = code
    ? await env.DB.prepare("SELECT card, expires_at_ms FROM pairing_cards WHERE code = ?")
        .bind(code)
        .first()
    : null;

  if (row && row.expires_at_ms > nowMs()) {
    return json(request, env, 200, JSON.parse(row.card));
  }
  if (row) {
    await env.DB.prepare("DELETE FROM pairing_cards WHERE code = ?").bind(code).run(); // 过期条目惰性删除
  }

  // 未命中（疑似扫描尝试）才计数：每 IP 分钟级固定窗口
  const minute = Math.floor(nowMs() / 60_000);
  const failRow = await env.DB.prepare(
    `INSERT INTO resolve_fails (ip, minute, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, minute) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(ip, minute)
    .first();
  if ((failRow?.count ?? 1) > RESOLVE_FAIL_LIMIT_PER_MIN) {
    return json(request, env, 429, { ok: false, error: "查询过于频繁，请稍后再试" });
  }
  return json(request, env, 404, { ok: false, error: "配对码无效或已过期" });
}

// ———— 入口 ————

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/health") {
        return withCors(request, env, new Response("ok"));
      }
      if (path === "/creds" && request.method === "POST") {
        return await handleUploadCred(request, env);
      }
      const credMatch = path.match(/^\/creds\/([^/]+)$/);
      if (credMatch && request.method === "GET") {
        return await handleGetCred(request, env, { key: decodeURIComponent(credMatch[1]), url });
      }
      if (path === "/pairing/register" && request.method === "POST") {
        return await handlePairingRegister(request, env);
      }
      if (path === "/pairing/resolve" && request.method === "GET") {
        return await handlePairingResolve(request, env, { url });
      }
      // 管理 API：未配置 CRED_HUB_ADMIN_TOKEN 时一律 404（不暴露管理面存在的痕迹）
      if (path.startsWith("/admin/") && request.method === "GET") {
        if (!env.CRED_HUB_ADMIN_TOKEN) {
          return json(request, env, 404, { ok: false, error: "未知接口" });
        }
        if (!adminAuthorized(request, env)) {
          return json(request, env, 401, { ok: false, error: "无效的管理员令牌" });
        }
        if (path === "/admin/stats") return await handleAdminStats(request, env);
        if (path === "/admin/hot") return await handleAdminHot(request, env, { url });
        if (path === "/admin/expiring") return await handleAdminExpiring(request, env, { url });
      }
      // preflight 放行（仅在启用 CORS 时有意义）
      if (request.method === "OPTIONS") {
        return withCors(request, env, new Response(null, { status: 204 }));
      }
      return json(request, env, 404, { ok: false, error: "未知接口" });
    } catch (err) {
      console.error("unhandled:", err);
      return json(request, env, 500, { ok: false, error: String(err?.message || err) });
    }
  },
};
