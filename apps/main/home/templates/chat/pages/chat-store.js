import { EverCache } from "https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js";
import { getUser } from "/nos/user/main.js";

const chatStorage = new EverCache("mazmot-chat");
const contactsKey = (ownerId) => `contacts:${ownerId}`;
const messagesKey = (ownerId, peerId) => `messages:${ownerId}:${peerId}`;

// 响应式共享状态：layout / chat 页面都从这里读取。
export const chatStore = $.stanz({
  userId: "",
  contacts: [],
  activeUserId: "",
  statusText: "",
});

// 非响应式的内部状态：不放进 stanz，避免响应式代理复杂对象引起循环。
let _user = null;
let _chatService = null;
const _remoteUsers = {};
const _saveMsgTimers = {};
let _initPromise = null;

export function getContact(userId) {
  return chatStore.contacts.find((c) => c.userId === userId);
}

export function getMessages(userId) {
  const c = getContact(userId);
  return c ? c.messages : null;
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

export function markRead(userId) {
  const c = getContact(userId);
  if (c && c.unread) {
    c.unread = 0;
    persistContacts();
  }
}

async function persistContacts() {
  if (!chatStore.userId) return;
  const snapshot = chatStore.contacts.map((c) => ({
    userId: c.userId,
    unread: c.unread || 0,
  }));
  try {
    await chatStorage.setItem(contactsKey(chatStore.userId), snapshot);
  } catch (err) {
    console.warn("persist contacts failed:", err);
  }
}

function persistMessages(peerId) {
  if (!chatStore.userId || !peerId) return;
  // 简单去抖，避免连发消息时频繁写入
  clearTimeout(_saveMsgTimers[peerId]);
  _saveMsgTimers[peerId] = setTimeout(async () => {
    const c = getContact(peerId);
    if (!c) return;
    const snapshot = c.messages.map((m) => ({
      text: m.text,
      time: m.time,
      from: m.from,
    }));
    try {
      await chatStorage.setItem(messagesKey(chatStore.userId, peerId), snapshot);
    } catch (err) {
      console.warn("persist messages failed:", err);
    }
  }, 200);
}

async function restoreFromStorage() {
  if (!chatStore.userId) return;
  let stored = [];
  try {
    stored = (await chatStorage.getItem(contactsKey(chatStore.userId))) || [];
  } catch (err) {
    console.warn("restore contacts failed:", err);
    return;
  }
  for (const item of stored) {
    if (!item || !item.userId) continue;
    let messages = [];
    try {
      messages =
        (await chatStorage.getItem(messagesKey(chatStore.userId, item.userId))) ||
        [];
    } catch (err) {
      console.warn("restore messages failed:", err);
    }
    chatStore.contacts.push({
      userId: item.userId,
      messages,
      unread: item.unread || 0,
      connected: false,
    });
  }
}

export async function ensureContact(userId) {
  let c = getContact(userId);
  let isNew = false;
  if (!c) {
    chatStore.contacts.push({
      userId,
      messages: [],
      unread: 0,
      connected: false,
    });
    c = getContact(userId);
    isNew = true;
  }
  if (!_remoteUsers[userId]) {
    _remoteUsers[userId] = await _user.connectUser(userId);
  }
  c.connected = true;
  if (isNew) persistContacts();
  return c;
}

export async function connectContact(userId) {
  if (!userId || userId === chatStore.userId || !_user) return;
  if (_remoteUsers[userId]) {
    const c = getContact(userId);
    if (c) c.connected = true;
    return;
  }
  const c = getContact(userId);
  try {
    const online = await _user.isRemoteUserOnline(userId);
    if (!online) {
      if (c) c.connected = false;
      return;
    }
    _remoteUsers[userId] = await _user.connectUser(userId);
    if (c) c.connected = true;
  } catch (err) {
    if (c) c.connected = false;
    throw err;
  }
}

export async function sendMessage(userId, text) {
  if (!userId || !text) return false;
  const remoteUser = _remoteUsers[userId];
  if (!remoteUser) return false;
  const msg = { type: "chat", text, time: Date.now() };
  try {
    await remoteUser.sendToService("mazmot-chat-v1", msg);
    const c = getContact(userId);
    if (c) {
      c.messages.push({ ...msg, from: "me" });
      persistMessages(userId);
    }
    return true;
  } catch (err) {
    chatStore.statusText = "Send failed: " + (err.message || err);
    return false;
  }
}

async function onServiceMessage(data, ctx) {
  const fromUserId = ctx && ctx.fromUserId;
  if (!fromUserId || fromUserId === chatStore.userId) return;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return;
    }
  }
  if (!data || data.type !== "chat" || !data.text) return;

  const c = await ensureContact(fromUserId);
  c.messages.push({
    text: data.text,
    time: data.time || Date.now(),
    from: "other",
  });
  persistMessages(fromUserId);
  if (chatStore.activeUserId !== fromUserId) {
    c.unread = (c.unread || 0) + 1;
    persistContacts();
  }
}

async function onRemoteConnected(e) {
  const userId = e.detail.userId;
  if (!userId || userId === chatStore.userId) return;
  await ensureContact(userId);
}

function onRemoteDisconnected(e) {
  const userId = e.detail && e.detail.userId;
  if (!userId) return;
  delete _remoteUsers[userId];
  const c = getContact(userId);
  if (c) c.connected = false;
  if (userId === chatStore.activeUserId) {
    chatStore.statusText = "Disconnected.";
  }
}

export function initChat() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    _user = await getUser("default");
    await _user.ready();
    chatStore.userId = _user.userId;
    await restoreFromStorage();
    _chatService = _user.registerService("mazmot-chat-v1", {
      onMessage: (data, ctx) => onServiceMessage(data, ctx),
    });
    _user.bind("remote_user_connected", (e) => onRemoteConnected(e));
    _user.bind("remote_user_disconnected", (e) => onRemoteDisconnected(e));
  })();
  return _initPromise;
}

export async function checkOnlineUser(target) {
  if (!_user) throw new Error("chat not initialized");
  return await _user.isRemoteUserOnline(target);
}

export async function clearAll() {
  await chatStorage.clear();
  for (const key of Object.keys(_saveMsgTimers)) {
    clearTimeout(_saveMsgTimers[key]);
    delete _saveMsgTimers[key];
  }
  chatStore.contacts.splice(0, chatStore.contacts.length);
  chatStore.activeUserId = "";
  chatStore.statusText = "";
}
