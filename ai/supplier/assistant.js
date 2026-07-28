export class Assistant {
  /**
   * 子类必须覆盖以下字段：
   *  - BASE_URL：API 基础地址
   *  - providerName：错误信息前缀（如 "DeepSeek API error"）
   */
  // id 用于标识 key 来源；testApiKey 等无 key 场景可传 null
  constructor(id, apiKey) {
    this.id = id;
    this.apiKey = apiKey;
  }

  /**
   * 统一的流式响应处理逻辑，子类无需重写。
   * 同时修复了原始实现的 buffer 残尾丢失问题（最后一个不以 \n 结尾的 chunk 会丢失）。
   */
  async handleStreamResponse(response, onStream = null) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = {
      content: "",
      reasoningContent: "",
      model: "",
      usage: null,
    };

    const processBuffer = (isFinal = false) => {
      // 非最终轮：只处理到最后一个完整换行为止；最终轮：全部处理掉
      let completeChunk;
      if (isFinal) {
        completeChunk = buffer;
        buffer = "";
      } else {
        const newlineIndex = buffer.lastIndexOf("\n");
        if (newlineIndex === -1) return;
        completeChunk = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
      }

      const lines = completeChunk.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
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
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      processBuffer(false);
    }

    // flush 最后一行（防止服务器结尾不带 \n 导致丢数据）
    processBuffer(true);

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

  /**
   * 统一的错误响应构造方法。
   */
  async _buildError(response) {
    const error = await response.json().catch(() => ({}));
    return new Error(
      `${this.providerName} API error: ${response.status} ${response.statusText} - ${JSON.stringify(error)}`,
    );
  }
}
