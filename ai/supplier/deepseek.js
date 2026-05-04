import { Assistant } from "./assistant.js";

const BASE_URL = "https://api.deepseek.com";

export class DeepseekAssistant extends Assistant {
  id;
  constructor(id, apiKey) {
    super(id, apiKey);
  }

  async chat({
    message,
    thinking = false,
    model = "deepseek-v4-flash",
    reasoningEffort = "high",
    stream = false,
    messages = null,
    systemPrompt = "You are a helpful assistant.",
    onStream = null,
  }) {
    const requestBody = {
      model,
      stream,
      messages: messages || [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      thinking: { type: thinking ? "enabled" : "disabled" },
    };

    if (thinking) {
      requestBody.reasoning_effort = reasoningEffort;
    }

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText} - ${JSON.stringify(error)}`,
      );
    }

    if (stream) {
      return this.handleStreamResponse(response, onStream);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      reasoningContent: data.choices[0].message.reasoning_content,
      model: data.model,
      usage: data.usage,
      raw: data,
    };
  }

  async handleStreamResponse(response, onStream = null) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = {
      content: "",
      reasoningContent: "",
      model: "",
      usage: null,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta;

            if (delta?.content) {
              result.content += delta.content;
            }
            if (delta?.reasoning_content) {
              result.reasoningContent += delta.reasoning_content;
            }
            if (parsed.model) {
              result.model = parsed.model;
            }
            if (parsed.usage) {
              result.usage = parsed.usage;
            }

            if (onStream && typeof onStream === "function") {
              onStream({
                content: result.content,
                reasoningContent: result.reasoningContent,
                delta: delta?.content || "",
                deltaReasoning: delta?.reasoning_content || "",
                model: result.model,
                usage: result.usage,
                done: false,
              });
            }
          } catch (e) {
            console.warn("Failed to parse streaming chunk:", e);
          }
        }
      }
    }

    if (onStream && typeof onStream === "function") {
      onStream({
        content: result.content,
        reasoningContent: result.reasoningContent,
        delta: "",
        deltaReasoning: "",
        model: result.model,
        usage: result.usage,
        done: true,
      });
    }

    return result;
  }

  async getModels() {
    const response = await fetch(`${BASE_URL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText} - ${JSON.stringify(error)}`,
      );
    }

    const data = await response.json();
    return data.data || data;
  }

  async getRemaining() {
    const response = await fetch(`${BASE_URL}/user/balance`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText} - ${JSON.stringify(error)}`,
      );
    }

    const data = await response.json();
    return {
      isAvailable: data.is_available,
      balanceInfos: data.balance_infos?.map((info) => ({
        currency: info.currency,
        totalBalance: info.total_balance,
        grantedBalance: info.granted_balance,
        toppedUpBalance: info.topped_up_balance,
      })),
      raw: data,
    };
  }
}

export default DeepseekAssistant;
