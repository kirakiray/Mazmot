import { findTool, toolsToWire } from "./tools.js";

/* ---------- 工具循环检测 ----------
 * 平庸的「固定 N 步上限」会误杀长而合法的工作流（如：预览→查控制台→查 DOM→
 * 修复→再预览 的调试循环，步数轻松超过十几步）。真循环的签名是「原样重复」：
 * 同一工具 + 语义相同的参数被反复调用（模型没有从上次结果学到任何东西）。
 */

// 参数规范化：解析后按 key 深排序再序列化——键序不同但语义相同的调用视作重复
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]),
    );
  }
  return v;
};
const canonicalArgs = (raw) => {
  try {
    return JSON.stringify(sortKeys(JSON.parse(String(raw))));
  } catch {
    return String(raw);
  }
};

/**
 * 真循环判定：看已执行工具调用的签名序列（`${name}:${规范化参数}`）——
 *  - 连续 4 次完全相同（同一调用原样重试，中间毫无变化）；
 *  - 或最近 8 次里只有 ≤2 种签名（A,B,A,B… 的窄循环）。
 * 合法的重复调用（参数递增、与不同调用交织）不会命中。纯函数，可单测。
 * @param {string[]} signatures 按执行顺序累计的调用签名
 * @returns {boolean}
 */
export const isToolLoop = (signatures) => {
  const n = signatures.length;
  if (n < 4) return false;
  if (new Set(signatures.slice(-4)).size === 1) return true;
  if (n >= 8 && new Set(signatures.slice(-8)).size <= 2) return true;
  return false;
};

// 触发循环后的收尾提醒（以 user 消息注入，随记忆持久化，模型可见为何被收束）
const LOOP_NUDGE =
  "检测到你正在连续重复完全相同的工具调用，这通常意味着陷入了循环。请立即停止重复，基于已获得的信息收尾：目标已达成就直接给出最终结论；被问题阻塞就明确说明具体障碍、已尝试的方案与建议的下一步。";

/**
 * 创建 Agent：在 supplier 层 assistant 之上封装「模型 ↔ 工具」自动循环，
 * 模型发起 tool call → 执行工具 → 结果回给模型，直到产出最终回答。
 *
 * @param {object} opts
 * @param {object} opts.assistant - 必填，getAssistant() 返回的 supplier 层实例
 * @param {string} [opts.model] - 以下四个均为 assistant.chat 的同名参数，循环内每次调用直传
 * @param {boolean} [opts.thinking]
 * @param {string} [opts.reasoningEffort]
 * @param {string} [opts.thinkingKeep]
 * @param {Array | (() => Array)} [opts.tools] - tool() 定义的工具列表，可为空（退化为普通对话）；
 *   传函数时每轮循环求值一次（支持 async），返回值决定本轮可用工具，可在会话中途动态增删
 * @param {string} [opts.systemPrompt] - 系统提示词（每次运行重新注入，不写入记忆）
 * @param {object} [opts.checkpointer] - 会话记忆（如 MemorySaver），配合 chat 的 threadId 使用
 * @param {number} [opts.maxSteps=80] - 防失控硬上限（模型↔工具往返数），正常任务不应触达；
 *   真正的循环由 isToolLoop 检测并优雅收束，不依赖这个上限
 */
