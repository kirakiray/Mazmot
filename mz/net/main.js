// mz/net —— Mazmot 平台联网能力（web fetch）统一客户端。
//
// 浏览器直接 fetch 任意第三方站点受 CORS 限制，网页抓取必须经服务端中转。
// 本模块把「中转端点」抽象为可插拔的 provider（实现 /fetch 协议的任意服务），
// 按优先级自动解析，应用侧只管调用：
//   net.fetch(url)      —— 与原生 fetch 同形（Response 同形对象），换掉 fetch 即可读跨域页面
//   net.fetchText(url)  —— fetch 之上的便捷层：HTML 正文提取 + 截断 + 会话缓存
//
// provider 优先级：
//   1. custom  自定义端点（用户配置的任意 /fetch 实现：自部署 Worker、本地代理等）
//   2. relay   AI 转发服务器 server/ai-relay 的 /v1/web/fetch——已配置 relay
//              邀请码即自动可用，零配置
//   3. hub     官方 web-hub（DEFAULT_HUB_URL，Cloudflare Worker 兜底，NoneOS 签名鉴权）
//   4. jina    r.jina.ai 公共 Reader 兜底（无需部署；仅 hub 也失败时才用，URL 会经过第三方）
//
// custom / relay 失败直接抛错（用户明确选择的基础设施，静默换道会把他人的
// 服务变成兜底、把目标 URL 泄露给第三方）；只有「自动兜底链」hub → jina 内部降级。
//
// 协议契约（POST {base}/fetch，目标 URL 在 JSON body 里）与各提供方实现要点见同目录 README.md。

import RelayAssistant from "../ai/supplier/relay.js";

// 官方 web-hub 默认地址（server/web-hub-cf 的官方实例）。
// 未部署 / 地址不同时可改这里，或用 setCustomEndpoint 配置任意端点。
export const DEFAULT_HUB_URL = "https://web-hub.noneos.com";

// fetchText 默认返回文本上限（字符）：抓回来的网页全文直接进模型上下文
// 会快速吃掉窗口，默认截断 + 截断标注
export const DEFAULT_MAX_CHARS = 20000;

// 会话内缓存：同一 URL 短时间内重复抓取（AI 迭代查阅文档的常见模式）不再出网
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 20;
const _cache = new Map(); // key -> { ts, result }

// ———— 工具函数 ————

/** SHA-256 hex（与 noneos get-hash.js / relay 客户端一致） */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const assertHttpUrl = (url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new Error(`web fetch 仅支持 http/https URL：${JSON.stringify(url)}`);
  }
  return url.trim();
};

// ———— HTML → 正文提取（纯函数） ————

/**
 * 把 HTML 源码转成可读正文：去注释 / script / style / 标签，块级标签转换行，
 * 解析常见实体，压缩空白。非 HTML（JSON / 纯文本）请直接用原文本，不要过这里。
 */
export function extractText(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // 脚本样式等对读者无意义的整块内容（含未闭合容差交给后续去标签兜底）
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    // 块级边界转行，保住可读的段落结构
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(
      /<\/(p|div|li|tr|section|article|header|footer|blockquote|h[1-6]|table|ul|ol)\s*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#0?39);/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .replace(/ \n/g, "\n")
    .trim();
}

const safeCodePoint = (code) => {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  } catch {
    return "";
  }
};

// ———— provider 解析 ————

/** mz-net 独立存储空间：自定义端点配置（不进默认空间，遵守存储隔离规范）。
 *  /nos/storage 不可用时（无 SW 的测试环境等）降级为仅内存模式，同 mz/ai 的处理。 */
let _store;
let _memoryCustom = null; // 内存降级模式的自定义端点
const store = async () => {
  if (_store !== undefined) return _store;
  try {
    const load = lm(import.meta);
    const { getStorage } = await load("/nos/storage/main.js");
    _store = getStorage("mz-net");
  } catch (err) {
    console.warn("[mz/net] nos storage 不可用，自定义端点仅内存模式:", err?.message ?? err);
    _store = null;
  }
  return _store;
};

const CUSTOM_KEY = "webFetchEndpoint";

/**
 * 配置自定义 web fetch 端点（优先级最高的 provider）。
 * @param {{ url: string, token?: string }} cfg url 为实现 /fetch 协议的服务基址；
 *   token 可选，将以 X-Web-Fetch-Token 头携带（自部署 Worker 的共享令牌模式）
 */
