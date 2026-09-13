// preview 包的内置测试模组（纯插件层：预览通道用 fake 替身，不碰真实窗口）
// 基座用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_UNKNOWN = "未知 action 返回可读错误并列出可用值";
const N_ARGS = "各 action 必填参数校验（app/click/type/wait/eval）";
const N_APP = "action=app：透传 appName，返回预览就绪与后续引导";
const N_APP_UNAVAILABLE = "未注入 openPreview / previewDebug 时返回不可用提示";
const N_DISPATCH = "调试 action 分发：cmd 映射（screenshot→shot）与 args 透传";
const N_FORMAT = "结果排版：meta.ms 前缀 + result 正文；无 meta 不加前缀";
const N_TIMEOUT = "超时表：screenshot 90s / wait 放宽 / console·eval 30s / 其余默认";
const N_SHOT = "screenshot：onPreviewShot 收 dataUrl 与 meta，文案引导用 dom";
const N_SHOT_FALLBACK = "screenshot 无图时：不调 onPreviewShot，返回无尺寸文案";
const N_ERROR = "通道抛错时包装为「操作失败」可读文案";

const testPlan = [
  N_SHAPE,
  N_UNKNOWN,
  N_ARGS,
  N_APP,
  N_APP_UNAVAILABLE,
  N_DISPATCH,
  N_FORMAT,
  N_TIMEOUT,
  N_SHOT,
  N_SHOT_FALLBACK,
  N_ERROR,
];

const previewTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "preview" &&
        plugin.name === "preview" &&
        plugin.description.includes("app：") &&
        plugin.schema?.action &&
        plugin.schema?.appName?.optional === true &&
        plugin.schema?.args?.type === "object" &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    // ---- 参数校验层 ----
    const unknown = await plugin.exec({ action: "fly" }, {});
    await check(
      N_UNKNOWN,
      unknown.startsWith("未知 action：fly") &&
        ["app", "status", "console", "eval", "screenshot"].every((a) =>
          unknown.includes(a),
        ),
      unknown,
    );

    const noopDebug = { previewDebug: async () => ({ ok: true, result: "" }) };
    const bad1 = await plugin.exec({ action: "app" }, {});
    const bad2 = await plugin.exec({ action: "click", args: {} }, noopDebug);
    const bad3 = await plugin.exec(
      { action: "type", args: { text: "t" } },
      noopDebug,
    );
    const bad4 = await plugin.exec({ action: "wait", args: {} }, noopDebug);
    const bad5 = await plugin.exec({ action: "eval", args: {} }, noopDebug);
    await check(
      N_ARGS,
      bad1.includes("appName") &&
        bad2.includes("args.selector") &&
        bad3.includes("args.selector") &&
        bad4.includes("args.selector 或 args.code") &&
        bad5.includes("args.code"),
      [bad1, bad2, bad3, bad4, bad5].join(" | "),
    );

    // ---- action=app ----
    let openedWith = null;
    const appRes = await plugin.exec(
      { action: "app", appName: "todo-app" },
      {
        openPreview: async (appName) => {
          openedWith = appName;
          return { url: "/$conjure-apps/todo-app/client/index.html" };
        },
      },
    );
    await check(
      N_APP,
      openedWith === "todo-app" &&
        appRes.includes("预览就绪：/$conjure-apps/todo-app/client/index.html") &&
        appRes.includes("status"),
      appRes,
    );

    const noOpen = await plugin.exec({ action: "app", appName: "x" }, {});
    const noDebug = await plugin.exec({ action: "status" }, {});
    await check(
      N_APP_UNAVAILABLE,
      noOpen === "预览调试不可用：宿主未注入预览通道（请从妙造主界面使用）" &&
        noDebug === noOpen,
      `${noOpen} | ${noDebug}`,
    );

    // ---- 调试分发与排版 ----
    let lastCmd = null;
    let lastArgs = null;
    const fakeDebug = async (cmd, args) => {
      lastCmd = cmd;
      lastArgs = args;
      return { ok: true, result: "内容", meta: { ms: 123 } };
    };
    const text = await plugin.exec(
      { action: "console", args: { limit: 10, since: 99 } },
      { previewDebug: fakeDebug },
    );
    let shotCmd = null;
    await plugin.exec(
      { action: "screenshot", args: { selector: "#app" } },
      {
        previewDebug: async (cmd) => {
          shotCmd = cmd;
          return { ok: true, result: "", meta: {} };
        },
        onPreviewShot: () => {},
      },
    );
    await check(
      N_DISPATCH,
      lastCmd === "console" &&
        lastArgs?.limit === 10 &&
        lastArgs?.since === 99 &&
        shotCmd === "shot",
      `console cmd=${lastCmd} args=${JSON.stringify(lastArgs)} shot cmd=${shotCmd}`,
    );

    const plain = await plugin.exec(
      { action: "status" },
      { previewDebug: async () => ({ ok: true, result: "在线" }) },
    );
    await check(
      N_FORMAT,
      text === "[123ms] 内容" && plain === "在线",
      `withMeta=${text} plain=${plain}`,
    );

    // ---- 超时表 ----
    const recordTimeout = [];
    const debugRecording = async (cmd, args, timeoutMs) => {
      recordTimeout.push({ cmd, timeoutMs });
      return { ok: true, result: "" };
    };
    await plugin.exec({ action: "screenshot" }, { previewDebug: debugRecording });
    await plugin.exec(
      { action: "wait", args: { code: "1", timeoutMs: 50_000 } },
      { previewDebug: debugRecording },
    );
    await plugin.exec(
      { action: "wait", args: { code: "1", timeoutMs: 1_000 } },
      { previewDebug: debugRecording },
    );
    await plugin.exec({ action: "console" }, { previewDebug: debugRecording });
    await plugin.exec({ action: "status" }, { previewDebug: debugRecording });
    await check(
      N_TIMEOUT,
      recordTimeout[0].timeoutMs === 90_000 &&
        recordTimeout[1].timeoutMs === 60_000 &&
        recordTimeout[2].timeoutMs === 16_000 &&
        recordTimeout[3].timeoutMs === 30_000 &&
        recordTimeout[4].timeoutMs === undefined,
      JSON.stringify(recordTimeout),
    );

    // ---- 截图结果流 ----
    let shotPayload = null;
    const shotRes = await plugin.exec(
      { action: "screenshot", args: { selector: "header" } },
      {
        previewDebug: async () => ({
          ok: true,
          result: "QUJD",
          meta: { ms: 5, image: { mime: "image/jpeg", w: 640, h: 480 } },
        }),
        onPreviewShot: (dataUrl, meta) => {
          shotPayload = { dataUrl, meta };
        },
      },
    );
    await check(
      N_SHOT,
      shotPayload?.dataUrl === "data:image/jpeg;base64,QUJD" &&
        shotPayload?.meta.w === 640 &&
        shotRes.includes("640x480") &&
        shotRes.includes("header") &&
        shotRes.includes("action=dom"),
      shotRes,
    );

    // 无 meta.image：不调 onPreviewShot，返回不带尺寸说明的文案
    let shotCalled2 = 0;
    const noImgRes = await plugin.exec(
      { action: "screenshot" },
      {
        previewDebug: async () => ({ ok: true, result: "" }),
        onPreviewShot: () => {
          shotCalled2++;
        },
      },
    );
    await check(
      N_SHOT_FALLBACK,
      shotCalled2 === 0 &&
        noImgRes.startsWith("截图已生成并展示给用户。"),
      noImgRes,
    );

    // ---- 错误包装 ----
    const errRes = await plugin.exec(
      { action: "status" },
      {
        previewDebug: async () => {
          throw new Error("预览窗口未打开");
        },
      },
    );
    await check(N_ERROR, errRes === "操作失败：预览窗口未打开", errRes);
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = previewTest.runSelfTest;
export { testPlan };
