// web_fetch 包的内置测试模组（纯插件层：mock ctx.netFetch，不出网）
// 基座用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_CALL = "调用注入的 netFetch 并透传 raw 参数";
const N_FORMAT = "返回文本带元信息头（provider / 状态 / URL）";
const N_HTML = "HTML 正文默认不二次处理（提取由 mz/net 层负责），空内容有占位";
const N_TRUNCATE = "超长文本工具层二次截断（12k 上限）";
const N_NO_CTX = "宿主未注入 netFetch 时抛可读错误";
const N_NET_ERR = "netFetch 抛错时原样上抛（不吞错）";

const testPlan = [
  N_SHAPE,
  N_CALL,
  N_FORMAT,
  N_HTML,
  N_TRUNCATE,
  N_NO_CTX,
  N_NET_ERR,
];

const webFetchTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "webFetch" &&
        plugin.name === "web_fetch" &&
        !!plugin.description &&
        !!plugin.schema?.url &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    // 记录调用参数的 mock
    let lastArgs = null;
    const mkCtx = (result) => ({
      netFetch: async (url, opts) => {
        lastArgs = { url, opts };
        if (result instanceof Error) throw result;
        return result;
      },
    });

    const ok = await plugin.exec(
      { url: "https://example.com/docs", raw: false },
      mkCtx({
        url: "https://example.com/docs",
        status: 200,
        contentType: "text/html",
        text: "<p>hello</p>",
        truncated: false,
        provider: "relay",
      }),
    );
    await check(
      N_CALL,
      lastArgs.url === "https://example.com/docs" && lastArgs.opts.raw === false,
      JSON.stringify(lastArgs),
    );
    await check(
      N_FORMAT,
      ok.startsWith("[web_fetch · relay] HTTP 200 https://example.com/docs"),
      ok.split("\n")[0],
    );
    await check(N_HTML, ok.includes("<p>hello</p>"), "原文透传，提取交给 mz/net");

    const empty = await plugin.exec(
      { url: "https://example.com/empty" },
      mkCtx({ url: "", status: 200, contentType: "text/plain", text: "", truncated: false, provider: "hub" }),
    );
    await check(N_HTML, empty.endsWith("（空内容）"), empty.split("\n")[0]);

    const long = await plugin.exec(
      { url: "https://example.com/long" },
      mkCtx({
        url: "",
        status: 200,
        contentType: "text/plain",
        text: "x".repeat(13000),
        truncated: false,
        provider: "hub",
      }),
    );
    await check(
      N_TRUNCATE,
      long.length < 13000 && long.includes("工具层二次截断"),
      `返回长度 ${long.length}`,
    );

    let noCtxErr = "";
    try {
      await plugin.exec({ url: "https://example.com" }, {});
    } catch (e) {
      noCtxErr = e.message;
    }
    await check(N_NO_CTX, noCtxErr.includes("netFetch"), noCtxErr);

    let netErr = "";
    try {
      await plugin.exec(
        { url: "https://example.com" },
        mkCtx(new Error("拒绝访问私网地址")),
      );
    } catch (e) {
      netErr = e.message;
    }
    await check(N_NET_ERR, netErr.includes("拒绝访问私网地址"), netErr);
  },
});

export default webFetchTest;
