// 各供应商 / 模型支持的思考档位表与夹取工具（纯函数，无 /nos 依赖）。
// 供 conjure 等宿主的「推理等级」菜单动态生成可选项，并在注入 Agent 前
// 把用户偏好夹取到当前模型真正支持的档位——各家思考控制差异大：
// DeepSeek/GLM/Kimi-k3 是 reasoning_effort 三档、OpenAI gpt-5 系四档
//（部分不可关）、Qwen 只有 enable_thinking 开关、Anthropic 自适应不可调、
// GLM-4.x / Kimi-k2.6 只有开与关。
//
// 约定档位 id（从弱到强）：off / minimal / low / medium / high / max

export const EFFORT_LABELS = {
  off: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
};

const ORDER = { off: 0, minimal: 1, low: 2, medium: 3, high: 4, max: 5 };

// conjure 历史默认四档（供应商未知 / relay 透明转发时的通用表）
const GENERIC = ["off", "low", "medium", "high"];

/**
 * 某供应商某模型可用的思考档位（有序，从弱到强）。
 * 返回空数组 = 该模型思考不可调（模型内置行为，UI 应显示默认态且不发思考参数）。
 * @param {string} provider providerName（"deepseek" / "kimi" / "glm" / "openai" / …）
 * @param {string} model 模型 id（空串按该供应商的未知模型处理，给通用表）
 */
export function effortLevelsFor(provider, model = "") {
  const m = model || "";
  switch (provider) {
    case "deepseek":
      // v4 系：low / high / max 三档（minimal / medium 等会被官方映射到三档），off=关思考
      return ["off", "low", "high", "max"];
    case "kimi":
      if (m === "kimi-k3") return ["low", "high", "max"]; // 始终思考，仅调强度
      if (m === "kimi-k2.7-code") return []; // 恒开不可调
      if (m.startsWith("kimi-k2.6") || m.startsWith("kimi-k2.5"))
        return ["off", "low"]; // thinking 对象仅开/关
      return GENERIC;
    case "glm":
      if (m.startsWith("glm-5")) return ["low", "high", "max"]; // 思考不可关，仅调档
      return ["off", "low"]; // glm-4.x：thinking 对象仅开/关
    case "openai":
      if (/^(gpt-5|gpt-6)/.test(m)) return ["minimal", "low", "medium", "high"];
      if (/^o[134]/.test(m)) return ["low", "medium", "high"];
      return []; // gpt-4o 等非思考模型
    case "gemini":
      return ["off", "low", "high"];
    case "anthropic":
      return []; // Claude 4.5+ 自适应思考，兼容层不可调
    case "qwen":
      return ["off", "low"]; // enable_thinking 仅开/关，low=开
    case "relay":
      // 上游由服务器 key 池决定，无法按模型判定，给宽表（发送前夹取）
      return ["off", "low", "medium", "high", "max"];
    default:
      return GENERIC;
  }
}

/**
 * 把用户偏好档位夹取到该模型支持的档位：优先取不强于偏好的最高档，
 * 无更低的档位时取最低档。空表（思考不可调）返回 null，调用方应跳过思考参数。
 * @returns {string|null}
 */
export function clampEffort(provider, model, effort) {
  const levels = effortLevelsFor(provider, model);
  if (!levels.length) return null;
  if (levels.includes(effort)) return effort;
  const target = ORDER[effort] ?? ORDER.low;
  const lower = levels.filter((l) => ORDER[l] <= target);
  return lower.length ? lower[lower.length - 1] : levels[0];
}
