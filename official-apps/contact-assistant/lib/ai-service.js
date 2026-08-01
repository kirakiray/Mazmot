import {
  getSpace,
  getMessages,
  addMessage,
  updateContact,
} from "./storage.js";

function buildSystemPrompt(initText) {
  return `你是主人的联络助手。请基于主人提供的资料回答来访者的问题，语气礼貌、简洁，并在合适的时候询问对方的称呼和联系方式，以便主人后续跟进。如果问题超出资料范围，可以礼貌地说明并尝试引导对方留下具体需求。

主人资料：
${initText || "（未提供详细资料）"}`;
}

function formatHistory(messages) {
  return messages
    .filter((m) => m.role === "visitor" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "visitor" ? "user" : "assistant",
      content: m.content || "",
    }));
}

/**
 * 为指定访客生成 AI 回复。
 * @param {Function} getAssistant - /ai/main.js 的 getAssistant
 * @param {string} spaceId
 * @param {string} visitorId
 * @returns {Promise<string|null>} 生成的回复内容
 */
export async function generateReply(getAssistant, spaceId, visitorId) {
  if (typeof getAssistant !== "function") {
    throw new Error("缺少 getAssistant");
  }
  const space = await getSpace(spaceId);
  if (!space) {
    throw new Error("空间不存在");
  }

  const messages = await getMessages(spaceId, visitorId);
  const history = formatHistory(messages);
  const assistant = getAssistant();
  const { content } = await assistant.chat({
    model: assistant.providerName === "kimi" ? "kimi-k3" : "deepseek-v4-flash",
    messages: [
      { role: "system", content: buildSystemPrompt(space.initText) },
      ...history,
    ],
  });

  return content || null;
}

/**
 * Host 收到访客消息后，生成回复并本地保存。
 * @param {Function} getAssistant
 * @param {string} spaceId
 * @param {string} visitorId
 * @returns {Promise<string|null>}
 */
export async function replyAndSave(getAssistant, spaceId, visitorId) {
  const content = await generateReply(getAssistant, spaceId, visitorId);
  if (!content) return null;

  const now = Date.now();
  await addMessage(spaceId, visitorId, {
    id: `a-${now}`,
    role: "assistant",
    content,
    timestamp: now,
  });
  await updateContact(spaceId, {
    visitorId,
    lastMessageAt: now,
  });

  return content;
}

/**
 * 总结与指定访客的对话。
 * @param {Function} getAssistant
 * @param {string} spaceId
 * @param {string} visitorId
 * @returns {Promise<string>}
 */
export async function summarize(getAssistant, spaceId, visitorId) {
  if (typeof getAssistant !== "function") {
    throw new Error("缺少 getAssistant");
  }
  const messages = await getMessages(spaceId, visitorId);
  const history = formatHistory(messages);

  if (history.length === 0) {
    return "暂无对话记录。";
  }

  const conversation = history
    .map((m) => `${m.role === "user" ? "来访者" : "助手"}：${m.content}`)
    .join("\n\n");

  const assistant = getAssistant();
  const { content } = await assistant.chat({
    model: assistant.providerName === "kimi" ? "kimi-k3" : "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content:
          "你是主人的联络助手。请用简洁的中文总结以下对话，提取来访者身份、来意、关键问题与后续需要跟进的事项。",
      },
      {
        role: "user",
        content: `请总结这段对话：\n\n${conversation}`,
      },
    ],
  });

  const summary = content || "总结失败";
  await updateContact(spaceId, { visitorId, summary });
  return summary;
}
