/**
 * 轻量消息模型：对齐 LangChain 的消息对象（getType() / content / toolCalls）。
 * 既支持类实例，也兼容 { role, content } 普通对象（自动归一化）。
 */

export class BaseMessage {
  constructor(content = "", extra = {}) {
    this.content = content;
    Object.assign(this, extra);
  }

  /** content 统一转纯文本 */
  text() {
    return textOf(this.content);
  }
}

export class SystemMessage extends BaseMessage {
  getType() {
    return "system";
  }
}

export class HumanMessage extends BaseMessage {
  getType() {
    return "human";
  }
}

export class AIMessage extends BaseMessage {
  constructor(content = "", extra = {}) {
    super(content, extra);
    this.toolCalls ??= [];
  }

  getType() {
    return "ai";
  }
}

export class ToolMessage extends BaseMessage {
  getType() {
    return "tool";
  }
}

/** 把 content（字符串或内容块数组）统一转成纯文本 */
export const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : block?.text ?? ""))
      .join("");
  }
  if (content == null) return "";
  return String(content);
};

/**
 * 归一化 tool call：wire 格式（{ id, function: { name, arguments } }）或
 * 已归一化格式 → { id, name, args }，args 保持 JSON 字符串，由工具执行时解析。
 */
export const normalizeToolCalls = (toolCalls) =>
  (toolCalls ?? [])
    .filter((tc) => tc?.function?.name || tc?.name)
    .map((tc) => ({
      id: tc.id ?? "",
      name: tc.function?.name ?? tc.name,
      args:
        tc.function?.arguments ??
        (tc.args != null
          ? typeof tc.args === "string"
            ? tc.args
            : JSON.stringify(tc.args)
          : "{}"),
    }));

/** 混合消息列表（类实例或 { role } 普通对象）→ 统一的类实例列表 */
export const toMessages = (messages) =>
  (messages ?? []).map((message) => {
    if (message instanceof BaseMessage) return message;
    const content = textOf(message.content ?? "");
    switch (message.role) {
      case "system":
        return new SystemMessage(content);
      case "assistant":
        return new AIMessage(content, {
          toolCalls: normalizeToolCalls(message.tool_calls),
        });
      case "tool":
        return new ToolMessage(content, {
          toolCallId: message.tool_call_id,
          name: message.name,
        });
      case "user":
      default:
        return new HumanMessage(content);
    }
  });

/** 消息列表 → OpenAI wire 格式（供应商 API 直接可用） */
export const toWireMessages = (messages) =>
  toMessages(messages).map((message) => {
    switch (message.getType()) {
      case "system":
        return { role: "system", content: message.text() };
      case "human":
        return { role: "user", content: message.text() };
      case "ai": {
        const wire = { role: "assistant", content: message.text() };
        if (message.toolCalls?.length) {
          wire.tool_calls = message.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.args },
          }));
        }
        return wire;
      }
      case "tool":
        return {
          role: "tool",
          content: message.text(),
          tool_call_id: message.toolCallId,
          ...(message.name ? { name: message.name } : {}),
        };
      default:
        throw new Error(`unknown message type: ${message.getType()}`);
    }
  });

/** supplier chat 返回值 → AIMessage（含 toolCalls 与 token 用量） */
export const aiMessageFromResponse = (res) =>
  new AIMessage(res.content ?? "", {
    reasoningContent: res.reasoningContent || "",
    model: res.model || "",
    toolCalls: normalizeToolCalls(res.toolCalls),
    usageMetadata: res.usage
      ? {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
          totalTokens: res.usage.total_tokens ?? 0,
        }
      : null,
    ...(res.raw != null ? { raw: res.raw } : {}),
  });
