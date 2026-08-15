import { findTool, toolsToWire } from "./tools.js";

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
 * @param {Array} [opts.tools] - tool() 定义的工具列表，可为空（退化为普通对话）
 * @param {string} [opts.systemPrompt] - 系统提示词（每次运行重新注入，不写入记忆）
 * @param {object} [opts.checkpointer] - 会话记忆（如 MemorySaver），配合 chat 的 threadId 使用
 * @param {number} [opts.maxSteps=12] - 模型↔工具往返上限，超限抛错
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
  maxSteps = 12,
} = {}) => {
  if (!assistant) throw new Error("createAgent requires an assistant");

  /**
   * 跑完整循环。调用方式与 assistant.chat 同构。
   *
   * @param {object} params
   * @param {Array} params.messages - 本次输入（{ role, content } wire 格式）
   * @param {boolean} [params.stream] - true 时 onStream 额外收到 text 增量事件
   * @param {(event: object) => void} [params.onStream] - 事件回调，见 README（text / toolCalls / toolResult / done）
   * @param {string} [params.threadId] - 配合 checkpointer 加载 / 落盘历史
   * @param {AbortSignal} [params.signal] - 取消请求（透传给每次 assistant.chat）
   * @returns {Promise<{content, reasoningContent, model, usage, toolCalls, messages}>}
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

    // 整个循环累计的 token 用量（模型可能被调用多次）
    const usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    const addUsage = (u) => {
      if (!u) return;
      usage.prompt_tokens += u.prompt_tokens ?? 0;
      usage.completion_tokens += u.completion_tokens ?? 0;
      usage.total_tokens +=
        u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
    };

    let lastModel = "";
    let lastReasoning = "";

    const emit = (event) => {
      if (onStream) onStream(event);
    };

    for (let step = 1; step <= maxSteps; step++) {
      // ---- 模型节点 ----
      const res = await assistant.chat({
        model,
        thinking,
        reasoningEffort,
        thinkingKeep,
        // 传快照：本轮请求的输入不可变（循环后续 push 不影响已发出的请求，也方便调用方留存每轮现场）
        messages: [...messages],
        stream,
        signal,
        tools: tools.length ? toolsToWire(tools) : null,
        onStream:
          stream && onStream
            ? (data) => {
                // 文本/思考增量原样转发（字段与 assistant.chat 的 onStream 一致）
                if (data.done || (!data.delta && !data.deltaReasoning)) return;
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

      const aiMessage = {
        role: "assistant",
        content: res.content ?? "",
        ...(res.toolCalls?.length ? { tool_calls: res.toolCalls } : {}),
      };
      messages.push(aiMessage);

      // 无工具调用 → 最终回答，落盘记忆后结束
      if (!res.toolCalls?.length) {
        if (threadId && checkpointer) {
          await checkpointer.set(threadId, messages.slice(persistBase));
        }
        const result = {
          content: res.content ?? "",
          reasoningContent: lastReasoning,
          model: lastModel,
          usage,
          toolCalls: [],
          messages,
        };
        emit({ type: "done", done: true, ...result });
        return result;
      }

      // ---- 工具节点：执行本轮全部 tool call，结果以 tool 消息回给模型 ----
      emit({ type: "toolCalls", toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const name = call.function?.name ?? call.name;
        const rawArgs = call.function?.arguments ?? call.args ?? "{}";
        const target = findTool(tools, name);
        const result = target
          ? await target.invoke(rawArgs)
          : `没有找到工具：${name}（可用工具：${
              tools.map((t) => t.name).join(", ") || "无"
            }）`;
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: call.id,
          ...(name ? { name } : {}),
        });
        emit({
          type: "toolResult",
          name,
          toolCallId: call.id,
          result,
        });
      }
    }

    throw new Error(`agent 超过最大步数 ${maxSteps}，可能陷入工具循环`);
  };

  return { chat };
};
