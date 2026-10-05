// web_search 包的内置测试模组（纯插件层：mock ctx.netSearch，不出网）
// 基座用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_CALL = "调用注入的 netSearch 并透传 maxResults";
const N_FORMAT = "返回带元信息头与编号列表（标题 / URL / 摘要）";
const N_EMPTY = "无结果返回占位文案";
const N_TRUNCATE = "单条摘要截断（200 字符）";
const N_NO_CTX = "宿主未注入 netSearch 时抛可读错误";
const N_NET_ERR = "netSearch 抛错时原样上抛（不吞错）";

const testPlan = [
  N_SHAPE,
  N_CALL,
  N_FORMAT,
  N_EMPTY,
  N_TRUNCATE,
  N_NO_CTX,
  N_NET_ERR,
];

const webSearchTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "webSearch" &&
        plugin.name === "web_search" &&
        !!plugin.description &&
        !!plugin.schema?.query &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    let lastArgs = null;
    const mkCtx = (result) => ({
      netSearch: async (query, opts) => {
        lastArgs = { query, opts };
        if (result instanceof Error) throw result;
        return result;
      },
    });

    const ok = await plugin.exec(
      { query: "ofa.js 教程", maxResults: 3 },
      mkCtx({
        query: "ofa.js 教程",
        results: [
          { title: "T1", url: "https://a", content: "x".repeat(300) },
          { title: "T2", url: "https://b", content: "短摘要" },
        ],
        provider: "relay",
        engine: "duckduckgo",
      }),
    );
    await check(
      N_CALL,
      lastArgs.query === "ofa.js 教程" && lastArgs.opts.maxResults === 3,
      JSON.stringify(lastArgs),
    );
    await check(
      N_FORMAT,
      ok.startsWith("[web_search · relay · duckduckgo]「ofa.js 教程」共 2 条") &&
        ok.includes("1. T1") &&
        ok.includes("https://a") &&
        ok.includes("2. T2"),
      ok.slice(0, 80),
    );
    await check(N_TRUNCATE, !ok.includes("x".repeat(250)), "摘要未超 200 字符");

    const empty = await plugin.exec(
      { query: "冷门词" },
      mkCtx({ query: "冷门词", results: [], provider: "relay" }),
    );
    await check(N_EMPTY, empty.includes("无结果"), empty);

    let noCtxErr = "";
    try {
      await plugin.exec({ query: "x" }, {});
    } catch (e) {
      noCtxErr = e.message;
    }
    await check(N_NO_CTX, noCtxErr.includes("netSearch"), noCtxErr);

    let netErr = "";
    try {
      await plugin.exec(
        { query: "x" },
        mkCtx(new Error("服务器未配置搜索服务")),
      );
    } catch (e) {
      netErr = e.message;
    }
    await check(N_NET_ERR, netErr.includes("服务器未配置搜索服务"), netErr);
  },
});

export default webSearchTest;
