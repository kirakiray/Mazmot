// 妙造隔离预览 —— /mz/net/main.js 替身（仅预览域，经 receiver 注入的
// import map 顶替；妙造主容器与安装环境不受影响，仍加载真模块）。
//
// 导出面复刻生成应用被教的联网 API：fetch / fetchText / searchWeb。内部全部
// 经 window.__MZ_BRIDGE__（bridge/inject.js 挂载）把调用转发给妙造主容器，
// 由主容器按自己的通道配置（custom/relay/jina）执行——SSRF 防护、缓存、
// 截断等策略全部继承主域；通道配置与令牌永不下发到预览域。
//
// ⚠️ 同步约束：本文件导出面与真模块的应用侧用法保持一致；改 SYSTEM_PROMPT
// 教的联网用法时必须同步这里。

// 等待 inject.js 挂载桥对象（同 bridge/guest/mz-ai.js）
const waitBridge = () =>
  new Promise((resolve, reject) => {
    if (globalThis.__MZ_BRIDGE__) return resolve(globalThis.__MZ_BRIDGE__);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (globalThis.__MZ_BRIDGE__) {
        clearInterval(timer);
        resolve(globalThis.__MZ_BRIDGE__);
      } else if (Date.now() - t0 > 8000) {
        clearInterval(timer);
        reject(
          new Error("预览能力桥不可用：请从妙造的「预览应用」打开本页（AI/联网能力经妙造主容器代理）"),
        );
      }
    }, 100);
  });

export const DEFAULT_MAX_CHARS = 20000;

/** 与真模块 WebFetchResponse 同形：ok / status / url / headers / text() / json()，
 *  另带中转元信息 provider 与 truncated（真模块返回的是这个面的子集，逐字段对齐） */
class BridgeWebFetchResponse {
  #text;
  constructor(d) {
    this.url = d.url ?? "";
    this.status = Number(d.status) || 0;
    this.ok = d.ok === true || (this.status >= 200 && this.status < 300);
    this.truncated = !!d.truncated;
    this.provider = d.provider ?? "bridge";
    this.headers = new Headers({ "content-type": d.contentType || "" });
    this.#text = d.text ?? "";
  }
  async text() {
    return this.#text;
  }
  async json() {
    return JSON.parse(this.#text);
  }
}

/**
 * 与原生 fetch 同形的联网抓取（真模块经妙造主容器代理执行）。仅 GET 语义。
 * 上游 4xx/5xx 不抛错——用 res.ok / res.status 判断。
 */
export const fetch = async (url, init = {}) => {
  if (init?.method && String(init.method).toUpperCase() !== "GET") {
    throw new Error("mz/net 的 fetch 仅支持 GET 语义抓取（不转发 POST 等写请求）");
  }
  const bridge = await waitBridge();
  const d = await bridge.call("net.fetch", { url: String(url ?? "") }, {
    timeoutMs: 120_000,
    signal: init?.signal,
  });
  return new BridgeWebFetchResponse(d);
};

/**
 * 抓取页面文本（fetch 便捷层：HTML 正文提取 + 截断 + 会话缓存，均在主容器侧）。
 * 返回 { url, status, contentType, text, truncated, provider }。
 */
export const fetchText = async (url, opts = {}) => {
  const bridge = await waitBridge();
  const maxChars = Number(opts.maxChars);
  return bridge.call(
    "net.fetchText",
    {
      url: String(url ?? ""),
      raw: opts.raw === true,
      noCache: opts.noCache === true,
      // 截断上限钳在 100k：过大结果过桥慢且没有合理用途
      maxChars: Number.isFinite(maxChars) && maxChars > 0 ? Math.min(maxChars, 100_000) : undefined,
    },
    { timeoutMs: 120_000, signal: opts.signal },
  );
};

/** 联网搜索（引擎与通道均在主容器侧）：返回 { query, engine, provider, results } */
export const searchWeb = async (query, opts = {}) => {
  const bridge = await waitBridge();
  return bridge.call(
    "net.searchWeb",
    { query: String(query ?? ""), engine: opts.engine },
    { timeoutMs: 60_000, signal: opts.signal },
  );
};

// ———— 配置与工具 API：预览域不支持（通道配置只存在于妙造主容器） ————

const unsupported = (name) => async () => {
  throw new Error(`预览环境不支持联网通道配置（${name} 仅在妙造主应用可用）`);
};
export const setWebFetchChannel = unsupported("setWebFetchChannel");
export const setRelayKeyId = unsupported("setRelayKeyId");
export const setCustomEndpoint = unsupported("setCustomEndpoint");
export const clearCustomEndpoint = unsupported("clearCustomEndpoint");
export const setSearchEngine = unsupported("setSearchEngine");
export const getWebFetchChannel = async () => "bridge";
export const WEB_FETCH_CHANNELS = ["bridge"];
export const sha256Hex = unsupported("sha256Hex");
export const extractText = unsupported("extractText");
