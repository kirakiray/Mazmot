import { storage } from "/gh/kirakiray/ever-cache/src/main.js";
import DeepseekAssistant from "./supplier/deepseek.js";
import KimiAssistant from "./supplier/kimi.js";

export const models = $.stanz([]);

await (async () => {
  const savedData = await storage.models;
  if (savedData && Array.isArray(savedData)) {
    models.push(...savedData);
  }
})();

models.watchTick(() => {
  const data = models.toJSON();
  storage.models = data;
});

export const saveKey = async (apiKey, provider) => {
  const id = Math.random().toString(36).slice(2);
  const createdAt = new Date();

  models.push({
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
    item = models[Math.floor(Math.random() * models.length)];
  } else {
    item = models.find((item) => item.id === id);
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
