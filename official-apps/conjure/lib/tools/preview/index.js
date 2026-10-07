// 工具插件包：preview（隔离预览统一工具）
//
// 一个工具 + action 参数分发全部预览操作：把生成的应用推送到隔离预览窗口
// 实际运行（app），并对运行中的页面做黑盒调试（status/console/dom/text/click/
// type/wait/eval/screenshot）。调试指令在预览页的 inject.js 常驻代理内执行
//（见 /bridge/debug-runtime.js），主域不执行任何 AI 代码。
//
// 依赖注入：ctx = { openPreview(appName), previewDebug(cmd, args, timeoutMs), onPreviewShot(dataUrl, meta) }
// 均由 builder-store 提供；缺失时工具返回可读的不可用提示。

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

const unavailable = () =>
  "预览调试不可用：宿主未注入预览通道（请从妙造主界面使用）";

// 统一结果排版：耗时 + 正文
const okText = (outcome) => {
  const ms = outcome?.meta?.ms;
  const head = ms != null ? `[${ms}ms] ` : "";
  return `${head}${outcome.result ?? "(undefined)"}`;
};

const wrap = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    return `操作失败：${err.message}`;
  }
};

// action → dbg 指令名（screenshot 例外：指令层叫 shot）
const ACTION_CMDS = {
  status: "status",
  console: "console",
  text: "text",
  dom: "dom",
  click: "click",
  type: "type",
  wait: "wait",
  eval: "eval",
  screenshot: "shot",
};
const ACTIONS = ["app", "windows", "check-popup", ...Object.keys(ACTION_CMDS)];

// 弹窗被拦截时的统一行动指引（action=app 返回 code=POPUP_BLOCKED 的错误、
// action=check-popup 探测未放行时共用）：给模型的必须是可执行的处理顺序——
// 指导用户放行 → 停下等确认 → 验证 → 再重推；窗口放行前一切调试指令都会失败
const POPUP_GUIDE = `预览窗口被浏览器拦截：浏览器默认禁止页面自动打开新窗口，预览窗口放行前无法继续调试（这不是应用代码问题，其余调试指令也会全部失败）。请严格按以下顺序处理：
1. 立即用一段话告诉用户：浏览器拦截了预览窗口，请点浏览器地址栏右侧的「弹窗已拦截」图标（Chrome 在地址栏右端，Edge / Safari / Firefox 位置类似），选择「始终允许来自此网站的弹出式窗口」并确认；
2. 然后停下来等待用户回复确认（如「已允许」），期间不要重试 preview 的任何 action，也不要继续其他调试步骤；
3. 用户确认后调用 action=check-popup 验证放行：通过后再 action=app 重推应用；若仍被拦截，请用户打开浏览器设置 → 隐私设置 / 站点权限 → 弹出式窗口和重定向，把本站手动加入「允许」列表，再回复你一次。`;

// 各 action 的必填参数校验；返回错误文案或 null
const checkArgs = (action, appName, args) => {
  if (action === "app" && !appName) return "action=app 需要 appName 参数";
  if (action === "click" && !args.selector) return "action=click 需要 args.selector";
  if (action === "type" && !args.selector) return "action=type 需要 args.selector 和 args.text";
  if (action === "wait" && !args.selector && !args.code)
    return "action=wait 需要 args.selector 或 args.code（二选一）";
  if (action === "eval" && !args.code) return "action=eval 需要 args.code";
  return null;
};

// 各 action 的结果等待超时（wait 按其 timeoutMs 放宽）
const timeoutFor = (action, args) => {
  if (action === "screenshot") return 90_000;
  if (action === "wait") return Math.min(60_000, (args.timeoutMs || 10_000) + 15_000);
  if (action === "console" || action === "eval") return 30_000;
  return undefined; // 其余走 debugPreviewCommand 默认（25s）
};

const DESCRIPTION = `在隔离预览窗口上执行操作（预览窗口在隔离域运行 AI 生成的应用，本工具是与它交互的唯一通道；支持最多 10 个窗口，本机 popup 与手机扫码设备平等，每个窗口一行注册表条目）。用 action 指定操作，操作专属参数放 args 对象：
- app：推送应用实际运行（无窗口则新开；已有窗口则增量更新并自动刷新，多个窗口时全部同步；返回时已在跑最新代码且调试代理在线）。顶层 appName 必填。新功能写完/代码修复完用它；排查用户反馈的问题先用 status 确认在线再直接取证，不要急着重推（刷新会清空控制台缓冲，丢失报错现场）。若返回「预览窗口被浏览器拦截」的指引，严格按指引处理（告知用户放行 → 等确认 → check-popup → 重推），不要原地重试。
- windows：列出当前打开的预览窗口（id / 应用 / 设备 / 在线状态 / 最近心跳）。多窗口调试前先调用；顶层 winId 选定目标窗口，省略 winId 的调试指令投递给最近活跃的在线窗口。
- check-popup：探测本站是否允许自动打开新窗口（会短暂闪现一个空白小窗）。两种用途：推送前预检；用户按指引放行弹窗后的确认。未放行时返回给用户的指导话术，按其执行。
- status：查预览窗口状态：是否在线、页面 URL/标题、日志与错误条数。
- console：读控制台日志（log/warn/error/未捕获异常）。args：limit（默认 50）、since（增量拉取时间戳）。不传 since 从头拉全部现场；返回末尾带 latestTs，修复后传 since 对比新日志。检查报错首选。
- dom：DOM 样式快照——每个可见节点一行（几何 + 颜色/字号/边框等关键样式 + 文本），穿 shadow DOM，免授权。args：selector（默认 body）、depth（默认 4）、maxNodes（默认 60）。验证布局/渲染首选。
- text：读元素 innerText。args：selector（默认 body）。
- click：找到元素并点击（先滚动到可视区），返回元素信息。args：selector（深度匹配，穿 shadow DOM）。
- type：向输入元素写入文本（聚焦 → 写值 → 派发 input/change）。args：selector、text。
- wait：轮询等待条件成立（200ms 间隔），避免异步渲染未完成就断言。args：selector（元素出现；absent=true 改等消失）或 code（返回真值的 JS 表达式，支持 await）二选一、timeoutMs（默认 10000）。
- eval：执行任意 JS 并返回序列化结果（支持 await；末句表达式自动成为返回值）。args：code。预置 $ / $$、$deep / $$deep（穿 shadow DOM 深度查询）、$wait、$rect。读应用内部状态、调其方法做深度诊断。
- screenshot：真实像素截图（JPEG），图片展示给用户。每次会弹一次屏幕授权框（在预览窗口选「当前标签页」），截完自动停止共享。args：selector（可选裁剪）、maxSide（默认 1280）、quality（默认 0.72）。手机等远程设备上需对方现场点授权。`;