export const createAgent = ({
  assistant,
  model,
  thinking,
  reasoningEffort,
  thinkingKeep,
  tools = [],
  systemPrompt = "",
  checkpointer = null,
  maxSteps = 80,
} = {}) => {
  if (!assistant) throw new Error("createAgent requires an assistant");

  // tools 支持数组或 () => 数组：函数形式每轮求值（可 async），返回最新可用工具列表
  const resolveTools = async () =>
    (typeof tools === "function" ? await tools() : tools) ?? [];

  /**
   * 跑完整循环。调用方式与 assistant.chat 同构。
   *
   * @param {object} params
   * @param {Array} params.messages - 本次输入（{ role, content } wire 格式）
   * @param {boolean} [params.stream] - true 时 onStream 额外收到 text 增量事件
   * @param {(event: object) => void} [params.onStream] - 事件回调，见 README（text / toolCalls / toolResult / done）
   * @param {string} [params.threadId] - 配合 checkpointer 加载 / 落盘历史
   * @param {AbortSignal} [params.signal] - 取消请求（透传给每次 assistant.chat）
   * @returns {Promise<{content, reasoningContent, model, usage, stats, contextBreakdown, toolCalls, messages}>}
   */
  const chat = async ({
    messages: inputMessages,
    stream = false,
    onStream = null,
    threadId = null,
    signal,
  } = {}) => {
    const history =
      threadId && checkpointer ? await checkpointer.get(threadId) : [];

    // 完整轨迹：system 在最前；记忆与本次输入在其后（记忆不含 system，避免固化提示词）
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    const persistBase = messages.length;
    messages.push(...history, ...(inputMessages ?? []));

    // 记忆增量落盘：输入写入后、每轮工具结果齐了、最终回答时各落一次——
    // 手动停止 / 异常中断 / 超步数时，本回合的用户请求与已完成的工具进度
    // 仍在记忆里，下次对话（如「继续」）能接着断点做而不是回到上个完整回合。
    // 落盘断点都选在 wire 结构合法处（末尾为 user 或齐平的 tool 结果），
    // assistant 的 tool_calls 永不悬空
    const persist = () =>
      threadId && checkpointer
        ? checkpointer.set(threadId, messages.slice(persistBase))
        : Promise.resolve();
    await persist();

    // 整个循环累计的 token 用量（模型可能被调用多次）。
    // 缓存命中/未命中字段（DeepSeek 的 prompt_cache_hit_tokens /
    // prompt_cache_miss_tokens、OpenAI 风格的 prompt_tokens_details.cached_tokens）
    // 只在供应商有返回时才累计，未回报的供应商不产生 0 值假象
    const usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      // 当前上下文占用估算：取「最后一次模型调用」的 prompt + completion
      // （每次调用的 prompt_tokens 即当时的完整上下文，末次调用最贴近现状；
      // 覆盖式写入而非累计，与上面的累计字段不同）
      context_tokens: 0,
    };
    const addUsage = (u) => {
      if (!u) return;
      usage.prompt_tokens += u.prompt_tokens ?? 0;
      usage.completion_tokens += u.completion_tokens ?? 0;
      usage.context_tokens =
        (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      usage.total_tokens +=
        u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      if (u.prompt_cache_hit_tokens !== undefined) {
        usage.prompt_cache_hit_tokens =
          (usage.prompt_cache_hit_tokens ?? 0) + u.prompt_cache_hit_tokens;
      }
      if (u.prompt_cache_miss_tokens !== undefined) {
        usage.prompt_cache_miss_tokens =
          (usage.prompt_cache_miss_tokens ?? 0) + u.prompt_cache_miss_tokens;
      }
      // 推理 token（DeepSeek/OpenAI 的 completion_tokens_details，仅供应商
      // 回报时累计，不产生 0 值假象）；「输出（其中推理 X）」明细用
      const rt = u.completion_tokens_details?.reasoning_tokens;
      if (rt !== undefined) {
        usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + rt;
      }
      const cached = u.prompt_tokens_details?.cached_tokens;
      if (cached !== undefined) {
        usage.prompt_tokens_details = usage.prompt_tokens_details || {};
        usage.prompt_tokens_details.cached_tokens =
          (usage.prompt_tokens_details.cached_tokens ?? 0) + cached;
      }
    };

    let lastModel = "";
    let lastReasoning = "";

    // 本回合的执行统计（模型节点 / 工具节点分别计时，客户端墙上时间）：
    // steps 模型调用次数；llmMs 模型调用累计耗时；toolMs 工具执行累计耗时；
    // ttftMs/ttftSteps 首 token 延迟累计与计步（仅流式步有）；decodeMs/decodeTokens
    // 解码耗时与输出 token 累计（同步计，二者相除即输出速度 TPS）
    const stats = {
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
    };
    // 上下文构成估算（对齐最近一次模型调用的 provider 报告 context_tokens）：
    // 系统提示词与工具定义按字符数估算，对话消息取余量；供 UI 做分解展示
    let contextBreakdown = null;

    const toolSignatures = []; // 已执行工具调用签名（isToolLoop 判定用）
    let loopNudged = false; // 已注入循环提醒：下一轮收起工具，逼模型收尾

    const emit = (event) => {
      if (onStream) onStream(event);
    };

    // wire content 字符量估算：多模态（OpenAI content 数组）取 text 部分按字符、
    // image_url 部分按固定 1200 字符（≈600 token）估；纯字符串原样计数。
    // 仅用于 provider 未回报 context_tokens 时的兜底估算
    const wireContentLen = (content) =>
      Array.isArray(content)
        ? content.reduce(
            (n, p) =>
              n +
              (p?.type === "text"
                ? String(p.text ?? "").length
                : p?.type === "image_url"
                  ? 1200
                  : 0),
            0,
          )
        : String(content ?? "").length;

    // 上下文构成估算：system / tools 按字符数 ÷2 估 token，messages 用
    // provider 报告的总占用扣减余量（无报告时全部按字符估算）
    const estimateBreakdown = (wireTools, reportedContext) => {
      const sysTokens = Math.ceil((systemPrompt?.length || 0) / 2);
      const toolsTokens = wireTools
        ? Math.ceil(JSON.stringify(wireTools).length / 2)
        : 0;
      let messageTokens;
      if (reportedContext > 0) {
        messageTokens = Math.max(0, reportedContext - sysTokens - toolsTokens);
      } else {
        messageTokens = Math.ceil(
          messages
            .slice(1)
            .reduce((n, m) => n + wireContentLen(m.content), 0) / 2,
        );
      }
      return { systemTokens: sysTokens, toolsTokens, messageTokens };
    };

    for (let step = 1; step <= maxSteps; step++) {
      // ---- 模型节点 ----
      // 本轮可用工具（函数形式在每轮求值；本轮内 wire 与执行共用同一份，保证一致性）。
      // 循环提醒后不再提供工具：模型只能基于已有信息给最终回答，保证回合收敛
      const currentTools = await resolveTools();
      const wireTools =
        !loopNudged && currentTools.length ? toolsToWire(currentTools) : null;
      // 计时：本步模型调用墙上时间 + 首 token 延迟（流式时从增量事件取）
      const stepStart = Date.now();
      let firstTokenAt = null;
      const res = await assistant.chat({
        model,
        thinking,
        reasoningEffort,
        thinkingKeep,
        // 传快照：本轮请求的输入不可变（循环后续 push 不影响已发出的请求，也方便调用方留存每轮现场）
        messages: [...messages],
        stream,
        signal,
        tools: wireTools,
        onStream:
          stream && onStream
            ? (data) => {
                // 文本/思考增量原样转发（字段与 assistant.chat 的 onStream 一致）
                if (data.done || (!data.delta && !data.deltaReasoning)) return;
                if (firstTokenAt === null) firstTokenAt = Date.now();
                emit({
                  type: "text",
                  delta: data.delta,
                  deltaReasoning: data.deltaReasoning,
                  content: data.content,
                  reasoningContent: data.reasoningContent,
                });
              }
            : null,
      });

      lastModel = res.model || lastModel;
      lastReasoning = res.reasoningContent || lastReasoning;
      addUsage(res.usage);

      // 统计本步：模型耗时 / 首 token 延迟 / 解码速度分母（输出 token 只累计
      // 有解码耗时的步，保证 TPS 分子分母同源）
      const stepEnd = Date.now();
      stats.steps += 1;
      stats.llmMs += Math.max(0, stepEnd - stepStart);
      if (firstTokenAt !== null) {
        stats.ttftMs += Math.max(0, firstTokenAt - stepStart);
        stats.ttftSteps += 1;
        stats.decodeMs += Math.max(0, stepEnd - firstTokenAt);
        stats.decodeTokens += res.usage?.completion_tokens ?? 0;
      }
      contextBreakdown = estimateBreakdown(wireTools, usage.context_tokens);

      // 还会继续工具循环的中间模型调用：推一条实时用量快照，消费方可在
      // 循环期间更新上下文占用进度（最终回合的完整用量随 done 整体下发）
      if (res.toolCalls?.length) {
        emit({
          type: "usage",
          usage: { ...usage },
          stats: { ...stats },
          contextBreakdown: { ...contextBreakdown },
        });
      }

      const aiMessage = {
        role: "assistant",
        content: res.content ?? "",
        ...(res.toolCalls?.length ? { tool_calls: res.toolCalls } : {}),
      };
      messages.push(aiMessage);

      // 无工具调用 → 最终回答，落盘记忆后结束
      if (!res.toolCalls?.length) {
        await persist();
        const result = {
          content: res.content ?? "",
          reasoningContent: lastReasoning,
          model: lastModel,
          usage,
          stats: { ...stats },
          contextBreakdown: contextBreakdown
            ? { ...contextBreakdown }
            : estimateBreakdown(null, usage.context_tokens),
          toolCalls: [],
          messages,
        };
        emit({ type: "done", done: true, ...result });
        return result;
      }

      // ---- 工具节点：执行本轮全部 tool call，结果以 tool 消息回给模型 ----
      if (loopNudged) {
        // 已提醒收敛仍发起工具调用（未提供工具时正常不会发生）：视为失控，硬停
        throw new Error("agent 在循环提醒后仍发起工具调用，已强制停止");
      }
      emit({ type: "toolCalls", toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const name = call.function?.name ?? call.name;
        const rawArgs = call.function?.arguments ?? call.args ?? "{}";
        const target = findTool(currentTools, name);
        const toolStart = Date.now();
        const result = target
          ? await target.invoke(rawArgs)
          : `没有找到工具：${name}（可用工具：${
              currentTools.map((t) => t.name).join(", ") || "无"
            }）`;
        stats.toolMs += Math.max(0, Date.now() - toolStart);
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: call.id,
          ...(name ? { name } : {}),
        });
        toolSignatures.push(`${name}:${canonicalArgs(rawArgs)}`);
        emit({
          type: "toolResult",
          name,
          toolCallId: call.id,
          result,
        });
      }
      // 本轮工具结果已齐（wire 结构合法的断点），增量落盘后再插入收束提醒
      // 等其他角色消息
      await persist();
      // 本轮工具全部执行完（tool 消息齐了）才能插入其他角色消息，保持 wire 结构合法
      if (!loopNudged && isToolLoop(toolSignatures)) {
        loopNudged = true;
        messages.push({ role: "user", content: LOOP_NUDGE });
      }
    }

    throw new Error(
      `agent 达到工具循环步数上限 ${maxSteps}（防失控保护，正常任务不应触达；确需更长流程可调大 createAgent 的 maxSteps）`,
    );
  };

  return { chat };
};
