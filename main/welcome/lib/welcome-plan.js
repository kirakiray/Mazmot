// 欢迎引导 - 用途选择纯逻辑（无 DOM / 无 /nos 依赖，可单测）
// 用途 → 待安装官方应用 id 的唯一映射源；调整引导推荐的应用只改这里。

export const PURPOSES = [
  {
    id: "ready-apps",
    num: 1,
    installIds: ["speed-dial", "ai-manager"],
  },
  {
    id: "ai-dev",
    num: 2,
    installIds: ["conjure", "ai-manager"],
    requiresKey: true,
  },
  {
    id: "social",
    num: 3,
    installIds: [],
    disabled: true, // 社交中心暂未开放，选项恒置灰
  },
];

/**
 * 按用途 id 取待安装的官方应用 id 列表（副本）。
 * @param {string} purposeId
 * @returns {string[]}
 */
export function getAppIdsForPurpose(purposeId) {
  const purpose = PURPOSES.find((p) => p.id === purposeId);
  return purpose ? [...purpose.installIds] : [];
}

/**
 * 判断某个用途在当前条件下是否可选。
 * @param {string} purposeId
 * @param {boolean} keyReady 是否已有可用的 AI Key
 * @returns {boolean}
 */
export function isPurposeEnabled(purposeId, keyReady) {
  const purpose = PURPOSES.find((p) => p.id === purposeId);
  if (!purpose) return false;
  if (purpose.disabled) return false;
  if (purpose.requiresKey && !keyReady) return false;
  return true;
}

/**
 * 判断已保存的 AI Key 列表中是否存在可用（未禁用）的 Key。
 * @param {Array<{disabled?: boolean}>} apiKeys /mz/ai/main.js getApiKeys() 的快照
 * @returns {boolean}
 */
export function hasUsableKey(apiKeys) {
  return (apiKeys || []).some((key) => !key.disabled);
}
