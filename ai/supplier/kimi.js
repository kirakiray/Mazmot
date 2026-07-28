import { Assistant } from "./assistant.js";

// 支持 thinking 参数控制的模型；kimi-k3 / kimi-k2.7-code 另有规则
const THINKING_CONTROLLABLE = new Set(["kimi-k2.6", "kimi-k2.5"]);

export class KimiAssistant extends Assistant {
  BASE_URL = "https://api.moonshot.cn/v1";
  providerName = "Kimi";

  async chat({
    thinking = false,
    model = "kimi-k2.6",
    reasoningEffort = "high", // kimi-k3 专用："low" / "high" / "max"
    stream = false,
    messages,
    onStream = null,
    thinkingKeep = null, // 仅 kimi-k2.6 支持："all" 启用保留式思考
  }) {
    const requestBody = {
      model,
      stream,
      messages,
      max_tokens: 32000,
    };

    if (model === "kimi-k3") {
      // kimi-k3 始终进行推理、不支持 thinking 参数，通过 reasoning_effort 调节强度
      requestBody.reasoning_effort = reasoningEffort;
    } else if (model === "kimi-k2.7-code") {
      // 始终开启思考，thinking.type 仅允许 "enabled"，thinking.keep 始终视为 "all"
      // 不传 thinking 参数即可，模型按默认行为工作
    } else if (THINKING_CONTROLLABLE.has(model)) {
      requestBody.thinking = {
        type: thinking ? "enabled" : "disabled",
        ...(thinkingKeep && { keep: thinkingKeep }),
      };
    }
    // 其他未知模型：保持最小请求体，不强行注入 thinking 参数

    const response = await fetch(`${this.BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    if (stream) {
      return this.handleStreamResponse(response, onStream);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      reasoningContent: data.choices[0].message.reasoning_content,
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
      },
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    const data = await response.json();
    return data.data || data;
  }

  async getRemaining() {
    const response = await fetch(`${this.BASE_URL}/users/me/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    const data = await response.json();
    const amount = Number(data.data?.balance);
    return {
      balances: isNaN(amount) ? [] : [{ currency: null, amount, raw: data.data }],
      raw: data,
    };
  }
}

export default KimiAssistant;
