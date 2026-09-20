import { Assistant } from "./assistant.js";

// AI 转发服务器（server/ai-relay）客户端 Assistant。
// apiKey 字段保存的是完整邀请码：URL-safe Base64 的 JSON {"u": serverUrl, "k": bearkey}，
// 内部解出服务器地址与 bearkey 后以 OpenAI 兼容接口访问 /v1/*。

/**
 * 解码邀请码，返回 { baseUrl, bearkey }；格式非法返回 null。
 * 同时导出供 ai-manager 等 UI 做格式预校验 / 展示服务器地址。
 */
export const decodeInvite = (code) => {
  try {
    const raw = atob(
      code
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(code.trim().length / 4) * 4, "="),
    );
    const data = JSON.parse(raw);
    if (typeof data.u !== "string" || typeof data.k !== "string" || !data.u || !data.k) {
      return null;
    }
    return { baseUrl: data.u.replace(/\/+$/, ""), bearkey: data.k };
  } catch {
    return null;
  }
};

/**
 * 拉取转发服务器公开信息（命名）。
 * ai-manager 添加邀请码时调用，把命名随 key 持久化，供各应用选择 provider 时展示。
 */
export const fetchServerInfo = async (baseUrl) => {
  const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/server`);
  if (!resp.ok) {
    throw new Error(`server info error: ${resp.status}`);
  }
  return resp.json(); // { name }
};

export class RelayAssistant extends Assistant {
  providerName = "relay";
  /** 邀请码解析结果（构造时填充） */
  #invite = null;

  constructor(id, apiKey) {
    super(id, apiKey);
    const invite = decodeInvite(apiKey ?? "");
    if (!invite) {
      throw new Error("relay 邀请码无效（应为服务器签发的 base64 邀请码）");
    }
    this.#invite = invite;
  }

  get baseUrl() {
    return this.#invite.baseUrl;
  }

  async chat({
    model = "deepseek-chat",
    stream = false,
    messages,
    onStream = null,
    signal,
    tools = null,
    toolChoice = null,
  }) {
    const requestBody = { model, stream, messages };
    if (tools?.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice ?? "auto";
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#invite.bearkey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    if (stream) {
      return this.handleStreamResponse(response, onStream, signal);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      reasoningContent: data.choices[0].message.reasoning_content,
      toolCalls: data.choices[0].message.tool_calls || [],
      model: data.model,
      usage: data.usage,
      raw: data,
    };
  }

  async getModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.#invite.bearkey}` },
    });
    if (!response.ok) {
      throw await this._buildError(response);
    }
    const data = await response.json();
    return data.data || data;
  }

  /**
   * 转发服务器无余额概念，getRemaining 返回 token 配额视角：
   * balances: [{ currency: "tokens", amount: 剩余 }]；无限配额 amount 为 null。
   */
  async getRemaining() {
    const response = await fetch(`${this.baseUrl}/v1/usage`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.#invite.bearkey}` },
    });
    if (!response.ok) {
      throw await this._buildError(response);
    }
    const data = await response.json();
    return {
      balances: [
        {
          currency: "tokens",
          amount:
            data.quotaTokens == null
              ? null
              : Math.max(0, Number(data.quotaTokens) - Number(data.usedTokens || 0)),
          raw: data,
        },
      ],
      raw: data,
    };
  }
}

export default RelayAssistant;