export const setCustomEndpoint = async (cfg) => {
  if (!cfg || typeof cfg.url !== "string" || !/^https?:\/\//i.test(cfg.url.trim())) {
    throw new Error("自定义端点必须是 http/https 基址");
  }
  const normalized = {
    url: cfg.url.trim().replace(/\/+$/, ""),
    token: typeof cfg.token === "string" && cfg.token ? cfg.token : "",
  };
  const s = await store();
  if (s) await s.setItem(CUSTOM_KEY, normalized);
  else _memoryCustom = normalized;
};

export const getCustomEndpoint = async () => {
  const s = await store();
  return s ? ((await s.getItem(CUSTOM_KEY)) ?? null) : _memoryCustom;
};

export const clearCustomEndpoint = async () => {
  _memoryCustom = null;
  const s = await store();
  if (s) await s.removeItem(CUSTOM_KEY);
};

/**
 * 第一个启用的 relay key（邀请码含 serverUrl + bearkey，web fetch 跟随它零配置可用）。
 * 构造 RelayAssistant 失败（邀请码损坏等）视为无 relay。
 */
const pickRelayAssistant = async () => {
  const load = lm(import.meta);
  const { getApiKeys } = await load("/mz/ai/main.js");
  const hit = getApiKeys().find((k) => k.provider === "relay" && !k.disabled);
  if (!hit) return null;
  try {
    return new RelayAssistant(hit.id, hit.apiKey);
  } catch {
    return null;
  }
};

/**
 * 解析当前生效的 web fetch provider（不实际出网）。
 * 返回 { name, endpoint }，name ∈ custom / relay / hub。
 */
export const resolveProvider = async () => {
  const custom = await getCustomEndpoint();
  if (custom) return { name: "custom", endpoint: custom.url };
  const relay = await pickRelayAssistant();
  if (relay) return { name: "relay", endpoint: `${relay.baseUrl}/v1/web/fetch` };
  return { name: "hub", endpoint: `${DEFAULT_HUB_URL}/fetch` };
};

// ———— 各 provider 的请求实现 ————

