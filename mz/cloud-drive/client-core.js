// mz/cloud-drive/client-core —— 云盘客户端核心逻辑
//
// 职责：连接服务器（NoneOS userId）、登录、目录浏览、可靠分块上传 / 下载，
// 以及基于本地 fs 暂存的大文件断点续传（刷新后可继续或取消）。
// /nos/* 全部按需动态加载，顶层不 import。
//
// 本地持久化（getStorage("cloud-drive-client")）：
//   - last-server: 上次连接的服务器 userId
//   - transfers: 断点续传记录数组
//     { key, dir: "up"|"down", serverUserId, spaceId, name, size, chunkTotal,
//       clientUploadId?, fileId?, parentId?, tempPath, received: number[], createdAt }
//   fs(init("cloud-drive-client"))
//     - transfers/<key>/<index>  上传暂存的源文件分块 / 下载已拉取的分块

import { ReliableChannel } from "./reliable.js";
import {
  APP_SERVICE_ID,
  CHUNK_SIZE,
  MSG,
  RESUME_MIN_SIZE,
  USER_NAMESPACE,
  base64ToBytes,
  bytesToBase64,
  newId,
} from "./protocol.js";

const RPC_TIMEOUT = 60 * 1000; // 单条指令从发出到收到应答的总超时

let _shared = null;
/**
 * 页面间共享的客户端实例（同页面应用内跨路由复用连接与登录态）。
 * @param {(event: object) => void} [onEvent] 仅首次创建时生效
 */
export function getSharedClient(onEvent) {
  if (!_shared) _shared = new CloudDriveClient(onEvent);
  return _shared;
}

export class CloudDriveClient {
  /** @param {(event: { type: string, [k: string]: any }) => void} [onEvent] */
  constructor(onEvent) {
    this._onEvent = onEvent || (() => {});
    this._user = null;
    this._remote = null; // RemoteUser（服务器）
    this._channel = null;
    this._pending = new Map(); // reqId -> { resolve, reject, timer }
    this.serverUserId = null;
    this.token = null;
    this.username = null;
    this.mySpaces = [];
    this._storage = null;
    this._fsRoot = null;
    this._inited = false;
  }

  get connected() {
    return !!this._remote;
  }

  get loggedIn() {
    return !!this.token;
  }

  async _ensureLocal() {
    if (this._inited) return;
    const { getStorage } = await import("/nos/storage/main.js");
    const fsMod = await import("/nos/fs/main.js");
    this._storage = getStorage("cloud-drive-client");
    this._fsRoot = await fsMod.init("cloud-drive-client");
    this._inited = true;
  }

  /** 获取本端 userId（供展示 / 服务器加账号用） */
  async getMyUserId() {
    await this._ensureUser();
    return this._user.userId;
  }

  async _ensureUser() {
    if (this._user) return this._user;
    const userMod = await import("/nos/user/main.js");
    this._user = await userMod.getUser(USER_NAMESPACE);
    return this._user;
  }

  /** 读取上次连接的服务器 userId */
  async getLastServer() {
    await this._ensureLocal();
    return this._storage.getItem("last-server");
  }

