//! web-hub-cf —— Mazmot 官方 web-hub（Cloudflare Workers 版联网抓取兜底服务）
//!
//! 实现 mz/net/README.md 定义的 `/fetch` 协议契约，为没有 relay 邀请码、
//! 也不自部署端点的用户提供零配置联网能力；同一份代码可被开发者自部署
//! （wrangler deploy 即可，无需任何 bindings），自部署后经 mz/net 的
//! setCustomEndpoint 接入。
//!
//! 接口：
//! - `POST /fetch`   抓取网页文本。body `{ "url": "http(s)://..." }`，
//!                   成功 200 `{ url, status, contentType, text, truncated }`
//!                   （status 为上游状态码，404 等不算网关错误）；
//!                   失败 4xx/5xx `{ error: { message, type } }`
//! - `GET  /health`  健康检查
//!
//! 鉴权（二选一，由部署配置决定）：
//! - 公开模式（默认，WEB_HUB_TOKEN 未配置）：NoneOS 用户签名头 `X-Web-Hub-Auth`
//!   ——base64(JSON 签名对象)，方案与 ai-relay 的 X-Relay-Auth 一致
//!   （ECDSA P-256 + SHA-256、key 字母序规范化、ts ±10min、bodyHash 绑定请求体），
//!   仅 `k` 用途标记为 "web-hub-auth"。签名抬高了滥用门槛，但**不是强身份**
//!   （任何人生成密钥对即可构造），防扫描不防蓄意。
//! - 私有模式（配置了 WEB_HUB_TOKEN）：只认 `X-Web-Fetch-Token` 共享令牌
//!   （常数时间比较），签名鉴权关闭。自部署推荐此模式。
//!
//! 平台差异带来的实现调整（与 ai-relay 的 web 模块语义一致）：
//! - Workers 边缘无法做本地 DNS 解析，私网校验覆盖 IP 字面量 + 内部主机名黑名单；
//!   边缘 fetch 本身到不了部署者的内网，残余风险面与自建服务器不同（见 CONTEXT.md）
//! - 302 手动跟随：fetch(redirect: "manual")，最多 3 跳、逐跳重新校验
//! - 大小上限 WEB_HUB_MAX_BYTES（默认 2MB，超出截断 truncated:true）；
//!   总超时 WEB_HUB_TIMEOUT_MS（默认 15s，AbortSignal.timeout）
//! - Content-Type 仅放行文本类（text/* / json / xml / javascript / yaml）

const TS_WINDOW_MS = 10 * 60 * 1000;          // 签名时间窗：±10 分钟
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;    // 响应体上限
const DEFAULT_TIMEOUT_MS = 15 * 1000;         // 单次抓取总超时
const MAX_REDIRECTS = 3;                      // 手动重定向跳数上限
const MAX_BODY_BYTES = 4 * 1024;              // /fetch 请求体上限（只有一个 url 字段）
const ACCEPT = "text/html,application/xhtml+xml,application/json,text/*;q=0.9,*/*;q=0.1";

// ———— 基础工具 ————

function b64ToBytes(b64) {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/// 常数时间字符串比较
function constantTimeEq(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

// ———— NoneOS 签名校验（与 cred-hub-cf / ai-relay identity 同方案）———

async function verifyEcdsa(publicKeyB64, signatureB64, message) {
  let key;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      b64ToBytes(publicKeyB64),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("公钥解析失败（需 base64 SPKI DER P-256）");
  }
  const sig = b64ToBytes(signatureB64);
  if (sig.length !== 64) {
    throw new Error(`签名格式非法（期望 64 字节 raw r||s，实际 ${sig.length} 字节）`);
  }
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    sig,
    new TextEncoder().encode(message),
  );
  if (!ok) throw new Error("签名与数据/公钥不匹配");
}

/**
 * 校验 X-Web-Hub-Auth 签名头，返回 userId。
 * 校验链：结构完整 → k / method / path / bodyHash 与实际请求一致 →
 * ts 时间窗 → userId 与公钥哈希一致 → ECDSA 验签（key 字母序规范化消息）。
 */
async function verifyHubAuth(headerValue, method, path, bodyText) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64ToBytes(headerValue)));
  } catch {
    throw new Error("X-Web-Hub-Auth 不是合法的 base64 JSON");
  }
  if (!data || typeof data !== "object") {
    throw new Error("X-Web-Hub-Auth 不是 JSON 对象");
  }
  const { signature, ...rest } = data;
  if (typeof signature !== "string" || !signature) {
    throw new Error("缺少 signature 字段");
  }
  for (const f of ["publicKey", "userId", "ts", "method", "path", "bodyHash", "k"]) {
    if (rest[f] === undefined) throw new Error(`缺少 ${f} 字段`);
  }
  if (rest.k !== "web-hub-auth") throw new Error("签名用途标记 k 不合法");
  if (rest.method !== method) throw new Error("签名 method 与请求不一致");
  if (rest.path !== path) throw new Error("签名 path 与请求不一致");
  if (rest.bodyHash !== (await sha256Hex(bodyText))) {
    throw new Error("签名 bodyHash 与请求体不一致");
  }
  const ts = Number(rest.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TS_WINDOW_MS) {
    throw new Error("签名时间戳超出容许窗口");
  }
  if ((await sha256Hex(rest.publicKey)) !== rest.userId) {
    throw new Error("userId 与公钥不匹配");
  }
  const canonical = JSON.stringify(
    Object.keys(rest)
      .sort()
      .reduce((o, k) => ((o[k] = rest[k]), o), {}),
  );
  await verifyEcdsa(rest.publicKey, signature, canonical);
  return rest.userId;
}

// ———— SSRF 防护（边缘环境版：IP 字面量 + 内部主机名黑名单）———

