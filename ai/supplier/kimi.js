import { Assistant } from "./assistant.js";

export class KimiAssistant extends Assistant {
  id;
  constructor(id, apiKey) {
    super(id, apiKey);
  }

  async chat({ message, think = false }) {
    return await this.api.chat({ message, apiKey: this.apiKey });
  }

  async getModels() {
    return await this.api.getModels({ apiKey: this.apiKey });
  }

  async getRemaining() {
    return await this.api.getRemaining({ apiKey: this.apiKey });
  }
}

export default KimiAssistant;
