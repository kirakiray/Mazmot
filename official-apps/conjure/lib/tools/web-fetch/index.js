// 工具插件包：web_fetch
// 经平台联网能力（/mz/net）抓取网页 / 接口文本，供查阅线上文档、
// 获取 URL 内容、验证公开接口响应。浏览器无法直抓跨域站点，实际网络
// 请求由 mz/net 解析出的服务端中转完成（relay / 官方 hub / 自定义端点）。
// 依赖注入：ctx = { netFetch } —— mz/net 的 fetchText（由 builder-store 注入）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

// 工具返回给模型的文本上限（字符）：正文已在 mz/net 层截断过一次（默认 2 万），
// 工具层再收紧到 1.2 万，避免单次抓取占满上下文窗口
const MAX_RESULT_CHARS = 12000;

export default {
  key: "webFetch",
  name: "web_fetch",
  selfTest,
  description:
    "抓取公开网页或 HTTP 接口的文本内容（自动去 HTML 标签提取正文，超长截断）。" +
    "当需要查阅线上文档、获取用户给出的 URL 内容、验证公开接口响应时使用。" +
    "仅支持 http/https；需要登录、强反爬的站点可能失败，失败时如实告知用户，不要反复重试同一 URL。",
  schema: {
    url: { type: "string", description: "要抓取的 http/https 地址" },
    raw: {
      type: "boolean",
      description: "可选；true 时返回原始响应体（不去 HTML 标签），仅正文提取效果不佳时使用",
    },
  },
  async exec({ url, raw }, ctx) {
    if (typeof ctx.netFetch !== "function") {
      throw new Error("宿主未注入联网能力（ctx.netFetch），无法抓取网页");
    }
    const result = await ctx.netFetch(url, { raw: !!raw });
    const head = `[web_fetch · ${result.provider}] HTTP ${result.status} ${result.url} · ${
      result.contentType || "未知类型"
    }${result.truncated ? " · 已截断" : ""}`;
    const body =
      result.text.length > MAX_RESULT_CHARS
        ? `${result.text.slice(0, MAX_RESULT_CHARS)}\n\n[工具层二次截断，原文约 ${result.text.length} 字符]`
        : result.text;
    return `${head}\n\n${body || "（空内容）"}`;
  },
};
