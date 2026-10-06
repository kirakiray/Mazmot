import { OpenAICompatAssistant } from "./openai-compat.js";

// 阿里通义千问（DashScope OpenAI 兼容模式 compatible-mode/v1，与原生 API 同一把
// DashScope Key，Bearer 鉴权）。当前 max 系：qwen3-max（稳定别名）/ qwen3.8-max-0902
//（版本号形式）；思考控制是 enable_thinking 布尔（qwen3 系混合思考模型，无细档位，
// reasoning_effort 仅部分新模型认，不透传）。
export class QwenAssistant extends OpenAICompatAssistant {
  BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  providerName = "qwen";
  defaultModel = "qwen3-max";

  reasoningParams() {
    return { enable_thinking: true };
  }

  // 兼容端点 /models 返回全系模型（含 embedding / 多模态等），只留 qwen-* 对话系
  filterModels(models) {
    const idOf = (m) => (typeof m === "string" ? m : m?.id || m?.name || "");
    return models.filter((m) => idOf(m).startsWith("qwen"));
  }
}

export default QwenAssistant;
