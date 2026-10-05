// 工具插件包：web_search
// 经平台联网能力（/mz/net）联网搜索，返回相关网页结果列表（标题 / 链接 / 摘要），
// 供时效性查询、发现来源；配合 web_fetch 抓取具体页面读全文。
// 搜索是 mz 内实现：fetch 抓搜索引擎结果页 + 解析（引擎可插拔，best-effort），服务端零搜索功能。
// 依赖注入：ctx = { netSearch } —— mz/net 的 searchWeb（由 builder-store 注入）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

// 单条摘要截断（字符）：控制进上下文的体积，全文用 web_fetch 抓
const SNIPPET_CHARS = 200;

export default {
  key: "webSearch",
  name: "web_search",
  selfTest,
  description:
    "联网搜索：返回与查询相关的网页结果列表（标题 / 链接 / 摘要）。" +
    "需要时效性信息、不知道具体网址、需要多个来源对比时使用；" +
    "拿到结果后可用 web_fetch 抓取具体页面读全文。" +
    "搜索词提炼关键词，不要用整句。",
  schema: {
    query: { type: "string", description: "搜索词（提炼关键词）" },
    maxResults: { type: "number", description: "可选；结果条数 1-10，默认 5" },
  },
  async exec({ query, maxResults }, ctx) {
    if (typeof ctx.netSearch !== "function") {
      throw new Error("宿主未注入搜索能力（ctx.netSearch）");
    }
    const r = await ctx.netSearch(query, { maxResults: Number(maxResults) || 5 });
    const tag = `[web_search · ${r.provider} · ${r.engine}]`;
    if (!r.results?.length) {
      return `${tag}「${r.query}」无结果`;
    }
    const lines = r.results.map(
      (it, i) =>
        `${i + 1}. ${it.title || "(无标题)"}\n   ${it.url}\n   ${String(
          it.content || "",
        ).slice(0, SNIPPET_CHARS)}`,
    );
    return `${tag}「${r.query}」共 ${r.results.length} 条\n\n${lines.join("\n")}`;
  },
};
