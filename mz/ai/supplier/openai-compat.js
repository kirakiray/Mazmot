import { Assistant } from "./assistant.js";

// OpenAI 兼容 wire 协议公共基类（chat/completions + models，Bearer 鉴权）。
// OpenAI 官方、Gemini 官方 OpenAI 兼容端点、Anthropic 官方 OpenAI 兼容层共用；
// 国内厂商（DeepSeek / Kimi / GLM）参数差异较大（thinking 对象、余额接口等），
// 各自独立实现，不走此基类。
export class OpenAICompatAssistant extends Assistant {
  /** 默认模型（子类覆盖；chat 未传 model 时使用） */
  defaultModel = "";

  /** 额外请求头钩子（子类按需覆盖，如 Anthropic 的版本头 + x-api-key） */
  extraHeaders() {
    return {};
  }

  /** getModels 结果过滤钩子（子类覆盖，剔除非对话模型） */
  filterModels(models) {
    return models;
  }

  /**
   * thinking 开启时注入的思考参数（子类覆盖）：
   * 默认 OpenAI 风格 reasoning_effort；Anthropic 兼容层不可调返回 {}；
   * Qwen 换 DashScope 的 enable_thinking 布尔（无细档位）。
   */
  reasoningParams(reasoningEffort) {
    return { reasoning_effort: reasoningEffort };
  }

  async chat({
    thinking = false,
    model,
    reasoningEffort = "low",
    stream = false,
    messages,
    onStream = null,
    signal,
    tools = null, // OpenAI 风格函数定义：[{ type: "function", function: { name, description, parameters } }]
    toolChoice = null,
  }) {
    const requestBody = {
      model: model || this.defaultModel,
      stream,
      messages,
    };

    if (thinking) {
      Object.assign(requestBody, this.reasoningParams(reasoningEffort));
    }

    if (tools?.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice ?? "auto";
    }

    const response = await fetch(`${this.BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders(),
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
    const response = await fetch(`${this.BASE_URL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders(),
      },
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    const data = await response.json();
    return this.filterModels(data.data || data);
  }

  // OpenAI 兼容层均无余额查询接口（与 GLM Coding 同款空返回，UI 展示为无余额数据）
  async getRemaining() {
    return { balances: [], raw: null };
  }
}

export default OpenAICompatAssistant;
