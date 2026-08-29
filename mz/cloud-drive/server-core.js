// mz/cloud-drive/server-core —— 云盘服务器核心逻辑
//
// 职责：空间（storage dir）管理、用户账号体系、文件树元数据、基于 NoneOS fs 的
// 文件存取，以及基于 ReliableChannel 的可靠指令应答。
// 由页面模块经 load("/mz/cloud-drive/server-core.js") 使用；/nos/* 全部按需动态
// 加载，本模块顶层不 import /nos/*。
//
// 存储布局：
//   storage(getStorage("cloud-drive-server"))
//     - spaces: [{ id, name, createdAt }]
//     - accounts: [{ id, username, passHash, passPlain, spaces: [spaceId], createdAt }]
//       （passPlain 为明文密码，供管理员在 UI 查看；早期账号可能缺失）
//     - tree:<spaceId>: { rootId, nodes: { [id]: { id, name, type, parentId, size, mtime } } }
//     - upload:<uploadId>: { uploadId, spaceId, parentId, name, size, chunkTotal,
//                            received: number[], clientUploadId, createdAt }
//     - audit: 审计日志（最新在前，上限 500 条）
//       [{ id, time, type: "login"|"login-fail"|"logout", username, remoteUserId, token? }]
//   fs(init("cloud-drive-server"))
//     - spaces/<spaceId>/<fileId>   文件内容
//     - tmp/<uploadId>/<index>      上传中的分块

import { ReliableChannel } from "./reliable.js";
import {
  APP_SERVICE_ID,
  CHUNK_SIZE,
  MSG,
  base64ToBytes,
  newId,
  sha256Hex,
} from "./protocol.js";

export class CloudDriveServer {
  /**
   * @param {import("/nos/user/main.js").LocalUser} user
   * @param {(event: { type: string, [k: string]: any }) => void} [onEvent]
   */
  constructor(user, onEvent) {
    this._user = user;
    this._onEvent = onEvent || (() => {});
    this._running = false;
    this._storage = null;
    this._fsRoot = null;
    this._service = null;
    this._channels = new Map(); // remoteUserId -> ReliableChannel
    this._remotes = new Map(); // remoteUserId -> 最新 RemoteUser（每次收到消息都更新）
    this._handlerQueues = new Map(); // remoteUserId -> 尾部 Promise（串行处理指令）
    this._sessions = new Map(); // token -> { username, remoteUserId, spaceId }
    this._uploads = new Map(); // uploadId -> { received: Set<number> }
  }

  get running() {
    return this._running;
  }

  get userId() {
    return this._user.userId;
  }

  async start() {
    if (this._running) return;
    const { getStorage } = await import("/nos/storage/main.js");
    const fsMod = await import("/nos/fs/main.js");
    this._storage = getStorage("cloud-drive-server");
    this._fsRoot = await fsMod.init("cloud-drive-server");
    await this._loadSessions();
    this._service = this._user.registerService(APP_SERVICE_ID, {
      onMessage: (data, ctx) => this._onMessage(data, ctx),
    });
    this._running = true;
    this._onEvent({ type: "started", userId: this._user.userId });
  }

  stop() {
    if (!this._running) return;
    this._service?.unregister();
    this._service = null;
    for (const ch of this._channels.values()) ch.destroy();
    this._channels.clear();
    this._remotes.clear();
    // 会话持久化在 storage 中，刷新 / 重启后依然有效，这里不清除
    this._running = false;
    this._onEvent({ type: "stopped" });
  }

  // ============ 会话持久化（7 天有效期） ============

  static SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

  async _loadSessions() {
    const list = (await this._storage.getItem("sessions")) || [];
    const deadline = Date.now() - CloudDriveServer.SESSION_TTL;
    this._sessions = new Map(
      list.filter((s) => s.createdAt > deadline).map((s) => [s.token, s])
    );
  }

  async _saveSession(session) {
    this._sessions.set(session.token, session);
    const deadline = Date.now() - CloudDriveServer.SESSION_TTL;
    const list = [...this._sessions.values()].filter(
      (s) => s.createdAt > deadline
    );
    await this._storage.setItem("sessions", list);
  }

