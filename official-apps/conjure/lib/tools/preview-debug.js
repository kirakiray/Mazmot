// 工具插件包：隔离预览调试（preview_* 系列，一个文件导出多个工具定义）
//
// 让模型把生成的应用推送到隔离预览窗口实际运行，并对运行中的页面做
// 黑盒调试（读控制台、DOM 快照、模拟交互、执行 JS、截图），据此修复 bug。
// 指令在预览页的 inject.js 常驻代理内执行（见 /bridge/debug-runtime.js），
// 主域不执行任何 AI 代码。
//
// 依赖注入：ctx = { openPreview(appName), previewDebug(cmd, args, timeoutMs), onPreviewShot(dataUrl, meta) }
// 均由 builder-store 提供；缺失时工具返回可读的不可用提示。

const unavailable = () =>
  "预览调试不可用：宿主未注入预览通道（请从妙造主界面使用）";

// 统一结果排版：耗时 + 正文（与 web-bridge-mcp 的 [ok] 风格一致）
const okText = (outcome, extra = "") => {
  const ms = outcome?.meta?.ms;
  const head = ms != null ? `[${ms}ms] ` : "";
  return `${head}${outcome.result ?? "(undefined)"}${extra}`;
};

const run = async (ctx, cmd, args = {}, timeoutMs) => {
  if (typeof ctx.previewDebug !== "function") return unavailable();
  const outcome = await ctx.previewDebug(cmd, args, timeoutMs);
  return okText(outcome);
};

const wrap = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    return `调试失败：${err.message}`;
  }
};

