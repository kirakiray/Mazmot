/* ---------- 本地项目（导入 / 对话快照 / 句柄恢复） ----------
 * 本地目录渠道的项目数据在用户所选目录里：句柄从 mazmot apps[] 登记记录
 * 恢复；会话对话快照写入项目目录 conjure-chats/（回合收尾与增删会话时），
 * 重新选择目录时经 importLocalProject 导入恢复。
 */

import {
  sanitizeAppName,
  registerAppRecord,
  buildLocalAppRecord,
  buildAppRecord,
  loadProjectChats,
  saveProjectChats,
} from "../builder.js";

export function createLocalProjectPart(api) {
  const {
    state,
    set,
    fs,
    mazmotStore,
    selfStore,
    res,
    loadRegistry,
    saveRegistry,
    sessionBuckets,
    bucketFor,
  } = api;

  // 从 mazmot apps[] 记录恢复本地目录句柄（local 渠道跨会话复用，无需重新 open）
  async function getLocalHandleFromRecord(appName) {
    if (!mazmotStore) return null;
    const apps = (await mazmotStore.getItem("apps")) || [];
    const rec = apps.find(
      (a) =>
        a.mazmot?.source === "ai-builder" &&
        a.source === "local" &&
        a.name === sanitizeAppName(appName),
    );
    return rec?.handle || null;
  }

  // 本地渠道项目的快照目录句柄（当前应用用共享句柄，其它从登记记录恢复）
  async function localChatsHandle(name) {
    let handle = res.localRootHandle;
    if (name !== state.currentAppName || !handle) {
      handle = await getLocalHandleFromRecord(name);
    }
    return handle || null;
  }

  // 导入本地既有项目：按 client/app.json 元数据登记应用，并从项目目录的
  // conjure-chats.json 恢复会话列表、消息与 Agent 记忆；同名已登记时合并
  // （句柄更新 + 只补缺失的会话），然后切换到该项目
  async function importLocalProject(meta, handle) {
    const clean = sanitizeAppName(meta.name);
    if (!clean) throw new Error(`项目 app.json 的 name 不合法：${meta.name}`);
    const chats = await loadProjectChats(handle);

    const reg = await loadRegistry();
    let hit = reg.find((a) => a.name === clean);
    const importedSessions = (chats?.sessions || []).filter(
      (s) => s && s.id && !hit?.sessions?.some((x) => x.id === s.id),
    );
    if (!hit) {
      hit = {
        name: clean,
        displayName: meta.displayName || clean,
        icon: meta.icon || "📦",
        mode: "local",
        createdAt: Date.now(),
        sessions: importedSessions.map(({ busy, ...s }) => s),
      };
      if (chats?.sessionOrder) hit.sessionOrder = chats.sessionOrder;
      reg.push(hit);
    } else {
      hit.mode = "local";
      hit.sessions = hit.sessions || [];
      hit.sessions.push(...importedSessions.map(({ busy, ...s }) => s));
    }
    await saveRegistry(reg);

    // mazmet apps[] 登记（携带句柄，刷新后可恢复授权）
    if (mazmotStore) {
      try {
        await registerAppRecord(
          mazmotStore,
          buildLocalAppRecord({
            name: clean,
            displayName: hit.displayName,
            icon: hit.icon,
            handle,
          }),
        );
      } catch (err) {
        console.warn("导入登记 mazmot apps 失败：", err);
      }
    }

    // 恢复对话数据：只导入本机缺失的会话（不覆盖本地已有记录）
    if (chats && importedSessions.length) {
      for (const s of importedSessions) {
        const msgs = chats.messages?.[s.id];
        if (Array.isArray(msgs)) {
          await selfStore.setItem(`chat:${clean}:${s.id}`, msgs);
        }
        const thread = chats.threads?.[s.id];
        if (Array.isArray(thread)) {
          await selfStore.setItem(`thread:${clean}:${s.id}`, thread);
        }
      }
    }

    set("keyError", "");
    await api.selectApp(clean);
    await api.reloadApps();
  }

  // 把当前本地项目的对话数据写快照到项目目录（conjure-chats/ 目录布局）。
  // 每次对话回合结束后调用；appName 可与当前视图不同（回合归属优先）。
  // onlySid 提供时只重写该会话的快照文件（回合收尾的增量场景，其余会话
  // 文件不动）；缺省全量模式并清理已删除会话的孤儿文件
  async function syncLocalProjectChats(appName = state.currentAppName, onlySid = null) {
    if (!selfStore || appName === "") return;
    try {
      const reg = await loadRegistry();
      const app = reg.find((a) => a.name === appName);
      if (!app || app.mode !== "local") return;
      // 句柄：当前应用用共享句柄；其它应用从登记记录恢复
      let handle = res.localRootHandle;
      if (appName !== state.currentAppName || !handle) {
        handle = await getLocalHandleFromRecord(appName);
      }
      if (!handle) return;

      const sessions = [];
      const messages = {};
      const threads = {};
      for (const s of app.sessions || []) {
        sessions.push({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          duration: s.duration || 0,
        });
        const key = `chat:${appName}:${s.id}`;
        // 进行中的回合在内存桶里，优先取桶（与落盘内容一致）
        messages[s.id] = sessionBuckets.has(key)
          ? bucketFor(key).map((m) => ({ ...m }))
          : (await selfStore.getItem(key)) || [];
        threads[s.id] = (await selfStore.getItem(`thread:${appName}:${s.id}`)) || [];
      }
      await saveProjectChats(handle, {
        version: 1,
        app: { name: appName, displayName: app.displayName, icon: app.icon },
        sessionOrder: app.sessionOrder || null,
        sessions,
        messages,
        threads,
        savedAt: Date.now(),
        onlySid,
      });
    } catch (err) {
      console.warn("写入项目对话快照失败：", err);
    }
  }

  // 确保 mazmot apps[] 里存在指定应用的登记记录（本地渠道携带句柄）
  async function ensureAppRegistered(appName = state.currentAppName) {
    if (!mazmotStore || appName === "") return;
    try {
      const apps = (await mazmotStore.getItem("apps")) || [];
      const hit = apps.some(
        (a) => a.mazmot?.source === "ai-builder" && a.name === appName,
      );
      if (hit) return;
      const mode =
        appName === state.currentAppName ? state.currentAppMode : "vfs";
      const info = {
        appName,
        displayName:
          appName === state.currentAppName ? state.currentAppDisplay : appName,
        icon: appName === state.currentAppName ? state.currentAppIcon : "📦",
      };
      const isLocal = mode === "local" && !!res.localRootHandle;
      await registerAppRecord(
        mazmotStore,
        isLocal
          ? buildLocalAppRecord({ ...info, handle: res.localRootHandle })
          : buildAppRecord(info),
      );
    } catch (err) {
      console.warn("补登记应用记录失败：", err);
    }
  }

  return {
    getLocalHandleFromRecord,
    localChatsHandle,
    importLocalProject,
    syncLocalProjectChats,
    ensureAppRegistered,
  };
}