  // ============ 传输与消息调度 ============

  _onMessage(data, ctx) {
    if (!data || !data.msgId) return;
    const ch = this._ensureChannel(ctx.fromUserId, ctx.remoteUser);
    ch.handle(data);
  }

  _ensureChannel(remoteUserId, remoteUser) {
    // 始终记录最新连接：客户端刷新后会用同一 userId 重新 connectUser，
    // 旧 RemoteUser 的 RTC 可能已失效，若应答仍发往旧连接客户端将收不到
    this._remotes.set(remoteUserId, remoteUser);
    let ch = this._channels.get(remoteUserId);
    if (!ch) {
      ch = new ReliableChannel({
        channelId: `server->${remoteUserId.slice(0, 8)}`,
        send: async (envelope) => {
          const ru = this._remotes.get(remoteUserId);
          const results = await ru.sendToService(APP_SERVICE_ID, envelope);
          return results.some((r) => r.status === "ok");
        },
        onData: (payload) => this._dispatch(payload, remoteUserId, remoteUser),
      });
      this._channels.set(remoteUserId, ch);
      this._onEvent({ type: "client-connected", remoteUserId });
    }
    return ch;
  }

  /** 同一远端的指令串行处理，保证 fs 写入顺序 */
  _dispatch(payload, remoteUserId, remoteUser) {
    if (!payload || !payload.t) return;
    const prev = this._handlerQueues.get(remoteUserId) ?? Promise.resolve();
    const next = prev
      .then(() => this._handleMsg(payload, remoteUserId))
      .then(
        (result) =>
          this._respond(
            remoteUserId,
            payload,
            result || { ok: false, error: "无响应" },
            remoteUser
          ),
        (err) => {
          console.warn("[cloud-drive-server] handler error:", err);
          return this._respond(
            remoteUserId,
            payload,
            { ok: false, error: err.message || String(err) },
            remoteUser
          );
        }
      );
    this._handlerQueues.set(
      remoteUserId,
      next.catch(() => {})
    );
  }

  async _respond(remoteUserId, req, result, remoteUser) {
    const ch = this._ensureChannel(remoteUserId, remoteUser);
    try {
      await ch.send({ t: `${req.t}-res`, reqId: req.reqId, ...result });
    } catch (err) {
      console.warn("[cloud-drive-server] respond failed:", err);
    }
  }

