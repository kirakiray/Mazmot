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
