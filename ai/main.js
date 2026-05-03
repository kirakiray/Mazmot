import { storage } from "/gh/kirakiray/ever-cache/src/main.js";

/**
 * 保存key
 * @param {*} apiKey api key
 * @param {*} provider 供应商
 */
export const saveKey = async (apiKey, provider) => {
    const keys = (await storage.apiKeys) || [];
    keys.push({ provider, apiKey });
    storage.apiKeys = keys;
};

/**
 * 获取所有保存的keys
 * @returns {Array} 返回所有供应商的api key数组
 */
export const getAllKeys = async () => {
    return (await storage.apiKeys) || [];
};
