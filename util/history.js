import { init, get } from "/nos/fs/main.js";

const APP_NAME = "mazmot";
const HISTORY_DIR = "chat-history";

let historyDir = null;

async function ensureHistoryDir() {
  if (!historyDir) {
    await init(APP_NAME);
    historyDir = await get(`${APP_NAME}/${HISTORY_DIR}`, { create: "dir" });
  }
  return historyDir;
}

export async function saveHistory(sessionId, messages) {
  const dir = await ensureHistoryDir();
  const fileName = `${sessionId}.json`;
  const file = await dir.get(fileName, { create: "file" });
  
  const historyData = {
    sessionId,
    messages,
    updatedAt: new Date().toISOString(),
    messageCount: messages.length
  };
  
  await file.write(JSON.stringify(historyData, null, 2));
  return sessionId;
}

export async function loadHistory(sessionId) {
  const dir = await ensureHistoryDir();
  const fileName = `${sessionId}.json`;
  
  try {
    const file = await dir.get(fileName);
    const content = await file.text();
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

export async function deleteHistory(sessionId) {
  const dir = await ensureHistoryDir();
  const fileName = `${sessionId}.json`;
  
  try {
    const file = await dir.get(fileName);
    await file.remove();
    return true;
  } catch (e) {
    return false;
  }
}

export async function listHistories() {
  const dir = await ensureHistoryDir();
  const histories = [];
  
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file" && name.endsWith(".json")) {
      try {
        const content = await handle.text();
        const data = JSON.parse(content);
        histories.push({
          sessionId: data.sessionId,
          updatedAt: data.updatedAt,
          messageCount: data.messageCount
        });
      } catch (e) {
        console.error(`Failed to parse history file ${name}:`, e);
      }
    }
  }
  
  return histories.sort((a, b) => 
    new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

export async function clearAllHistories() {
  const dir = await ensureHistoryDir();
  await dir.remove();
  historyDir = null;
  await ensureHistoryDir();
  return true;
}

export function generateSessionId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `session-${timestamp}-${random}`;
}
