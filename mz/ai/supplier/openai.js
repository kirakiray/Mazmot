import { OpenAICompatAssistant } from "./openai-compat.js";

// OpenAI 官方 API（api.openai.com/v1），标准 OpenAI wire。
// 模型清单动态拉取（getModels），/v1/models 会同时返回 embedding / tts / whisper /
// 图像等非对话模型，filterModels 只保留对话系（gpt-* / o1·o3·o4-* / chatgpt-*）。
// 思考经 reasoning_effort 控制（minimal/low/medium/high，gpt-5 系起支持）。
export class OpenAIAssistant extends OpenAICompatAssistant {
  BASE_URL = "https://api.openai.com/v1";
  providerName = "openai";
  defaultModel = "gpt-5.6";

  filterModels(models) {
    const idOf = (m) => (typeof m === "string" ? m : m?.id || m?.name || "");
    return models.filter((m) => {
      const id = idOf(m);
      // gpt-image-* 是图像生成模型，从对话清单剔除
      return id.startsWith("gpt-image")
        ? false
        : /^(gpt-|o[134]|chatgpt-)/.test(id);
    });
  }
}

export default OpenAIAssistant;
