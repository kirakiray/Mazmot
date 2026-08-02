// chat-app 持久化封装（基于 ever-cache）
// 存储：
//   1) contacts：联系人列表（仅 host 端有意义，customer 端也可用）
//        key = "contacts"  value = [{ peerUserId, displayName, lastMessage, lastMessageAt, unread }]
//   2) messages:<peerUserId>：每个会话的消息记录数组
//        key = "messages:" + peerUserId  value = [{ id, role:"self"|"peer", text, timestamp }]
//
// ever-cache 默认实例 storage 是全局共享命名空间 "public"，
// 为避免与其他应用冲突，统一加 "chat-app:" 前缀。

const PREFIX = "chat-app:";
const CONTACTS_KEY = PREFIX + "contacts";
const msgKey = (peerUserId) => PREFIX + "messages:" + peerUserId;

let _storage = null;

function log(...args) {
  console.log("%c[chat-app storage]", "color:#386a20;font-weight:600;", ...args);
}

/**
 * 初始化存储（加载 ever-cache 默认实例）。
 * 必须在使用其他 storage 函数前调用一次。
 */
export async function initStorage() {
  if (_storage) return _storage;
  log("initStorage: 加载 ever-cache ...");
  const mod = await import(
    "/gh/kirakiray/ever-cache/src/main.min.js"
  );
  _storage = mod.storage;
  log("initStorage: ✓ 已就绪");
  return _storage;
}

function storage() {
  if (!_storage) {
    throw new Error("storage 尚未初始化，请先调用 initStorage()");
  }
  return _storage;
}

// ===== 写操作串行队列（解决读-改-写竞态，确保后写不覆盖先写）=====
let _writeChain = Promise.resolve();
function serialize(task) {
  const next = _writeChain.then(task, task);
  // 即使 task 抛错，链也要继续；错误由调用方处理
  _writeChain = next.catch(() => {});
  return next;
}

// ===== 联系人 =====

/**
 * 读取全部联系人。
 * @returns {Promise<Array>} [{ peerUserId, displayName, lastMessage, lastMessageAt, unread }]
 */
export async function getContacts() {
  await initStorage();
  const list = (await storage().getItem(CONTACTS_KEY)) || [];
  log("getContacts:", list.length, "条");
  return list;
}

/**
 * 保存全部联系人（覆盖写）。
 */
export async function saveContacts(list) {
  await initStorage();
  await storage().setItem(CONTACTS_KEY, list || []);
  log("saveContacts:", (list || []).length, "条");
}

/**
 * 更新或新增一个联系人（按 peerUserId 去重合并）。
 * @param {object} patch 至少包含 peerUserId；其余字段（displayName/lastMessage/lastMessageAt/unread）可选
 */
export async function upsertContact(patch) {
  if (!patch || !patch.peerUserId) throw new Error("upsertContact: 缺少 peerUserId");
  return serialize(async () => {
    const list = (await storage().getItem(CONTACTS_KEY)) || [];
    const idx = list.findIndex((c) => c.peerUserId === patch.peerUserId);
    let next;
    if (idx >= 0) {
      next = Object.assign({}, list[idx], patch);
      list.splice(idx, 1, next);
    } else {
      next = Object.assign(
        { peerUserId: patch.peerUserId, displayName: "", lastMessage: "", lastMessageAt: 0, unread: 0 },
        patch,
      );
      list.push(next);
    }
    await storage().setItem(CONTACTS_KEY, list);
    log("upsertContact:", next);
    return next;
  });
}

/**
 * 清零某个联系人的未读数。
 */
export async function clearUnread(peerUserId) {
  return serialize(async () => {
    const list = (await storage().getItem(CONTACTS_KEY)) || [];
    const idx = list.findIndex((c) => c.peerUserId === peerUserId);
    if (idx >= 0 && list[idx].unread) {
      list[idx].unread = 0;
      await storage().setItem(CONTACTS_KEY, list);
      log("clearUnread:", peerUserId);
    }
  });
}

/**
 * 删除联系人（同时删除消息记录）。
 */
export async function removeContact(peerUserId) {
  return serialize(async () => {
    const list = (await storage().getItem(CONTACTS_KEY)) || [];
    const next = list.filter((c) => c.peerUserId !== peerUserId);
    await storage().setItem(CONTACTS_KEY, next);
    await storage().removeItem(msgKey(peerUserId));
    log("removeContact:", peerUserId);
  });
}

// ===== 消息记录 =====

/**
 * 读取某个会话的全部消息。
 * @param {string} peerUserId
 * @returns {Promise<Array>} [{ id, role:"self"|"peer", text, timestamp }]
 */
export async function getMessages(peerUserId) {
  await initStorage();
  const list = (await storage().getItem(msgKey(peerUserId))) || [];
  log("getMessages:", peerUserId, "->", list.length, "条");
  return list;
}

/**
 * 追加一条消息到某个会话。
 * @param {string} peerUserId
 * @param {{role:"self"|"peer", text:string, timestamp?:number}} msg
 * @returns {Promise<object>} 写入后的消息对象（含自动生成的 id / timestamp）
 */
export async function addMessage(peerUserId, msg) {
  return serialize(async () => {
    const list = (await storage().getItem(msgKey(peerUserId))) || [];
    const record = Object.assign(
      { id: "m-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) },
      msg,
      { timestamp: msg.timestamp || Date.now() },
    );
    list.push(record);
    await storage().setItem(msgKey(peerUserId), list);
    log("addMessage:", peerUserId, "->", record);
    return record;
  });
}

/**
 * 清空某个会话的消息记录（保留联系人条目）。
 */
export async function clearMessages(peerUserId) {
  await initStorage();
  await storage().setItem(msgKey(peerUserId), []);
  log("clearMessages:", peerUserId);
}
