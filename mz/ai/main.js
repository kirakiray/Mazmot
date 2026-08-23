import DeepseekAssistant from "./supplier/deepseek.js";
import KimiAssistant from "./supplier/kimi.js";

// /nos/storage 由 NoneOS Core Service Worker 提供，可能尚未就绪（如无 SW 的测试环境）。
// 动态导入 + 失败降级为仅内存模式，保证模块本身在任何环境都能被加载。
let storage = null;

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
  if (!storage) return; // 仅内存模式（nos storage 未就绪）
  storage.setItem("apiKeys", _snapshot()).catch((err) => {
    console.error("Failed to persist apiKeys:", err);
  });
};

/**
 * 按 provider 创建对应的 Assistant 实例（统一三处 switch 路由）。
 */
const _createAssistant = (provider, id, apiKey) => {
  switch (provider) {
    case "deepseek":
      return new DeepseekAssistant(id, apiKey);
    case "kimi":
      return new KimiAssistant(id, apiKey);
    default:
      throw new Error(`provider not supported: ${provider}`);
  }
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

// 初始化：从 storage 加载已保存的 key（storage 不可用时保持空列表）
await (async () => {
  try {
    ({ storage } = await import("/nos/storage/main.js"));
    const savedData = await storage.getItem("apiKeys");
    if (savedData && Array.isArray(savedData)) {
      _apiKeys.push(...savedData);
    }
  } catch (err) {
    console.warn("nos storage unavailable, apiKeys 仅内存模式:", err?.message ?? err);
  }
})();

/**
 * 验证 API Key 是否有效（不写入列表，仅调用 getModels 探测）。
 * 不会抛异常，所有错误（含不支持的 provider）都通过 { valid: false, message } 返回。
 */
export const testApiKey = async (apiKey, provider) => {
  try {
    const assistant = _createAssistant(provider, null, apiKey);
    await assistant.getModels();
    return { valid: true, message: "API Key 验证成功" };
  } catch (error) {
    return { valid: false, message: error.message };
  }
};

/**
 * 保存 API Key，返回新保存的 key 对象（含 id，可用于 removeKey / getAssistant）。
 * 写入后自动持久化到本地存储（nos storage），并通知所有 onApiKeysChange 订阅者。
 */
export const saveKey = (apiKey, provider) => {
  const id = Math.random().toString(36).slice(2);
  const createdAt = new Date();

  const keyObj = {
    id,
    provider,
    apiKey,
    maskedKey: `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
    createdAt: createdAt.toISOString(),
    formattedDate: createdAt.toLocaleString(),
  };

  _apiKeys.push(keyObj);
  _persist();
  _emit();

  return { ...keyObj };
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

/**
 * 根据 id 获取 Assistant 实例。不传 id 时随机选一个（多 key 负载均衡）。
 * 同步函数（无 IO），调用方可省略 await。
 */
export const getAssistant = (id) => {
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

  return _createAssistant(item.provider, item.id, item.apiKey);
};
