// // 调用deepseek api 聊天
// export const chat = ({ message, apiKey }) => {};

// // 获取可用的模型
// export const getModels = (apiKey) => {};

// // 查询剩余调用次数和过期时间
// export const getRemaining = (apiKey) => {};

import { Assistant } from "./assistant.js";

export class DeepseekAssistant extends Assistant {
  id;
  constructor(id, apiKey) {
    super(id, apiKey);
  }

  /**
   * 调用deepseek api 聊天
   * @param {*} message 消息
   * @param {*} think 是否思考思考过程
   * @returns {Promise} 返回聊天结果
   */
  async chat({ message, think = false }) {
    return await this.api.chat({ message, apiKey: this.apiKey });
  }

  /**
   * 获取可用的模型
   * @returns {Promise} 返回模型列表
   */
  async getModels() {
    return await this.api.getModels({ apiKey: this.apiKey });
  }

  /**
   * 查询剩余调用次数和过期时间
   * @returns {Promise} 返回剩余调用次数和过期时间
   */
  async getRemaining() {
    return await this.api.getRemaining({ apiKey: this.apiKey });
  }
}

export default DeepseekAssistant;