export default {
  key: "preview",
  name: "preview",
  selfTest, // 内置测试模组地址（工具详情对话框「运行内置测试」加载）
  description: DESCRIPTION,
  schema: {
    action: {
      type: "string",
      description: `操作类型，取值：${ACTIONS.join(" / ")}`,
    },
    appName: {
      type: "string",
      optional: true,
      description: "action=app 时必填：create_app 时确定的应用名",
    },
    winId: {
      type: "string",
      optional: true,
      description:
        "目标预览窗口 id（action=windows 列表里的 id）；缺省 = 最近活跃的在线窗口",
    },
    args: {
      type: "object",
      optional: true,
      description: "操作专属参数对象（各 action 的参数见工具描述）",
    },
  },
  async exec({ action, appName, winId = "", args = {} }, ctx) {
    if (!ACTIONS.includes(action)) {
      return `未知 action：${action}（可用：${ACTIONS.join(" / ")}）`;
    }
    const invalid = checkArgs(action, appName, args);
    if (invalid) return invalid;

    // 推送运行：走 builder-store 的预览主流程（返回即代理可用）
    if (action === "app") {
      if (typeof ctx.openPreview !== "function") return unavailable();
      try {
        const done = await ctx.openPreview(appName);
        // 调试代理未在窗口期内回线（应用页可能仍在加载/跳转）：如实告知，
        // 避免模型把紧随的调试指令离线报错误判为应用故障
        const agentNote =
          done?.agentOnline === false
            ? "\n注意：调试代理尚未回线（应用页可能仍在加载），紧接的调试指令若报「预览未打开 / 不在线」，稍候重试即可，不是应用故障。"
            : "";
        return `预览就绪：${done.url}${agentNote}\n预览窗口已在运行最新代码，可继续用 preview 的 status / console / dom 等 action 调试验证。`;
      } catch (err) {
        // 弹窗被浏览器拦截（remote-preview 约定 code=POPUP_BLOCKED）：
        // 返回行动指引而非失败文案，模型据此指导用户放行后再继续
        if (err?.code === "POPUP_BLOCKED") return POPUP_GUIDE;
        return `操作失败：${err.message}`;
      }
    }

    // 弹窗放行探测：推送前预检 / 用户放行后的确认
    if (action === "check-popup") {
      if (typeof ctx.checkPopup !== "function") return unavailable();
      return wrap(async () => {
        const { allowed } = await ctx.checkPopup();
        return allowed
          ? "弹窗探测通过：本站已允许自动打开新窗口，可以 action=app 推送应用继续调试。"
          : POPUP_GUIDE;
      });
    }

    // 多窗口清单：先列窗口再定调试目标
    if (action === "windows") {
      if (typeof ctx.listPreviewWindows !== "function") return unavailable();
      return wrap(async () => {
        const list = await ctx.listPreviewWindows();
        if (!list.length) {
          return "当前没有已注册的预览窗口（窗口打开后会自动注册；可用 action=app 推送开窗）";
        }
        const lines = list.map((w, i) => {
          const state = w.online ? "在线" : "离线";
          const ago = Math.max(0, Math.round((Date.now() - w.lastSeen) / 1000));
          return `${i + 1}. [${state}] id=${w.id} 应用=${w.app || "?"} 设备=${w.device || "?"} 最近心跳=${ago}s 前`;
        });
        return `共 ${list.length} 个预览窗口（在线 ${
          list.filter((w) => w.online).length
        } 个）：\n${lines.join("\n")}\n用顶层 winId 参数定向调试某个窗口；省略 winId = 最近活跃的在线窗口。`;
      });
    }

    if (typeof ctx.previewDebug !== "function") return unavailable();
    const cmd = ACTION_CMDS[action];
    return wrap(async () => {
      const outcome = await ctx.previewDebug(cmd, args, timeoutFor(action, args), winId);
      // 截图：图片卡片展示给用户；模型无法看图，引导布局核验用 dom
      if (action === "screenshot") {
        const img = outcome?.meta?.image;
        if (img && typeof ctx.onPreviewShot === "function") {
          ctx.onPreviewShot(`data:${img.mime};base64,${outcome.result}`, img);
        }
        const sizeNote = img
          ? `（${img.w}x${img.h} JPEG${args.selector ? `，按 ${args.selector} 裁剪` : ""}）`
          : "";
        return `截图已生成并展示给用户${sizeNote}。你（模型）无法直接查看图片内容；布局/颜色/文本核验请用 action=dom。`;
      }
      return okText(outcome);
    });
  },
};