  async _handleMsg(p, remoteUserId) {
    switch (p.t) {
      case MSG.PING:
        return { ok: true, time: Date.now() };

      // 注意：不再提供公开的空间列表指令，空间信息仅登录后按账号授权返回

      case MSG.LOGIN: {
        const accounts = await this._getAccounts();
        const account = accounts.find((a) => a.username === p.username);
        const passHash = await sha256Hex(String(p.password ?? ""));
        if (!account || account.passHash !== passHash) {
          await this._log({
            type: "login-fail",
            username: String(p.username ?? ""),
            remoteUserId,
          });
          return { ok: false, error: "用户名或密码错误" };
        }
        // 只返回该账号被授权的空间，未登录前空间信息不可见
        const spaces = (await this.listSpaces()).filter((s) =>
          account.spaces.includes(s.id)
        );
        if (!spaces.length) {
          return { ok: false, error: "该账号尚未被授权任何空间，请联系管理员" };
        }        const token = newId("tk");
        await this._saveSession({
          token,
          username: account.username,
          remoteUserId,
          createdAt: Date.now(),
        });
        this._onEvent({
          type: "login",
          username: account.username,
          remoteUserId,
        });
        await this._log({
          type: "login",
          username: account.username,
          remoteUserId,
          token,
        });
        return {
          ok: true,
          token,
          username: account.username,
          spaces: spaces.map(({ id, name }) => ({ id, name })),
        };
      }
      case MSG.LOGOUT: {
        // 客户端主动登出：注销会话并记录审计（token 失效 / 未知也返回 ok，幂等）
        const session = this._sessions.get(p.token);
        if (session) {
          this._sessions.delete(p.token);
          await this._storage.setItem("sessions", [...this._sessions.values()]);
          await this._log({
            type: "logout",
            username: session.username,
            remoteUserId,
            token: p.token,
          });
          this._onEvent({ type: "logout", username: session.username });
        }
        return { ok: true };
      }
      case MSG.RESUME: {
        // 刷新后凭持久化 token 恢复登录：校验并记「刷新登录」审计
        const session = this._sessions.get(p.token);
        const valid =
          session &&
          session.remoteUserId === remoteUserId &&
          session.createdAt >= Date.now() - CloudDriveServer.SESSION_TTL;
        if (!valid) return { ok: false, error: "登录已失效，请重新登录" };
        await this._log({
          type: "refresh-login",
          username: session.username,
          remoteUserId,
          token: p.token,
        });
        this._onEvent({ type: "refresh-login", username: session.username });
        return { ok: true };
      }
    }

    // ---- 以下指令均需有效会话 ----
    const session = this._sessions.get(p.token);
    if (
      !session ||
      session.remoteUserId !== remoteUserId ||
      session.createdAt < Date.now() - CloudDriveServer.SESSION_TTL
    ) {
      return { ok: false, error: "登录已失效，请重新登录" };
    }
    // 会话不再绑定单一空间：每个指令显式携带 spaceId，逐次校验当前授权
    // （管理员调整授权后立即生效，不依赖登录时快照）
    if (!p.spaceId) return { ok: false, error: "缺少空间标识" };
    const account = (await this._getAccounts()).find(
      (a) => a.username === session.username
    );
    if (!account || !account.spaces.includes(p.spaceId)) {
      return { ok: false, error: "无权访问该空间" };
    }
    const spaceId = p.spaceId;
    const spaceRecord = (await this.listSpaces()).find((s) => s.id === spaceId);
    const isLocal = spaceRecord?.kind === "local";

    switch (p.t) {
      case MSG.LIST: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const tree = await this._getTree(spaceId);
        const parentId = p.parentId || tree.rootId;
        const parent = tree.nodes[parentId];
        if (!parent) return { ok: false, error: "目录不存在" };
        const children = Object.values(tree.nodes)
          .filter((n) => n.parentId === parentId)
          .sort(
            (a, b) =>
              (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)
          );
        return {
          ok: true,
          path: this._buildPath(tree, parentId),
          entries: children.map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            size: n.size || 0,
            mtime: n.mtime || 0,
          })),
        };
      }

      case MSG.MKDIR: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const err = await this._checkSpace(spaceId);
        if (err) return err;
        const tree = await this._getTree(spaceId);
        const parentId = p.parentId || tree.rootId;
        if (!tree.nodes[parentId]) return { ok: false, error: "目录不存在" };
        const name = this._uniqueName(tree, parentId, String(p.name || "").trim());
        if (!name) return { ok: false, error: "名称不能为空" };
        const node = {
          id: newId("n"),
          name,
          type: "dir",
          parentId,
          mtime: Date.now(),
        };
        tree.nodes[node.id] = node;
        await this._saveTree(spaceId, tree);
        this._onEvent({ type: "mkdir", spaceId, name });
        return { ok: true, entry: node };
      }

      case MSG.RENAME: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const tree = await this._getTree(spaceId);
        const node = tree.nodes[p.fileId];
        if (!node) return { ok: false, error: "文件不存在" };
        const name = String(p.name || "").trim();
        if (!name) return { ok: false, error: "名称不能为空" };
        node.name = this._uniqueName(tree, node.parentId, name, node.id);
        node.mtime = Date.now();
        await this._saveTree(spaceId, tree);
        return { ok: true, entry: node };
      }

      case MSG.REMOVE: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const tree = await this._getTree(spaceId);
        const node = tree.nodes[p.fileId];
        if (!node) return { ok: false, error: "文件不存在" };
        if (node.id === tree.rootId)
          return { ok: false, error: "不能删除根目录" };
        const ids = this._collectSubtree(tree, node.id);
        for (const id of ids) {
          if (tree.nodes[id]?.type === "file") {
            const fh = await this._fsRoot.get(`spaces/${spaceId}/${id}`);
            await fh?.remove();
          }
          delete tree.nodes[id];
        }
        await this._saveTree(spaceId, tree);
        this._onEvent({ type: "remove", spaceId, name: node.name });
        return { ok: true };
      }

      case MSG.UPLOAD_INIT: {
        const err = await this._checkSpace(spaceId);
        if (err) return err;
        // 断点续传：同一 clientUploadId 幂等返回已接收分块
        const uploads = await this._listUploadSessions();
        const found = uploads.find(
          (u) =>
            u.clientUploadId === p.clientUploadId &&
            u.spaceId === spaceId &&
            u.name === p.name &&
            u.size === p.size
        );
        if (found) {
          this._uploads.set(found.uploadId, {
            received: new Set(found.received),
          });
          return {
            ok: true,
            uploadId: found.uploadId,
            received: found.received,
            resumed: true,
          };
        }
        const uploadId = newId("up");
        const session = {
          uploadId,
          spaceId,
          parentId: p.parentId || (await this._getTree(spaceId)).rootId,
          name: p.name,
          size: p.size,
          chunkTotal: p.chunkTotal,
          received: [],
          clientUploadId: p.clientUploadId,
          createdAt: Date.now(),
        };
        await this._storage.setItem(`upload:${uploadId}`, session);
        this._uploads.set(uploadId, { received: new Set() });
        this._onEvent({
          type: "upload-start",
          spaceId,
          name: p.name,
          size: p.size,
        });
        return { ok: true, uploadId, received: [], resumed: false };
      }

      case MSG.UPLOAD_CHUNK: {
        const meta = await this._storage.getItem(`upload:${p.uploadId}`);
        if (!meta) return { ok: false, error: "上传会话不存在" };
        const state = this._uploads.get(p.uploadId);
        if (!state) {
          this._uploads.set(p.uploadId, { received: new Set(meta.received) });
        }
        const received = (
          this._uploads.get(p.uploadId) || { received: new Set() }
        ).received;
        if (!received.has(p.index)) {
          const dir = await this._fsRoot.get(
            `tmp/${p.uploadId}`,
            { create: "dir" }
          );
          const bytes = base64ToBytes(p.b64);
          await dir
            .get(String(p.index), { create: "file" })
            .then((f) => f.write(new Blob([bytes])));
          received.add(p.index);
          meta.received = [...received];
          await this._storage.setItem(`upload:${p.uploadId}`, meta);
        }
        return { ok: true, index: p.index, receivedCount: received.size };
      }

      case MSG.UPLOAD_COMPLETE: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const meta = await this._storage.getItem(`upload:${p.uploadId}`);
        if (!meta) return { ok: false, error: "上传会话不存在" };
        if (meta.received.length < meta.chunkTotal) {
          return {
            ok: false,
            error: `分块不完整 (${meta.received.length}/${meta.chunkTotal})`,
          };
        }
        const parts = [];
        for (let i = 0; i < meta.chunkTotal; i++) {
          const fh = await this._fsRoot.get(`tmp/${p.uploadId}/${i}`);
          if (!fh) return { ok: false, error: `分块 ${i} 丢失` };
          parts.push(new Uint8Array(await fh.buffer()));
        }
        let total = 0;
        for (const part of parts) total += part.length;
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          merged.set(part, offset);
          offset += part.length;
        }
        const fileId = newId("f");
        await (await this._fsRoot.get(`spaces/${meta.spaceId}/${fileId}`, { create: "file" })).write(
          new Blob([merged])
        );
        const tree = await this._getTree(meta.spaceId);
        if (!tree.nodes[meta.parentId])
          meta.parentId = tree.rootId;
        const name = this._uniqueName(tree, meta.parentId, meta.name);
        tree.nodes[fileId] = {
          id: fileId,
          name,
          type: "file",
          parentId: meta.parentId,
          size: meta.size,
          mtime: Date.now(),
        };
        await this._saveTree(meta.spaceId, tree);
        await this._cleanupUpload(p.uploadId);
        this._onEvent({
          type: "upload-complete",
          spaceId: meta.spaceId,
          name,
          size: meta.size,
        });
        return { ok: true, entry: tree.nodes[fileId] };
      }

      case MSG.UPLOAD_CANCEL: {
        const meta = await this._storage.getItem(`upload:${p.uploadId}`);
        if (meta) await this._cleanupUpload(p.uploadId);
        return { ok: true };
      }

      case MSG.DOWNLOAD_INIT: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const tree = await this._getTree(spaceId);
        const node = tree.nodes[p.fileId];
        if (!node || node.type !== "file")
          return { ok: false, error: "文件不存在" };
        return {
          ok: true,
          name: node.name,
          size: node.size,
          chunkTotal: Math.max(1, Math.ceil(node.size / CHUNK_SIZE)),
          mtime: node.mtime,
        };
      }

      case MSG.DOWNLOAD_CHUNK: {
        if (isLocal) return this._handleLocalMsg(p, spaceId);
        const fh = await this._fsRoot.get(`spaces/${spaceId}/${p.fileId}`);
        if (!fh) return { ok: false, error: "文件不存在" };
        const buf = await fh.buffer();
        const start = p.index * CHUNK_SIZE;
        if (start >= buf.byteLength)
          return { ok: false, error: "分块越界" };
        const slice = new Uint8Array(buf, start, Math.min(CHUNK_SIZE, buf.byteLength - start));
        let b64 = "";
        const step = 0x8000;
        for (let i = 0; i < slice.length; i += step) {
          b64 += String.fromCharCode(...slice.subarray(i, i + step));
        }
        return { ok: true, b64: btoa(b64), index: p.index };
      }
    }

    return { ok: false, error: `未知指令: ${p.t}` };
  }

  // ============ 审计日志（登录 / 登出记录） ============

  static AUDIT_MAX = 500;

  /** 追加一条审计记录（最新在前，超出上限裁剪） */
  async _log(entry) {
    const list = (await this._storage.getItem("audit")) || [];
    list.unshift({ ...entry, id: newId("au"), time: Date.now() });
    if (list.length > CloudDriveServer.AUDIT_MAX) list.length = CloudDriveServer.AUDIT_MAX;
    await this._storage.setItem("audit", list);
  }

  /** 审计记录（最新在前）：{ id, time, type: "login"|"login-fail"|"logout", username, remoteUserId, token? } */
  async listAudit() {
    return (await this._storage.getItem("audit")) || [];
  }

  async clearAudit() {
    await this._storage.removeItem("audit");
  }

  // ============ 空间与用户管理（供服务器 UI 调用） ============

  async listSpaces() {
    return (await this._storage.getItem("spaces")) || [];
  }

  async createSpace(name) {
    name = String(name || "").trim();
    if (!name) throw new Error("空间名称不能为空");
    const spaces = await this.listSpaces();
    if (spaces.some((s) => s.name === name))
      throw new Error("空间名称已存在");
    const space = { id: newId("sp"), name, createdAt: Date.now() };
    spaces.push(space);
    await this._storage.setItem("spaces", spaces);
    await this._saveTree(space.id, this._emptyTree());
    this._onEvent({ type: "space-created", name });
    return space;
  }

  /**
   * 挂载本地文件夹为空间（需 File System Access API，调用方自行检测）。
   * 文件内容保留在本地磁盘，服务器只持有挂载句柄。
   * @param {import("/nos/fs/main.js").DirHandle} handle - open() 返回的本地目录句柄
   */
  async createLocalSpace(handle) {
    const { mount } = await import("/nos/fs/main.js");
    const mounted = await mount(handle);
    const spaces = await this.listSpaces();
    let name = handle.name || "本地空间";
    let i = 2;
    while (spaces.some((s) => s.name === name)) name = `${handle.name} (${i++})`;
    const space = {
      id: newId("sp"),
      name,
      createdAt: Date.now(),
      kind: "local",
      mountPath: mounted.path,
    };
    spaces.push(space);
    await this._storage.setItem("spaces", spaces);
    await this._storage.setItem(`mount:${space.id}`, mounted);
    this._onEvent({ type: "space-created", name, kind: "local" });
    return space;
  }

  /** 取本地空间的挂载句柄；系统挂载失效（如刷新后）时尝试重新挂载 */
  async _getMount(spaceId) {
    let handle = await this._storage.getItem(`mount:${spaceId}`);
    if (!handle) throw new Error("本地空间挂载句柄丢失");
    const { get, mount } = await import("/nos/fs/main.js");
    const probe = await get(handle.path);
    if (!probe) {
      handle = await mount(handle);
      await this._storage.setItem(`mount:${spaceId}`, handle);
    }
    return handle;
  }

  async deleteSpace(spaceId) {
    const spaces = await this.listSpaces();
    const idx = spaces.findIndex((s) => s.id === spaceId);
    if (idx === -1) return;
    spaces.splice(idx, 1);
    await this._storage.setItem("spaces", spaces);
    await this._storage.removeItem(`tree:${spaceId}`);
    await this._storage.removeItem(`mount:${spaceId}`);
    const dir = await this._fsRoot.get(`spaces/${spaceId}`);
    await dir?.remove();
    // 本地挂载空间：仅移除登记，不删除本地文件
    // 清理关联账号与上传会话
    const accounts = await this._getAccounts();
    let changed = false;
    for (const a of accounts) {
      if (a.spaces.includes(spaceId)) {
        a.spaces = a.spaces.filter((s) => s !== spaceId);
        changed = true;
      }
    }
    if (changed) await this._storage.setItem("accounts", accounts);
    for (const u of await this._listUploadSessions()) {
      if (u.spaceId === spaceId) await this._cleanupUpload(u.uploadId);
    }
    this._onEvent({ type: "space-deleted", spaceId });
  }

  async listAccounts() {
    const accounts = await this._getAccounts();
    // passPlain：管理员可见的明文密码（早期账号可能未记录）
    return accounts.map(({ id, username, spaces, createdAt, passPlain }) => ({
      id,
      username,
      spaces,
      createdAt,
      passPlain: passPlain ?? null,
    }));
  }

  async createAccount({ username, password, spaces }) {
    username = String(username || "").trim();
    if (!username) throw new Error("用户名不能为空");
    if (!password) throw new Error("密码不能为空");
    if (!(Array.isArray(spaces) && spaces.length))
      throw new Error("至少授权一个空间");
    const accounts = await this._getAccounts();
    if (accounts.some((a) => a.username === username))
      throw new Error("用户名已存在");
    const account = {
      id: newId("u"),
      username,
      passHash: await sha256Hex(password),
      passPlain: password,
      spaces,
      createdAt: Date.now(),
    };
    accounts.push(account);
    await this._storage.setItem("accounts", accounts);
    this._onEvent({ type: "account-created", username });
    return { id: account.id, username, spaces, createdAt: account.createdAt };
  }

  async updateAccount(id, { password, spaces }) {
    const accounts = await this._getAccounts();
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new Error("账号不存在");
    if (password) {
      account.passHash = await sha256Hex(password);
      account.passPlain = password;
    }
    if (Array.isArray(spaces)) account.spaces = spaces;
    await this._storage.setItem("accounts", accounts);
    return this.listAccounts();
  }

  async deleteAccount(id) {
    const accounts = await this._getAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const username = accounts[idx].username;
    accounts.splice(idx, 1);
    await this._storage.setItem("accounts", accounts);
    // 同步清除该账号的持久化会话，避免删除后仍可凭旧 token 访问
    for (const [token, s] of this._sessions) {
      if (s.username === username) this._sessions.delete(token);
    }
    await this._storage.setItem("sessions", [...this._sessions.values()]);
  }

  async getStats() {
    const spaces = await this.listSpaces();
    const accounts = await this._getAccounts();
    const uploads = await this._listUploadSessions();
    const files = [];
    for (const s of spaces) {
      const tree = await this._getTree(s.id);
      files.push(
        ...Object.values(tree.nodes).filter((n) => n.type === "file")
      );
    }
    return {
      spaceCount: spaces.length,
      accountCount: accounts.length,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
      activeUploads: uploads.length,
    };
  }

  // ============ 本地挂载空间（kind: "local"） ============

  async _handleLocalMsg(p, spaceId) {
    const base = await this._getMount(spaceId);
    // 客户端用 "root" 表示根目录，本地模式映射为挂载根
    const normalize = (id) => (!id || id === "root" ? "" : id);
    const join = (parent, name) => (parent ? `${parent}/${name}` : name);

    switch (p.t) {
      case MSG.LIST: {
        const parent = normalize(p.parentId);
        const dir = parent ? await base.get(parent) : base;
        if (!dir) return { ok: false, error: "目录不存在" };
        const entries = [];
        for await (const handle of dir.values()) {
          const entry = {
            id: join(parent, handle.name),
            name: handle.name,
            type: handle.kind === "dir" ? "dir" : "file",
            size: 0,
            mtime: 0,
          };
          if (handle.kind === "file") {
            try {
              entry.size = await handle.size();
            } catch {}
          }
          entries.push(entry);
        }
        entries.sort((a, b) =>
          a.type === b.type
            ? a.name.localeCompare(b.name)
            : a.type === "dir"
              ? -1
              : 1
        );
        const path = parent ? parent.split("/") : [];
        return {
          ok: true,
          path: path.map((name, i) => ({
            id: path.slice(0, i + 1).join("/"),
            name,
          })),
          entries,
        };
      }

      case MSG.MKDIR: {
        const parent = normalize(p.parentId);
        const name = String(p.name || "").trim();
        if (!name) return { ok: false, error: "名称不能为空" };
        const dir = parent ? await base.get(parent) : base;
        if (!dir) return { ok: false, error: "目录不存在" };
        await dir.get(name, { create: "dir" });
        return {
          ok: true,
          entry: {
            id: join(parent, name),
            name,
            type: "dir",
            size: 0,
            mtime: Date.now(),
          },
        };
      }

      case MSG.RENAME:
        return { ok: false, error: "本地空间暂不支持重命名" };

      case MSG.REMOVE: {
        const fh = await base.get(normalize(p.fileId));
        if (!fh) return { ok: false, error: "文件不存在" };
        await fh.remove();
        return { ok: true };
      }

      case MSG.UPLOAD_COMPLETE: {
        const meta = await this._storage.getItem(`upload:${p.uploadId}`);
        if (!meta) return { ok: false, error: "上传会话不存在" };
        if (meta.received.length < meta.chunkTotal) {
          return {
            ok: false,
            error: `分块不完整 (${meta.received.length}/${meta.chunkTotal})`,
          };
        }
        const parts = [];
        for (let i = 0; i < meta.chunkTotal; i++) {
          const fh = await this._fsRoot.get(`tmp/${p.uploadId}/${i}`);
          if (!fh) return { ok: false, error: `分块 ${i} 丢失` };
          parts.push(new Uint8Array(await fh.buffer()));
        }
        let total = 0;
        for (const part of parts) total += part.length;
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          merged.set(part, offset);
          offset += part.length;
        }
        const parent = normalize(meta.parentId);
        const dir = parent ? await base.get(parent) : base;
        if (!dir) return { ok: false, error: "目标目录不存在" };
        let name = meta.name;
        let i = 2;
        while (await dir.get(name)) {
          const dot = meta.name.lastIndexOf(".");
          const baseName = dot > 0 ? meta.name.slice(0, dot) : meta.name;
          const ext = dot > 0 ? meta.name.slice(dot) : "";
          name = `${baseName} (${i++})${ext}`;
        }
        await (await dir.get(name, { create: "file" })).write(
          new Blob([merged])
        );
        await this._cleanupUpload(p.uploadId);
        this._onEvent({
          type: "upload-complete",
          spaceId,
          name,
          size: meta.size,
          local: true,
        });
        return {
          ok: true,
          entry: {
            id: join(parent, name),
            name,
            type: "file",
            size: meta.size,
            mtime: Date.now(),
          },
        };
      }

      case MSG.DOWNLOAD_INIT: {
        const fh = await base.get(normalize(p.fileId));
        if (!fh || fh.kind !== "file")
          return { ok: false, error: "文件不存在" };
        const file = await fh.file();
        return {
          ok: true,
          name: fh.name,
          size: file.size,
          chunkTotal: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)),
          mtime: file.lastModified,
        };
      }

      case MSG.DOWNLOAD_CHUNK: {
        const fh = await base.get(normalize(p.fileId));
        if (!fh || fh.kind !== "file")
          return { ok: false, error: "文件不存在" };
        const buf = await fh.buffer();
        const start = p.index * CHUNK_SIZE;
        if (start >= buf.byteLength)
          return { ok: false, error: "分块越界" };
        const slice = new Uint8Array(
          buf,
          start,
          Math.min(CHUNK_SIZE, buf.byteLength - start)
        );
        let b64 = "";
        const step = 0x8000;
        for (let i = 0; i < slice.length; i += step) {
          b64 += String.fromCharCode(...slice.subarray(i, i + step));
        }
        return { ok: true, b64: btoa(b64), index: p.index };
      }
    }

    return { ok: false, error: `本地空间不支持指令: ${p.t}` };
  }

  // ============ 内部工具 ============

  async _getAccounts() {
    return (await this._storage.getItem("accounts")) || [];
  }

  async _checkSpace(spaceId) {
    const spaces = await this.listSpaces();
    return spaces.some((s) => s.id === spaceId)
      ? null
      : { ok: false, error: "空间不存在" };
  }

  _emptyTree() {
    return {
      rootId: "root",
      nodes: { root: { id: "root", name: "/", type: "dir", parentId: null } },
    };
  }

  async _getTree(spaceId) {
    const tree = await this._storage.getItem(`tree:${spaceId}`);
    if (tree) return tree;
    const fresh = this._emptyTree();
    await this._storage.setItem(`tree:${spaceId}`, fresh);
    return fresh;
  }

  async _saveTree(spaceId, tree) {
    await this._storage.setItem(`tree:${spaceId}`, tree);
  }

  /** 根目录以下（含当前目录）的路径，返回 [{ id, name }]，与本地空间路径结构一致 */
  _buildPath(tree, nodeId) {
    const parts = [];
    let cur = tree.nodes[nodeId];
    while (cur && cur.id !== tree.rootId) {
      parts.unshift({ id: cur.id, name: cur.name });
      cur = tree.nodes[cur.parentId];
    }
    return parts;
  }

  _uniqueName(tree, parentId, name, excludeId = null) {
    if (!name) return name;
    const siblings = Object.values(tree.nodes).filter(
      (n) => n.parentId === parentId && n.id !== excludeId
    );
    if (!siblings.some((s) => s.name === name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 2;
    while (siblings.some((s) => s.name === `${base} (${i})${ext}`)) i++;
    return `${base} (${i})${ext}`;
  }

  _collectSubtree(tree, nodeId) {
    const out = [nodeId];
    for (const n of Object.values(tree.nodes)) {
      if (n.parentId === nodeId) out.push(...this._collectSubtree(tree, n.id));
    }
    return out;
  }

  async _listUploadSessions() {
    const out = [];
    for await (const key of this._storage.keys()) {
      if (String(key).startsWith("upload:")) {
        const meta = await this._storage.getItem(key);
        if (meta) out.push(meta);
      }
    }
    return out;
  }

  async _cleanupUpload(uploadId) {
    this._uploads.delete(uploadId);
    await this._storage.removeItem(`upload:${uploadId}`);
    const dir = await this._fsRoot.get(`tmp/${uploadId}`);
    await dir?.remove();
  }
}