function isPrivateV4([a, b, c]) {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpLiteral(host) {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((x) => x > 255)) return false; // 非法 IPv4 交给 fetch 自然失败
    return isPrivateV4(o);
  }
  if (host.includes(":")) {
    const low = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (/^f[cd]/.test(low)) return true;                    // ULA fc00::/7
    if (/^fe[89ab]/.test(low)) return true;                 // 链路本地 fe80::/10
    if (/^ff/.test(low)) return true;                       // 组播
    const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateIpLiteral(mapped[1]);
  }
  return false;
}

/** 解析 + 校验目标 URL；非法直接抛错（错误消息可直接透给客户端） */
function validateTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL 无法解析");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`仅支持 http/https，收到 ${u.protocol.replace(/:$/, "")}`);
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".arpa")
  ) {
    throw new Error(`拒绝访问内部主机名 ${host}`);
  }
  if (isPrivateIpLiteral(host)) {
    throw new Error(`拒绝访问私有地址 ${host}`);
  }
  return u;
}

// ———— CORS（与 cred-hub-cf 同规则：WEB_HUB_CORS）———

const parseCorsOrigins = (env) => {
  const raw = (env.WEB_HUB_CORS || "").trim();
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
  const origin = (request.headers.get("origin") || "").replace(/\/+$/, "");
  const match =
    allowed === "*" ||
    allowed.includes(origin) ||
    (Array.isArray(allowed) &&
      allowed.some(
        (entry) =>
          entry.startsWith("https://*.") &&
          origin.startsWith("https://") &&
          origin.endsWith(entry.slice(9)),
      ));
  if (match) {
    response.headers.set(
      "access-control-allow-origin",
      allowed === "*" ? "*" : origin,
    );
    response.headers.set("access-control-allow-methods", "*");
    response.headers.set("access-control-allow-headers", "*");
    response.headers.set("vary", "Origin");
  }
  return response;
}

const json = (request, env, status, body) =>
  withCors(
    request,
    env,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );

const errJson = (request, env, status, message) =>
  json(request, env, status, { error: { message, type: "web_fetch_error" } });

// ———— 核心抓取 ————

async function handleFetch(request, env) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return errJson(request, env, 413, "请求体超过大小上限");
  }

  // 鉴权：私有模式（配置了 WEB_HUB_TOKEN）只认共享令牌；否则走 NoneOS 签名
  if (env.WEB_HUB_TOKEN) {
    const given = (request.headers.get("x-web-fetch-token") || "").trim();
    if (!constantTimeEq(given, env.WEB_HUB_TOKEN)) {
      return errJson(request, env, 401, "缺少或错误的 X-Web-Fetch-Token");
    }
  } else {
    const auth = request.headers.get("x-web-hub-auth");
    if (!auth) {
      return errJson(request, env, 401, "缺少 X-Web-Hub-Auth 签名头");
    }
    try {
      await verifyHubAuth(auth, "POST", "/fetch", raw);
    } catch (e) {
      return errJson(request, env, 403, `签名校验失败: ${e.message}`);
    }
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return errJson(request, env, 400, "请求体不是合法 JSON");
  }
  if (!payload || typeof payload.url !== "string") {
    return errJson(request, env, 400, "缺少 url 字段");
  }

  let current;
  try {
    current = validateTarget(payload.url);
  } catch (e) {
    return errJson(request, env, 422, e.message);
  }

  const maxBytes =
    parseInt(env.WEB_HUB_MAX_BYTES || "", 10) || DEFAULT_MAX_BYTES;
  const timeoutMs =
    parseInt(env.WEB_HUB_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  // 手动重定向：每跳重新过 scheme + SSRF 校验（防 302 跳内网）
  let hops = 0;
  let resp;
  for (;;) {
    try {
      resp = await fetch(current.toString(), {
        redirect: "manual",
        headers: { accept: ACCEPT },
        signal,
      });
    } catch (e) {
      return errJson(request, env, 502, `抓取失败: ${e?.message || e}`);
    }
    if (resp.status < 300 || resp.status >= 400) break;
    if (++hops > MAX_REDIRECTS) {
      return errJson(request, env, 502, `重定向超过 ${MAX_REDIRECTS} 跳`);
    }
    const loc = resp.headers.get("location");
    if (!loc) {
      return errJson(request, env, 502, "重定向响应缺少 Location 头");
    }
    let next;
    try {
      next = new URL(loc, current);
      validateTarget(next.toString());
    } catch (e) {
      return errJson(request, env, 422, e.message);
    }
    current = next;
  }

  const contentType = resp.headers.get("content-type") || "";
  const ct = contentType.toLowerCase();
  const textLike =
    ct === "" ||
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("yaml");
  if (!textLike) {
    return errJson(
      request,
      env,
      422,
      `不支持的内容类型「${contentType}」，仅支持文本类（HTML/JSON/XML 等）`,
    );
  }

  // 流式读取 + 大小上限（超限截断而非整体失败）
  let text = "";
  let truncated = false;
  const reader = resp.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        const keep = value.subarray(0, value.byteLength - (received - maxBytes));
        text += decoder.decode(keep, { stream: true });
        truncated = true;
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    if (!truncated) text += decoder.decode();
  }

  return json(request, env, 200, {
    url: current.toString(),
    status: resp.status,
    contentType,
    text,
    truncated,
  });
}

// ———— 路由 ————

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") {
      return withCors(request, env, new Response(null, { status: 204 }));
    }
    if (path === "/health" && request.method === "GET") {
      return json(request, env, 200, { ok: true });
    }
    if (path === "/fetch" && request.method === "POST") {
      return handleFetch(request, env);
    }
    return json(request, env, 404, { error: { message: "未知接口", type: "web_fetch_error" } });
  },
};
