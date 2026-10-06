import { OpenAICompatAssistant } from "./openai-compat.js";

// Google Gemini API 的官方 OpenAI 兼容端点
//（generativelanguage.googleapis.com/v1beta/openai，与原生 API 同一把 AI Studio
// Key，Bearer 鉴权）。Gemini 3 系需 v1beta 及以上版本，不走 v1。
export class GeminiAssistant extends OpenAICompatAssistant {
  BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
  providerName = "gemini";
  defaultModel = "gemini-3-flash";

  // 兼容端点 /models 同时返回 embedding 系（text-embedding-004 等），只留 gemini-*
  filterModels(models) {
    const idOf = (m) => (typeof m === "string" ? m : m?.id || m?.name || "");
    return models.filter((m) => idOf(m).startsWith("gemini"));
  }
}

export default GeminiAssistant;
