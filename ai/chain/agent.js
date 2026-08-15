import { AIMessage, SystemMessage, ToolMessage, toMessages } from "./messages.js";
import { findTool, toolsToWire } from "./tools.js";

/**
 * 创建 Agent（对齐 LangChain 的 createAgent）：
 * 模型 ↔ 工具自动循环（模型发起 tool call → 执行工具 → 结果回给模型），直到产出最终回答。
 *
 * @param {object} opts
 * @param {object} opts.model - createChatModel() 的返回值
 * @param {Array} [opts.tools] - tool() 定义的工具列表，可为空（退化为普通对话）
 * @param {string} [opts.systemPrompt] - 系统提示词（每次运行重新注入，不写入记忆）
 * @param {object} [opts.checkpointer] - 会话记忆（如 MemorySaver），配合 config 里的 thread_id 使用
 * @param {number} [opts.maxSteps=12] - 模型↔工具往返上限，防止模型陷入工具循环
 */
export const createAgent = ({
  model,
  tools = [],
  systemPrompt = "",
  checkpointer = null,
  maxSteps = 12,
} = {}) => {
  if (!model) throw new Error("createAgent requires a model");

  /**
   * 模型节点。forwardTokens 为 true 时逐 token 转发 AIMessage 增量，
   * 无论哪种模式，最终都 return 完整的 AIMessage（含 toolCalls）。
   */
  const _modelNode = async function* (messages, opts, forwardTokens) {
    if (!forwardTokens) {
      return await model.invoke(messages, opts);
    }

    let final = null;
    for await (const chunk of model.stream(messages, opts)) {
      if (chunk.done) {
        final = chunk.message;
        continue;
      }
      if (chunk.delta || chunk.deltaReasoning) {
        yield new AIMessage(chunk.delta, {
          reasoningContent: chunk.deltaReasoning,
        });
      }
    }
    if (!final) throw new Error("model stream ended without final message");
    return final;
  };

  /**
   * 主循环。streamMode：
   *  - "updates"：每个节点跑完推送 { model: { messages } } / { tools: { messages } }
   *  - "messages"：逐 token 推送 AIMessage 增量 + 完整 ToolMessage
   *  - null：invoke 模式，中间产物被丢弃，只返回最终结果
   */
  const _run = async function* (input, config = {}, streamMode = "updates") {
    const inputMessages = Array.isArray(input) ? input : input?.messages;
    const threadId = config?.configurable?.thread_id;
    const signal = config?.signal;
    const history =
      threadId && checkpointer ? await checkpointer.get(threadId) : [];

    const messages = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    // 记忆从 systemPrompt 之后开始存，避免把提示词固化进历史
    const persistBase = messages.length;
    messages.push(...history, ...toMessages(inputMessages ?? []));

    const opts = {
      ...(tools.length ? { tools: toolsToWire(tools) } : {}),
      ...(signal ? { signal } : {}),
    };

    for (let step = 1; step <= maxSteps; step++) {
      // ---- 模型节点 ----
      const aiMsg = yield* _modelNode(messages, opts, streamMode === "messages");
      messages.push(aiMsg);
      if (streamMode === "updates") yield { model: { messages: [aiMsg] } };

      // 没有工具调用 → 得到最终回答，落盘记忆后结束
      if (!aiMsg.toolCalls?.length) {
        if (threadId && checkpointer) {
          await checkpointer.set(threadId, messages.slice(persistBase));
        }
        return { messages };
      }

      // ---- 工具节点：执行本轮全部 tool call，结果以 ToolMessage 回给模型 ----
      const toolMessages = [];
      for (const call of aiMsg.toolCalls) {
        const target = findTool(tools, call.name);
        const result = target
          ? await target.invoke(call.args)
          : `没有找到工具：${call.name}（可用工具：${
                  tools.map((t) => t.name).join(", ") || "无"
                }）`;
        const toolMsg = new ToolMessage(result, {
          toolCallId: call.id,
          name: call.name,
        });
        toolMessages.push(toolMsg);
        if (streamMode === "messages") yield toolMsg;
      }
      messages.push(...toolMessages);
      if (streamMode === "updates") yield { tools: { messages: toolMessages } };
    }

    throw new Error(`agent 超过最大步数 ${maxSteps}，可能陷入工具循环`);
  };

  return {
    /**
     * 跑完整循环，返回 { messages: 完整轨迹 }。
     * messages.at(-1) 是最终回答；轨迹中的 AIMessage.toolCalls 可用于调试决策链路。
     */
    async invoke(input, config = {}) {
      const gen = _run(input, config, null);
      let r = await gen.next();
      while (!r.done) r = await gen.next();
      return r.value;
    },

    /**
     * 流式执行。
     * @param {object} input - { messages: [...] } 或直接传消息数组
     * @param {object} [options]
     * @param {"updates"|"messages"} [options.streamMode="updates"]
     * @param {object} [options.configurable] - { thread_id } 配合 checkpointer 使用
     * @param {AbortSignal} [options.signal]
     */
    stream(input, options = {}) {
      const { streamMode = "updates", ...config } = options ?? {};
      return _run(input, config, streamMode);
    },
  };
};
