import { OpenAICompatAssistant } from "./openai-compat.js";

// xAI Grok 官方 API（api.x.ai/v1），标准 OpenAI 兼容 wire。
// grok-4 系思考不可关，reasoning_effort 认 low/medium/high/xhigh（默认 high）；
// 平台 max 档映射为 xhigh（不支持 xhigh 的模型服务端自动降为 high）。
export class GrokAssistant extends OpenAICompatAssistant {
  BASE_URL = "https://api.x.ai/v1";
  providerName = "grok";
  defaultModel = "grok-4.7";

  reasoningParams(effort) {
    // grok-3 等非思考模型不认档位（efforts 表给含 off 的通用档），不发思考参数
    if (effort === "off") return {};
    return { reasoning_effort: effort === "max" ? "xhigh" : effort };
  }

  filterModels(models) {
    const idOf = (m) => (typeof m === "string" ? m : m?.id || m?.name || "");
    // 只留 grok 对话系；grok-*image* 是图像生成模型，剔除
    return models.filter((m) => {
      const id = idOf(m);
      return id.startsWith("grok") && !id.includes("image");
    });
  }
}

export default GrokAssistant;
