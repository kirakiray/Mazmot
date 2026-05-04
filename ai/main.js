import { storage } from "/gh/kirakiray/ever-cache/src/main.js";
import DeepseekAssistant from "./supplier/deepseek.js";

// 保存所有api key的数据
export const apiKeys = $.stanz([]);

// 数据发生改动后，更新storage
apiKeys.watchTick(() => {
  const data = apiKeys.toJSON();
  storage.apiKeys = data;
});

/**
 * 保存key
 * @param {*} apiKey api key
 * @param {*} provider 供应商
 */
export const saveKey = async (apiKey, provider) => {
  const id = Math.random().toString(36).slice(2);

  apiKeys.push({
    id,
    concurrent: 4,
    provider,
    apiKey,
    createdAt: new Date().toISOString(),
  });

  return getAssistant(id);
};

/**
 * 获取 assistant
 * 如果不提供id，则随机获取助手
 * @param {*} id key id
 * @returns {Promise} 返回 assistant
 */
export const getAssistant = async (id) => {
  let item;

  if (!id) {
    // 从apiKeys中随机获取一个key
    item = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  } else {
    item = apiKeys.find((item) => item.id === id);
    if (!item) {
      throw new Error("key not found");
    }
  }

  switch (item.provider) {
    case "deepseek":
      return new DeepseekAssistant(item.id, item.apiKey);
    default:
      throw new Error("provider not supported");
  }
};