  /**
   * 连接服务器并握手
   * @returns {Promise<{userId: string}>} 服务器 userId
   */
  async connect(serverUserId) {
    await this._ensureLocal();
    await this._ensureUser();
    this.disconnect();
    const remote = await this._user.connectUser(serverUserId);
    this._remote = remote;
    this.serverUserId = serverUserId;
    this.token = null;
    this.mySpaces = [];

    this._channel = new ReliableChannel({
      channelId: `client->${String(serverUserId).slice(0, 8)}`,
      send: async (envelope) => {
        const results = await this._remote.sendToService(
          APP_SERVICE_ID,
          envelope
        );
        return results.some((r) => r.status === "ok");
      },
      onData: (payload) => this._onResponse(payload),
    });

    // 注册本端服务：服务器的应答（含 ACK）经 sendToService 投递回来
    this._service = this._user.registerService(APP_SERVICE_ID, {
      onMessage: (data) => {
        if (data && data.msgId) this._channel.handle(data);
      },
    });

    // ping 握手：服务器后台节流 / 服务发现 / RTC 建链存在偶发竞态，
    // 单发超时会造成「概率连不上」，这里重试 3 次
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        await this._rpc(MSG.PING, {}, { timeout: 10 * 1000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (lastErr) {
      this.disconnect();
      throw lastErr;
    }
    await this._storage.setItem("last-server", serverUserId);
    this._onEvent({ type: "connected", serverUserId });
    return { userId: serverUserId };
  }

  disconnect() {
    this._service?.unregister();
    this._service = null;
    this._channel?.destroy();
    this._channel = null;
    this._remote = null;
    this.token = null;
    this.username = null;
    this.mySpaces = [];
  }

  _onResponse(payload) {
    if (!payload || !payload.reqId) return;
    const entry = this._pending.get(payload.reqId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._pending.delete(payload.reqId);
    if (payload.ok) entry.resolve(payload);
    else entry.reject(new Error(payload.error || "服务器返回错误"));
  }

  async _rpc(t, params = {}, { timeout = RPC_TIMEOUT } = {}) {
    if (!this._channel) throw new Error("尚未连接服务器");
    const reqId = newId("rq");
    const payload = { t, reqId, ...params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(reqId);
        reject(new Error(`请求超时: ${t}`));
      }, timeout);
      this._pending.set(reqId, { resolve, reject, timer });
      this._channel.send(payload).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(reqId);
        reject(err);
      });
    });
  }

  // ============ 登录与浏览 ============

  async login({ username, password }) {
    const res = await this._rpc(MSG.LOGIN, { username, password });
    this.token = res.token;
    this.username = res.username;
    // 仅登录后可见：本账号被授权的空间（根目录将以此为文件夹呈现）
    this.mySpaces = res.spaces || [];
    await this._saveSession();
    this._onEvent({ type: "login", username: res.username });
    return { username: res.username, spaces: this.mySpaces };
  }

  /** 编码空间上下文到文件 id（对页面透明）：真实id@spaceId */
  _wrapId(id, spaceId) {
    return `${id}@${spaceId}`;
  }

  _unwrapId(encoded) {
    const i = String(encoded).lastIndexOf("@");
    if (i === -1) throw new Error("无效的文件标识");
    return [encoded.slice(0, i), encoded.slice(i + 1)];
  }

  /** 目录标识解包：space:<id> → 空间根；其余 → [真实id, spaceId] */
  _unwrapDir(dirEncoded) {
    if (String(dirEncoded).startsWith("space:")) {
      return ["root", dirEncoded.slice(6)];
    }
    return this._unwrapId(dirEncoded);
  }

  /**
   * 尝试从本地持久化恢复登录态（刷新后免登录）。
   * 成功返回 true；未保存过会话、token 失效或服务器不可达时返回 false。
   */
  async tryRestoreSession() {
    await this._ensureLocal();
    const s = await this._storage.getItem("session");
    if (!s?.token) return false;
    try {
      await this.connect(s.serverUserId);
    } catch {
      return false;
    }
    this.token = s.token;
    this.username = s.username;
    this.mySpaces = s.spaces || [];
    try {
      // resume：校验 token 仍有效，同时让服务器记一条「刷新登录」审计
      await this._rpc(MSG.RESUME, { token: this.token });
      return true;
    } catch {
      this.disconnect();
      return false;
    }
  }

  /** 退出登录：通知服务器注销会话（尽力而为）并清本地状态断开连接 */
  async logout() {
    // 服务器端注销会话并记审计日志；网络异常不阻塞本地登出
    if (this._channel && this.token) {
      try {
        await this._rpc(MSG.LOGOUT, { token: this.token }, { timeout: 5000 });
      } catch {}
    }
    await this._ensureLocal();
    await this._storage.removeItem("session");
    this.disconnect();
  }

  async _saveSession() {
    await this._ensureLocal();
    await this._storage.setItem("session", {
      serverUserId: this.serverUserId,
      token: this.token,
      username: this.username,
      spaces: this.mySpaces,
    });
  }

  async list(parentId = "root") {
    this._assertLogin();
    // 根目录：把授权空间合成为文件夹（未进入具体空间前不暴露内部结构）
    if (parentId === "root") {
      return {
        path: [],
        entries: this.mySpaces.map((s) => ({
          id: `space:${s.id}`,
          name: s.name,
          type: "dir",
          size: 0,
          mtime: 0,
          virtual: true, // 空间文件夹是合成视图，不支持重命名/删除
        })),
      };
    }
    // 空间根：parentId 形如 space:<id>
    if (parentId.startsWith("space:")) {
      const spaceId = parentId.slice(6);
      const space = this.mySpaces.find((s) => s.id === spaceId);
      const res = await this._rpc(MSG.LIST, {
        token: this.token,
        spaceId,
        parentId: "root",
      });
      return {
        path: [{ id: parentId, name: space?.name || "空间" }],
        entries: (res.entries || []).map((e) => ({
          ...e,
          id: this._wrapId(e.id, spaceId),
        })),
      };
    }
    // 空间内子目录：id 编码了空间上下文
    const [realId, spaceId] = this._unwrapId(parentId);
    const space = this.mySpaces.find((s) => s.id === spaceId);
    const res = await this._rpc(MSG.LIST, {
      token: this.token,
      spaceId,
      parentId: realId,
    });
    return {
      path: [
        { id: `space:${spaceId}`, name: space?.name || "空间" },
        ...(res.path || []).map((p) => ({
          id: this._wrapId(p.id, spaceId),
          name: p.name,
        })),
      ],
      entries: (res.entries || []).map((e) => ({
        ...e,
        id: this._wrapId(e.id, spaceId),
      })),
    };
  }

  async mkdir(parentEncoded, name) {
    this._assertLogin();
    const [parentId, spaceId] = this._unwrapDir(parentEncoded);
    const res = await this._rpc(MSG.MKDIR, {
      token: this.token,
      spaceId,
      parentId,
      name,
    });
    return { ...res.entry, id: this._wrapId(res.entry.id, spaceId) };
  }

  async rename(fileEncoded, name) {
    this._assertLogin();
    const [fileId, spaceId] = this._unwrapId(fileEncoded);
    const res = await this._rpc(MSG.RENAME, {
      token: this.token,
      spaceId,
      fileId,
      name,
    });
    return { ...res.entry, id: this._wrapId(res.entry.id, spaceId) };
  }

  async remove(fileEncoded) {
    this._assertLogin();
    const [fileId, spaceId] = this._unwrapId(fileEncoded);
    await this._rpc(MSG.REMOVE, { token: this.token, spaceId, fileId });
  }

  // ============ 上传（分块 + 可靠投递 + 断点续传） ============

  /**
   * 上传文件。大于 RESUME_MIN_SIZE 的文件会先复制到本地 fs 暂存并写入续传
   * 记录，中途刷新后可通过 resumeTransfer 继续。
   * @param {File} file
   * @returns {Promise<{entry: object}>}
   */
  async uploadFile(file, parentEncoded = "root", { onProgress } = {}) {
    this._assertLogin();
    if (parentEncoded === "root") {
      throw new Error("请先进入一个空间再上传");
    }
    const [parentId, spaceId] = this._unwrapDir(parentEncoded);
    const resumable = file.size >= RESUME_MIN_SIZE;
    const clientUploadId = newId("cu");
    let record = null;

    if (resumable) {
      await this._ensureLocal();
      record = {
        key: clientUploadId,
        dir: "up",
        serverUserId: this.serverUserId,
        spaceId,
        parentId,
        name: file.name,
        size: file.size,
        chunkTotal: Math.ceil(file.size / CHUNK_SIZE),
        clientUploadId,
        tempPath: `transfers/${clientUploadId}`,
        received: [],
        createdAt: Date.now(),
      };
      const dir = await this._fsRoot.get(record.tempPath, { create: "dir" });
      await (await dir.get("src", { create: "file" })).write(file);
      await this._addTransferRecord(record);
    }

    try {
      const entry = await this._runUpload({
        file,
        spaceId,
        parentId,
        clientUploadId,
        record,
        onProgress,
      });
      if (record) await this._removeTransferRecord(record.key);
      return { ...entry, id: this._wrapId(entry.id, spaceId) };
    } catch (err) {
      if (!record) throw err;
      // 大文件失败：保留续传记录与暂存分块，等待用户恢复
      this._onEvent({
        type: "upload-paused",
        name: file.name,
        error: err.message,
      });
      throw err;
    }
  }

  async _runUpload({ file, spaceId, parentId, clientUploadId, record, onProgress }) {
    const readSlice = async (index) => {
      if (file) {
        const start = index * CHUNK_SIZE;
        const buf = await file.slice(start, start + CHUNK_SIZE).arrayBuffer();
        return new Uint8Array(buf);
      }
      // 续传：从本地 fs 暂存文件读取
      const fh = await this._fsRoot.get(`${record.tempPath}/src`);
      if (!fh) throw new Error("本地续传暂存文件丢失");
      const f = await fh.file();
      const start = index * CHUNK_SIZE;
      const buf = await f.slice(start, start + CHUNK_SIZE).arrayBuffer();
      return new Uint8Array(buf);
    };

    const init = await this._rpc(MSG.UPLOAD_INIT, {
      token: this.token,
      spaceId,
      parentId,
      name: record?.name ?? file.name,
      size: record?.size ?? file.size,
      chunkTotal: record?.chunkTotal ?? Math.ceil(file.size / CHUNK_SIZE),
      clientUploadId,
    });
    const uploadId = init.uploadId;
    const total = record?.chunkTotal ?? Math.ceil(file.size / CHUNK_SIZE);
    const done = new Set(init.received || []);
    if (init.received?.length) {
      this._onEvent({
        type: "upload-resumed",
        name: record?.name ?? file.name,
        received: init.received.length,
        total,
      });
    }

    for (let i = 0; i < total; i++) {
      if (done.has(i)) continue;
      const bytes = await readSlice(i);
      await this._rpc(
        MSG.UPLOAD_CHUNK,
        { token: this.token, spaceId, uploadId, index: i, b64: bytesToBase64(bytes) },
        { timeout: 120 * 1000 }
      );
      done.add(i);
      if (record) {
        record.received = [...done];
        await this._updateTransferRecord(record);
      }
      onProgress?.({ sent: done.size, total, name: record?.name ?? file.name });
    }

    const res = await this._rpc(MSG.UPLOAD_COMPLETE, {
      token: this.token,
      spaceId,
      uploadId,
    });
    if (record) {
      const dir = await this._fsRoot.get(record.tempPath);
      await dir?.remove();
    }
    this._onEvent({
      type: "upload-complete",
      name: record?.name ?? file.name,
    });
    return res.entry;
  }

  // ============ 下载（分块拉取 + 大文件断点续传） ============

  /**
   * 下载文件并返回 Blob。大于 RESUME_MIN_SIZE 的文件写入续传记录，
   * 中途刷新后可继续。
   */
  async downloadFile(entry, { onProgress } = {}) {
    this._assertLogin();
    const [fileId, spaceId] = this._unwrapId(entry.id);
    const resumable = entry.size >= RESUME_MIN_SIZE;
    let record = null;
    if (resumable) {
      await this._ensureLocal();
      record = {
        key: newId("dl"),
        dir: "down",
        serverUserId: this.serverUserId,
        spaceId,
        fileId,
        name: entry.name,
        size: entry.size,
        chunkTotal: Math.ceil(entry.size / CHUNK_SIZE),
        tempPath: `transfers/${newId("dl")}`,
        received: [],
        createdAt: Date.now(),
      };
      await this._fsRoot.get(record.tempPath, { create: "dir" });
      await this._addTransferRecord(record);
    }

    try {
      const blob = await this._runDownload({ entry, fileId, spaceId, record, onProgress });
      if (record) await this._removeTransferRecord(record.key);
      return blob;
    } catch (err) {
      if (!record) throw err;
      this._onEvent({
        type: "download-paused",
        name: entry.name,
        error: err.message,
      });
      throw err;
    }
  }

  async _runDownload({ entry, fileId, spaceId, record, onProgress }) {
    const init = await this._rpc(MSG.DOWNLOAD_INIT, {
      token: this.token,
      spaceId,
      fileId,
    });
    const total = init.chunkTotal;
    const done = new Set();
    const parts = new Array(total);

    // 恢复：已拉取的分块从本地暂存读入
    if (record) {
      await this._ensureLocal();
      const dir = await this._fsRoot.get(record.tempPath);
      if (dir) {
        for (const idx of record.received) {
          const fh = await dir.get(String(idx));
          if (fh) {
            parts[idx] = base64ToBytes(await fh.text());
            done.add(idx);
          }
        }
      }
      if (done.size) {
        this._onEvent({
          type: "download-resumed",
          name: record.name,
          received: done.size,
          total,
        });
      }
    }

    for (let i = 0; i < total; i++) {
      if (done.has(i)) continue;
      const res = await this._rpc(
        MSG.DOWNLOAD_CHUNK,
        { token: this.token, spaceId, fileId, index: i },
        { timeout: 120 * 1000 }
      );
      const bytes = base64ToBytes(res.b64);
      parts[i] = bytes;
      done.add(i);
      if (record) {
        const dir = await this._fsRoot.get(record.tempPath, { create: "dir" });
        await (
          await dir.get(String(i), { create: "file" })
        ).write(bytesToBase64(bytes));
        record.received = [...done];
        await this._updateTransferRecord(record);
      }
      onProgress?.({ sent: done.size, total, name: entry.name });
    }

    const merged = new Uint8Array(
      parts.reduce((sum, p) => sum + p.length, 0)
    );
    let offset = 0;
    for (const p of parts) {
      merged.set(p, offset);
      offset += p.length;
    }
    if (record) {
      const dir = await this._fsRoot.get(record.tempPath);
      await dir?.remove();
    }
    return new Blob([merged]);
  }

  // ============ 断点续传记录管理 ============

  /** 列出未完成的续传任务（刷新后页面据此询问用户） */
  async listTransfers() {
    await this._ensureLocal();
    return (await this._storage.getItem("transfers")) || [];
  }

  /**
   * 继续一个续传任务（要求已重新登录到对应服务器与空间）
   * @returns {Promise<{entry?: object, blob?: Blob}>}
   */
  async resumeTransfer(record, { onProgress } = {}) {
    this._assertLogin();
    if (record.serverUserId !== this.serverUserId)
      throw new Error("该续传任务属于其他服务器，请先连接原服务器");
    if (!this.mySpaces?.some((s) => s.id === record.spaceId))
      throw new Error("该续传任务的空间不在当前账号授权范围内");
    if (record.dir === "up") {
      const fh = await this._fsRoot.get(`${record.tempPath}/src`);
      if (!fh) throw new Error("本地暂存文件丢失，无法续传");
      const f = await fh.file();
      const entry = await this._runUpload({
        file: null,
        parentId: record.parentId,
        clientUploadId: record.clientUploadId,
        record,
        onProgress,
      });
      await this._removeTransferRecord(record.key);
      return { entry };
    }
    const blob = await this._runDownload(
      {
        entry: { id: record.fileId, name: record.name, size: record.size },
        record,
        onProgress,
      },
    );
    await this._removeTransferRecord(record.key);
    return { blob };
  }

  /** 取消续传任务：清除暂存分块与记录 */
  async cancelTransfer(key) {
    await this._ensureLocal();
    const list = (await this._storage.getItem("transfers")) || [];
    const record = list.find((r) => r.key === key);
    if (record) {
      const dir = await this._fsRoot.get(record.tempPath);
      await dir?.remove();
    }
    await this._storage.setItem(
      "transfers",
      list.filter((r) => r.key !== key)
    );
    this._onEvent({ type: "transfer-cancelled", key });
  }

  _assertLogin() {
    if (!this.loggedIn) throw new Error("请先登录");
  }

  async _addTransferRecord(record) {
    const list = (await this._storage.getItem("transfers")) || [];
    list.push(record);
    await this._storage.setItem("transfers", list);
  }

  async _updateTransferRecord(record) {
    const list = (await this._storage.getItem("transfers")) || [];
    const idx = list.findIndex((r) => r.key === record.key);
    if (idx !== -1) {
      list[idx] = { ...record };
      await this._storage.setItem("transfers", list);
    }
  }

  async _removeTransferRecord(key) {
    const list = (await this._storage.getItem("transfers")) || [];
    await this._storage.setItem(
      "transfers",
      list.filter((r) => r.key !== key)
    );
  }
}