const postProtocol = async (base, { headers, url, signal }) => {
  const bodyText = JSON.stringify({ url });
  // 注意走 globalThis.fetch：模块导出的同名 fetch 会遮蔽全局，直接调 fetch 会递归到自己
  const resp = await globalThis.fetch(`${base.replace(/\/+$/, "")}/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyText,
    signal,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error?.message || `web fetch 端点返回 ${resp.status}`);
  }
  return data; // { url, status, contentType, text, truncated }
};

/** 官方 web-hub 鉴权头：NoneOS 用户签名（k="web-hub-auth"，与 relay 同方案、不同用途标记） */
const hubAuthHeaders = async (path, bodyText) => {
  const load = lm(import.meta);
  const { getUser } = await load("/nos/user/main.js");
  const user = await getUser();
  if (!user || typeof user.sign !== "function") {
    throw new Error("当前环境无 NoneOS 用户身份（无私钥），无法调用 web-hub");
  }
  const signed = await user.sign({
    k: "web-hub-auth",
    userId: user.userId,
    ts: Date.now(),
    method: "POST",
    path,
    bodyHash: await sha256Hex(bodyText),
  });
  return { "X-Web-Hub-Auth": btoa(JSON.stringify(signed)) };
};

/** Jina Reader 公共兜底：GET https://r.jina.ai/<url>，返回 Markdown（免 key，有限流） */
const fetchViaJina = async (url, signal) => {
  const resp = await globalThis.fetch(`https://r.jina.ai/${url}`, { signal });
  if (!resp.ok) {
    throw new Error(`Jina Reader 返回 ${resp.status}`);
  }
  return {
    url,
    status: resp.status,
    contentType: resp.headers.get("content-type") || "text/markdown",
    text: await resp.text(),
    truncated: false,
  };
};

// ———— fetch 同形低层 API ————

/** net.fetch 的返回对象：与原生 Response 同形（ok / status / url / headers / text() / json()），
 *  另带中转元信息 provider 与 truncated。status 为上游 HTTP 状态码。 */
export class WebFetchResponse {
  #text;
  constructor(result) {
    this.url = result.url; // 最终地址（跟随重定向后）
    this.status = result.status; // 上游 HTTP 状态码（404 等不算调用错误，判断用 ok）
    this.ok = result.status >= 200 && result.status < 300;
    this.truncated = !!result.truncated;
    this.provider = result.provider; // 实际生效的中转提供方（custom/relay/hub/jina）
    this.headers = new Headers({ "content-type": result.contentType || "" });
    this.#text = result.text ?? "";
  }
  async text() {
    return this.#text;
  }
  async json() {
    return JSON.parse(this.#text);
  }
}

/**
 * 与原生 fetch 同形的联网抓取 util：把 `fetch` 换成 `net.fetch` 就能读跨域页面，
 * 其余代码不变。仅支持 GET 语义（传 method 直接拒绝）；中转/网关层错误抛错
 * （对应原生 fetch 的网络错误），上游 4xx/5xx 不抛——用 res.ok / res.status 判断。
 */
export const fetch = async (url, init = {}) => {
  const target = assertHttpUrl(url);
  if (init.method && init.method.toUpperCase() !== "GET") {
    throw new Error("mz/net 的 fetch 仅支持 GET 语义抓取（不转发 POST 等写请求）");
  }
  return new WebFetchResponse(await dispatchFetch(target, init.signal));
};

// ———— 主入口 ————

/**
 * 抓取一个 http/https 页面或接口，返回文本内容（fetchText = net.fetch 之上的
 * 便捷层：HTML 自动正文提取 + 字符截断 + 会话缓存 + provider 标注）。
 *
 * @param {string} url 目标地址（仅 http/https）
 * @param {Object} [opts]
 * @param {boolean} [opts.raw=false] true 时不做 HTML 正文提取，返回原始响应体
 * @param {number} [opts.maxChars=DEFAULT_MAX_CHARS] 返回文本截断上限（字符）
 * @param {AbortSignal} [opts.signal] 取消信号
 * @returns {Promise<{url: string, status: number, contentType: string,
 *   text: string, truncated: boolean, provider: string}>}
 *   url 为最终地址（跟随重定向后）；status 为上游 HTTP 状态码（404 等不算
 *   网关错误，文本照常返回，由调用方判断）；provider 为实际生效的提供方。
 */
export const fetchText = async (url, opts = {}) => {
  const target = assertHttpUrl(url);
  const { raw = false, maxChars = DEFAULT_MAX_CHARS, signal, noCache = false } = opts;

  const cacheKey = `${raw ? "raw" : "text"}|${target}`;
  if (!noCache && !signal?.aborted) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return { ...hit.result };
  }

  const result = await dispatchFetch(target, signal);

  let out = { ...result, text: result.text ?? "" };
  if (!raw && /text\/html/i.test(out.contentType || "")) {
    out.text = extractText(out.text);
  }
  if (out.text.length > maxChars) {
    const total = out.text.length;
    out.text = `${out.text.slice(0, maxChars)}\n\n[内容已截断，原文约 ${total} 字符；可用 raw 参数或分段抓取获取更多]`;
    out.truncated = true;
  }
  out.provider = result.provider;

  if (!noCache) {
    _cache.set(cacheKey, { ts: Date.now(), result: out });
    if (_cache.size > CACHE_MAX) {
      _cache.delete(_cache.keys().next().value); // Map 保序，删最旧
    }
  }
  return { ...out };
};

/** provider 链调度：custom / relay 失败即抛；hub 失败降级 jina */
const dispatchFetch = async (target, signal) => {
  const custom = await getCustomEndpoint();
  if (custom) {
    const headers = {};
    if (custom.token) headers["X-Web-Fetch-Token"] = custom.token;
    return { ...(await postProtocol(custom.url, { headers, url: target, signal })), provider: "custom" };
  }

  const relay = await pickRelayAssistant();
  if (relay) {
    return { ...(await relay.webFetch(target, { signal })), provider: "relay" };
  }

  try {
    const bodyText = JSON.stringify({ url: target });
    const headers = await hubAuthHeaders("/fetch", bodyText);
    return {
      ...(await postProtocol(DEFAULT_HUB_URL, { headers, url: target, signal })),
      provider: "hub",
    };
  } catch (hubErr) {
    console.warn("[mz/net] 官方 web-hub 不可用，降级 Jina Reader:", hubErr?.message || hubErr);
    try {
      return { ...(await fetchViaJina(target, signal)), provider: "jina" };
    } catch (jinaErr) {
      throw new Error(
        `web-hub 与 Jina 兜底均失败（hub: ${hubErr?.message || hubErr}；jina: ${
          jinaErr?.message || jinaErr
        }）`,
      );
    }
  }
};
