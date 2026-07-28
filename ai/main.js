import { storage } from "/gh/kirakiray/ever-cache/src/main.min.js";
import DeepseekAssistant from "./supplier/deepseek.js";
import KimiAssistant from "./supplier/kimi.js";

// 内部私有数组，不再依赖 stanz；外部通过 getApiKeys / onApiKeysChange 访问
const _apiKeys = [];
const _listeners = new Set();

const _snapshot = () => _apiKeys.map((item) => ({ ...item }));

const _emit = () => {
  const snap = _snapshot();
  _listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.error("apiKeys listener error:", e);
    }
  });
};

const _persist = () => {
  storage.setItem("apiKeys", _snapshot()).catch((err) => {
    console.error("Failed to persist apiKeys:", err);
  });
};

/**
 * 订阅 apiKeys 变化，回调收到只读快照数组。
 * @param {(keys: Array) => void} callback
 * @returns {() => void} 取消订阅函数
 */
export const onApiKeysChange = (callback) => {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
};

/**
 * 返回当前 apiKeys 的快照（浅拷贝，安全可读）。
 * @returns {Array}
 */
export const getApiKeys = () => _snapshot();

// 初始化：从 storage 加载已保存的 key
await (async () => {
  const savedData = await storage.apiKeys;
  if (savedData && Array.isArray(savedData)) {
    _apiKeys.push(...savedData);
  }
})();

export const testApiKey = async (apiKey, provider) => {
  let assistant;

  switch (provider) {
    case "deepseek":
      assistant = new DeepseekAssistant("test", apiKey);
      break;
    case "kimi":
      assistant = new KimiAssistant("test", apiKey);
      break;
    default:
      throw new Error("provider not supported");
  }

  try {
    // 尝试获取模型列表来验证 API key 是否有效
    await assistant.getModels();
    return { valid: true, message: "API Key 验证成功" };
  } catch (error) {
    return { valid: false, message: error.message };
  }
};

export const saveKey = async (apiKey, provider) => {
  const id = Math.random().toString(36).slice(2);
  const createdAt = new Date();

  _apiKeys.push({
    id,
    provider,
    apiKey,
    maskedKey: `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
    createdAt: createdAt.toISOString(),
    formattedDate: createdAt.toLocaleString(),
  });

  _persist();
  _emit();

  return getAssistant(id);
};

/**
 * 按 id 删除一条 api key。
 * @param {string} id
 * @returns {boolean} 是否删除成功
 */
export const removeKey = (id) => {
  const index = _apiKeys.findIndex((item) => item.id === id);
  if (index === -1) return false;
  _apiKeys.splice(index, 1);
  _persist();
  _emit();
  return true;
};

export const getAssistant = async (id) => {
  if (_apiKeys.length === 0) {
    throw new Error("no api key available");
  }

  let item;

  if (!id) {
    item = _apiKeys[Math.floor(Math.random() * _apiKeys.length)];
  } else {
    item = _apiKeys.find((item) => item.id === id);
    if (!item) {
      throw new Error("key not found");
    }
  }

  switch (item.provider) {
    case "deepseek":
      return new DeepseekAssistant(item.id, item.apiKey);
    case "kimi":
      return new KimiAssistant(item.id, item.apiKey);
    default:
      throw new Error("provider not supported");
  }
};
