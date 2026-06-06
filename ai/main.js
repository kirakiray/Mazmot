import { storage } from "/gh/kirakiray/ever-cache/src/main.js";
import DeepseekAssistant from "./supplier/deepseek.js";
import KimiAssistant from "./supplier/kimi.js";

export const apiKeys = $.stanz([]);

await (async () => {
  const savedData = await storage.apiKeys;
  if (savedData && Array.isArray(savedData)) {
    apiKeys.push(...savedData);
  }
})();

apiKeys.watchTick(() => {
  const data = apiKeys.toJSON();
  storage.apiKeys = data;
});

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

  apiKeys.push({
    id,
    concurrent: 4,
    provider,
    apiKey,
    maskedKey: `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
    createdAt: createdAt.toISOString(),
    formattedDate: createdAt.toLocaleString(),
  });

  return getAssistant(id);
};

export const getAssistant = async (id) => {
  let item;

  if (!id) {
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
    case "kimi":
      return new KimiAssistant(item.id, item.apiKey);
    default:
      throw new Error("provider not supported");
  }
};