export default [
  {
    key: "previewApp",
    name: "preview_app",
    description:
      "把指定应用推送到隔离预览窗口实际运行：窗口未开时新开窗口（首访需安装 Core，耗时较长）；已开时增量更新并自动刷新。返回时预览页已在运行最新代码且调试代理在线，可接着用 preview_* 工具调试。功能开发或修改完成后必须先用它实际运行验证。",
    schema: {
      appName: { type: "string", description: "create_app 时确定的应用名" },
    },
    async exec({ appName }, ctx) {
      if (typeof ctx.openPreview !== "function") return unavailable();
      return wrap(async () => {
        const done = await ctx.openPreview(appName);
        return `预览就绪：${done.url}\n预览窗口已在运行最新代码，可继续用 preview_status / preview_console / preview_dom 等工具调试验证。`;
      });
    },
  },
  {
    key: "previewStatus",
    name: "preview_status",
    description:
      "查看预览窗口状态：是否在线、正在运行的页面 URL/标题、控制台日志与错误条数。调试前先调用它确认预览可用。",
    schema: {},
    async exec(_args, ctx) {
      return wrap(() => run(ctx, "status"));
    },
  },
  {
    key: "previewConsole",
    name: "preview_console",
    description:
      "读取预览窗口的控制台输出（log/info/warn/error/未捕获异常）。返回末尾带最新时间戳 latestTs，下次传 since 可增量拉取——修复代码后用它对比新日志。检查报错首选。",
    schema: {
      limit: {
        type: "number",
        optional: true,
        description: "返回最近多少条，默认 50，上限 500",
      },
      since: {
        type: "number",
        optional: true,
        description: "只返回该毫秒时间戳之后的日志（增量拉取，用上次返回的 latestTs）",
      },
    },
    async exec(args, ctx) {
      return wrap(() =>
        run(
          ctx,
          "console",
          {
            limit: args.limit,
            since: args.since,
          },
          30_000,
        ),
      );
    },
  },
  {
    key: "previewDom",
    name: "preview_dom",
    description:
      '对预览窗口指定元素子树生成「虚拟截图」：每个可见节点一行，含几何位置、关键样式（颜色/字号/边框/阴影等）与文本，穿 shadow DOM。验证布局、颜色、元素是否渲染的首选（纯文本免授权）；selector 深度匹配（light DOM 查不到自动穿 shadow DOM）。',
    schema: {
      selector: {
        type: "string",
        description: "CSS 选择器（默认 body，对其子树生成快照）",
        optional: true,
      },
      depth: { type: "number", optional: true, description: "最大递归深度，默认 4，上限 8" },
      maxNodes: { type: "number", optional: true, description: "最多输出节点数，默认 60，上限 300" },
    },
    async exec(args, ctx) {
      return wrap(() =>
        run(ctx, "dom", {
          selector: args.selector,
          depth: args.depth,
          maxNodes: args.maxNodes,
        }),
      );
    },
  },
  {
    key: "previewClick",
    name: "preview_click",
    description:
      "在预览窗口按 CSS 选择器找到元素并触发点击（先滚动到可视区），返回元素标签/文本/几何。用于验证交互行为。",
    schema: {
      selector: { type: "string", description: "CSS 选择器（深度匹配，穿 shadow DOM）" },
    },
    async exec({ selector }, ctx) {
      return wrap(() => run(ctx, "click", { selector }));
    },
  },
  {
    key: "previewType",
    name: "preview_type",
    description:
      "在预览窗口向输入元素写入文本（聚焦 → 写值 → 派发 input/change，兼容 contenteditable）。配合 preview_click 验证表单类交互。",
    schema: {
      selector: { type: "string", description: "CSS 选择器（深度匹配）" },
      text: { type: "string", description: "要输入的文本" },
    },
    async exec({ selector, text }, ctx) {
      return wrap(() => run(ctx, "type", { selector, text }));
    },
  },
  {
    key: "previewText",
    name: "preview_text",
    description:
      "读取预览窗口指定元素的 innerText（默认整个页面主体）。快速确认页面实际渲染出的文字内容。",
    schema: {
      selector: { type: "string", optional: true, description: "CSS 选择器，默认 body（深度匹配）" },
    },
    async exec({ selector }, ctx) {
      return wrap(() => run(ctx, "text", { selector }));
    },
  },
  {
    key: "previewWait",
    name: "preview_wait",
    description:
      "在预览窗口轮询等待条件成立（200ms 间隔），避免异步渲染未完成就断言：等元素出现（selector）、等元素消失（selector + absent=true）或等 JS 谓词为真（code，支持 await）。超时报错。",
    schema: {
      selector: { type: "string", optional: true, description: "要等待的 CSS 选择器（深度匹配）；absent=true 时等待其消失" },
      code: { type: "string", optional: true, description: "与 selector 二选一：返回真值即成立的 JS 表达式（支持 await）" },
      absent: { type: "boolean", optional: true, description: "true = 等待元素消失（默认 false 等出现）" },
      timeoutMs: { type: "number", optional: true, description: "超时毫秒数，默认 10000，上限 60000" },
    },
    async exec(args, ctx) {
      return wrap(() =>
        run(
          ctx,
          "wait",
          {
            selector: args.selector,
            code: args.code,
            absent: args.absent,
            timeoutMs: args.timeoutMs,
          },
          Math.min(60_000, (args.timeoutMs || 10_000) + 15_000),
        ),
      );
    },
  },
  {
    key: "previewEval",
    name: "preview_eval",
    description:
      "在预览窗口执行任意 JavaScript 并返回序列化结果（支持 await 与多语句，最后一句表达式自动成为返回值）。预置快捷函数：$ / $$（查询）、$deep / $$deep（穿 shadow DOM 深度查询）、$wait（轮询等待）、$rect（元素几何+可见性）、$import（按页面 URL 动态 import）。适合读取应用内部状态、调用其方法做深度诊断。",
    schema: {
      code: { type: "string", description: "要执行的 JS 代码" },
    },
    async exec({ code }, ctx) {
      return wrap(() => run(ctx, "eval", { code }, 30_000));
    },
  },
  {
    key: "previewScreenshot",
    name: "preview_screenshot",
    description:
      "截取预览窗口的真实渲染像素（JPEG），图片会展示给用户核对。首次调用浏览器会弹屏幕授权框，需用户在预览窗口选「当前标签页」授权一次。验证布局/颜色优先用 preview_dom（文本、免授权）；本工具用于需要真实像素的场景。",
    schema: {
      selector: { type: "string", optional: true, description: "只截取该元素（深度匹配），缺省截整个视口" },
      maxSide: { type: "number", optional: true, description: "图片最大边长 px，默认 1280；0 = 不缩放" },
      quality: { type: "number", optional: true, description: "JPEG 质量 0-1，默认 0.72" },
    },
    async exec(args, ctx) {
      if (typeof ctx.previewDebug !== "function") return unavailable();
      return wrap(async () => {
        const outcome = await ctx.previewDebug(
          "shot",
          {
            selector: args.selector,
            maxSide: args.maxSide,
            quality: args.quality,
          },
          90_000,
        );
        const img = outcome?.meta?.image;
        if (img && typeof ctx.onPreviewShot === "function") {
          ctx.onPreviewShot(`data:${img.mime};base64,${outcome.result}`, img);
        }
        const sizeNote = img ? `（${img.w}x${img.h} JPEG${args.selector ? `，按 ${args.selector} 裁剪` : ""}）` : "";
        return `截图已生成并展示给用户${sizeNote}。你（模型）无法直接查看图片内容；布局/颜色/文本核验请用 preview_dom。`;
      });
    },
  },
];
