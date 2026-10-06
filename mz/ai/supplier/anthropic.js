import { OpenAICompatAssistant } from "./openai-compat.js";

// Anthropic 官方 OpenAI 兼容层（api.anthropic.com/v1，官方定位为测试 / 评估用，
// 非 Anthropic 承诺的长期生产方案；Claude 原生 Messages API 是另一套 wire，这里
// 走兼容层保持全站 OpenAI wire 统一）。鉴权 Bearer；同时带 x-api-key +
// anthropic-version，覆盖兼容层与原生端点两种鉴权理解。
// Claude 4.5+ 自适应思考，兼容层对思考档位不可调，reasoningParams 不注入。
export class AnthropicAssistant extends OpenAICompatAssistant {
  BASE_URL = "https://api.anthropic.com/v1";
  providerName = "anthropic";
  defaultModel = "claude-sonnet-5-5";

  extraHeaders() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  reasoningParams() {
    return {};
  }
}

export default AnthropicAssistant;
