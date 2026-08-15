import { aiMessageFromResponse, toWireMessages } from "./messages.js";

// ../main.js 顶层依赖 /nos/storage（受 NoneOS Core 就绪时机约束），按需惰性加载
let _getAssistantFn = null;
const _getAssistant = async (keyId) => {
  _getAssistantFn ??= (await import("../main.js")).getAssistant;
  return _getAssistantFn(keyId);
};

/**
 * 创建 chat model（对齐 LangChain 的 chatModel.invoke / stream）。
 *
 * @param {object} defaults - 默认参数，调用时可被 options 覆盖
 * @param {string} [defaults.keyId] - 指定用哪条已保存的 key；不传则随机选（多 key 负载均衡）
 * @param {object} [defaults.assistant] - 直接注入 Assistant 实例（测试 / 复用场景），优先于 keyId
 * @param {string} [defaults.model] - 模型名；不传则用供应商默认模型
 * @param {boolean} [defaults.thinking]
 * @param {string} [defaults.reasoningEffort]
 * @param {string} [defaults.thinkingKeep]
 */
export const createChatModel = (defaults = {}) => {
  const _chat = async (messages, options, onStream) => {
    const merged = { ...defaults, ...options };
    const assistant =
      defaults.assistant ?? (await _getAssistant(defaults.keyId));

    const res = await assistant.chat({
      model: merged.model,
      messages: toWireMessages(messages),
      thinking: merged.thinking,
      reasoningEffort: merged.reasoningEffort,
      thinkingKeep: merged.thinkingKeep,
      stream: !!onStream,
      onStream,
      signal: merged.signal,
      tools: merged.tools, // OpenAI wire 格式，由 tool().toWire() 生成
      toolChoice: merged.toolChoice,
    });

    return aiMessageFromResponse(res);
  };

  return {
    /** 一次性调用，返回完整 AIMessage（content / toolCalls / usageMetadata） */
    async invoke(messages, options = {}) {
      return _chat(messages, options, null);
    },

    /**
     * 流式调用：逐 chunk 推送 { delta, deltaReasoning, content, done, message? }。
     * done 为 true 的 chunk 携带最终 AIMessage（含累积的 toolCalls）。
     */
    stream: async function* (messages, options = {}) {
      const queue = [];
      let notify = null;
      let settled = false;
      let error = null;

      const wake = () => {
        notify?.();
        notify = null;
      };

      _chat(messages, options, (data) => {
        if (data.done) {
          queue.push({
            delta: "",
            deltaReasoning: "",
            content: data.content,
            done: true,
            message: aiMessageFromResponse(data),
          });
        } else if (data.delta || data.deltaReasoning) {
          queue.push({
            delta: data.delta,
            deltaReasoning: data.deltaReasoning,
            content: data.content,
            done: false,
          });
        }
        wake();
      }).then(
        () => {
          settled = true;
          wake();
        },
        (e) => {
          error = e;
          settled = true;
          wake();
        }
      );

      while (true) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        if (error) throw error;
        if (settled) return;
        await new Promise((resolve) => (notify = resolve));
      }
    },
  };
};
