import { Assistant } from "./assistant.js";

export class DeepseekAssistant extends Assistant {
  BASE_URL = "https://api.deepseek.com";
  providerName = "deepseek";

  async chat({
    thinking = false,
    model = "deepseek-v4-flash",
    reasoningEffort = "high",
    stream = false,
    messages,
    onStream = null,
    signal,
  }) {
    const requestBody = {
      model,
      stream,
      messages,
      thinking: { type: thinking ? "enabled" : "disabled" },
    };

    if (thinking) {
      requestBody.reasoning_effort = reasoningEffort;
    }

    const response = await fetch(`${this.BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
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
    const response = await fetch(`${this.BASE_URL}/user/balance`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    const data = await response.json();
    return {
      balances: (data.balance_infos || []).map((info) => ({
        currency: info.currency,
        amount: Number(info.total_balance),
        raw: info,
      })),
      raw: data,
    };
  }
}

export default DeepseekAssistant;
