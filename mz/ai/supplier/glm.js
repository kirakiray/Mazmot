import { Assistant } from "./assistant.js";

// 智谱 GLM 开放平台（bigmodel.cn）
// 常规 Key 走按量付费端点 /api/paas/v4；Coding Plan Key 走订阅端点 /api/coding/paas/v4，
// 两者均为 OpenAI 兼容格式（chat/completions、models、users/me/balance）。
const PAAS_BASE = "https://open.bigmodel.cn/api/paas/v4";
const CODING_BASE = "https://open.bigmodel.cn/api/coding/paas/v4";

export class GlmAssistant extends Assistant {
  BASE_URL = PAAS_BASE;
  providerName = "glm";

  async chat({
    thinking = false,
    model = "glm-5.3-flash",
    stream = false,
    messages,
    onStream = null,
    signal,
    tools = null, // OpenAI 风格函数定义：[{ type: "function", function: { name, description, parameters } }]
    toolChoice = null,
  }) {
    const requestBody = {
      model,
      stream,
      messages,
      // GLM 默认开启思考，显式传 thinking 保持与入参一致
      thinking: { type: thinking ? "enabled" : "disabled" },
    };

    if (tools?.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice ?? "auto";
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
      },
    });

    // Coding Plan 端点可能不提供 /models，降级为最小对话探测（同时兼作 Key 校验）
    if (!response.ok && this.coding && (response.status === 404 || response.status === 405)) {
      await this._probeByChat();
      return [{ id: "glm-4.7" }];
    }

    if (!response.ok) {
      throw await this._buildError(response);
    }

    const data = await response.json();
    return data.data || data;
  }

  async _probeByChat() {
    const response = await fetch(`${this.BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-4.7",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        thinking: { type: "disabled" },
      }),
    });
    if (!response.ok) {
      throw await this._buildError(response);
    }
  }

  async getRemaining() {
    const response = await fetch(`${this.BASE_URL}/users/me/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    // Coding Plan 订阅 Key 无余额概念，查询失败不当作错误
    if (!response.ok) {
      if (this.coding) {
        return { balances: [], raw: null };
      }
      throw await this._buildError(response);
    }

    const data = await response.json();
    // 智谱返回 { balanceInfos: [{ balance, ... }] }，与 OpenAI 风格厂商不同
    const infos = data.balanceInfos || data.data?.balanceInfos || [];
    return {
      balances: infos.map((info) => ({
        currency: "CNY",
        amount: Number(info.balance ?? info.total_balance),
        raw: info,
      })),
      raw: data,
    };
  }
}

export class GlmCodingAssistant extends GlmAssistant {
  coding = true;
  BASE_URL = CODING_BASE;
  providerName = "glm-coding";
}

export default GlmAssistant;
