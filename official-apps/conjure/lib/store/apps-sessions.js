/* ---------- 应用与会话生命周期 ----------
 * 应用/会话切换、会话增删改名与拖拽排序、应用删除、会话回收站、会话 fork。
 * registry（apps-registry）是会话元数据的持久化载体，读写经 state-core 的
 * loadRegistry / saveRegistry。
 */

import {
  detectInterruptedTurn,
  deleteVfsApp,
  unregisterAppRecord,
  trashProjectChat,
  restoreProjectChat,
  removeProjectTrashChat,
  readProjectTrashChat,
  truncateThread,
} from "../builder.js";

export function createAppsPart(api) {
  const {
    state,
    set,
    setMany,
    selfStore,
    res,
    loadRegistry,
    saveRegistry,
    sessionBuckets,
    bucketFor,
    viewKey,
    replaceMessages,
    projectBucket,
  } = api;

  // registry 变化后同步 currentApp* 展示字段与当前应用的会话列表
  function syncCurrentFromRegistry(reg) {
    const hit = reg.find((a) => a.name === state.currentAppName);
    if (state.currentAppName === "" || !hit) return;
    const sessions = [...(hit.sessions || [])]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // 手动拖拽排序：sessionOrder 里的 id 按登记顺序排；未登记（新建）的
    // 会话索引按 -1 处理，稳定排序下保持在最前、彼此按最近更新排列
    const order = hit.sessionOrder;
    if (Array.isArray(order) && order.length) {
      const idx = (s) => {
        const i = order.indexOf(s.id);
        return i === -1 ? -1 : i;
      };
      sessions.sort((a, b) => idx(a) - idx(b));
    }
    setMany({
      apps: reg,
      currentAppDisplay: hit.displayName || hit.name,
      currentAppIcon: hit.icon || "📦",
      currentAppMode: hit.mode || "vfs",
      // busy：该会话正处于流式回合中（左侧列表项 loading 图标）；
      // duration 为累计对话耗时（会话级统计，随快照持久化）
      currentAppSessions: sessions.map((s) => ({
        ...s,
        busy: res.turnKey === `chat:${state.currentAppName}:${s.id}`,
        duration: s.duration || 0,
      })),
      // 回收站：最近删除的排最前
      currentAppTrash: [...(hit.trash || [])].sort(
        (a, b) => (b.deletedAt || 0) - (a.deletedAt || 0),
      ),
    });
  }

  async function reloadApps() {
    const reg = await loadRegistry();
    syncCurrentFromRegistry(reg);
    if (reg !== state.apps) set("apps", reg);
    return reg;
  }

  async function applyApp(hit) {
    setMany({
      currentAppName: hit.name,
      currentAppDisplay: hit.displayName || hit.name,
      currentAppIcon: hit.icon || "📦",
      currentAppMode: hit.mode || "vfs",
      permGrantNeeded: false,
    });
    const reg = await loadRegistry();
    syncCurrentFromRegistry(reg);
    if (state.currentAppMode === "local") {
      res.localRootHandle = (await api.getLocalHandleFromRecord(hit.name)) || null;
      set("localDirLabel", res.localRootHandle?.name || "");
      if (!res.localRootHandle) {
        set("keyError", "本地目录授权已失效，发送消息时会重新选择目录。");
      } else if (!(await api.ensureLocalPermission(res.localRootHandle))) {
        // 刷新后权限重置且用户未授权：给出「授权目录」按钮主动补授权
        set("permGrantNeeded", true);
        set("keyError", "本地目录权限未授予，点击右侧按钮重新授权。");
      }
    } else {
      // 切到虚拟应用：本地句柄与相关提示一并清除
      res.localRootHandle = null;
      setMany({ localDirLabel: "", keyError: "" });
    }
    api.refreshPublishState(); // 发布态 + 与当前代码一致性（顶栏发布按钮 / 气泡用）
    api.refreshTests(); // 场景用例清单（测试抽屉 / 回合自动跑的存在性判断）
    api.restoreTestResults(); // 上次测试结果持久化还原
    api.invalidateAgent(); // 切换应用后重建 Agent（工具根目录随应用变化）
  }

  // 会话标题跟随 currentSessionId 从 registry 解析（顶栏展示用）
  function syncSessionTitle(reg = state.apps) {
    const hit = (reg || []).find((a) => a.name === state.currentAppName);
    const ses = hit?.sessions?.find((s) => s.id === state.currentSessionId);
    set("currentSessionTitle", state.currentSessionId && ses ? ses.title : "");
  }

  async function selectApp(name) {
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    await applyApp(hit);
    // 刷新备份清单（含每项 current 标记）：变更卡「备份代码」的已备份感知依赖它
    api.refreshBackups();
    const latest = [...(hit.sessions || [])].sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    )[0];
    if (latest) {
      await loadSessionById(latest.id, reg);
    } else {
      setMany({ currentSessionId: "", currentSessionTitle: "" });
      replaceMessages([]);
    }
  }

  async function loadSessionById(sid, reg) {
    if (!selfStore) return;
    const key = `chat:${state.currentAppName}:${sid}`;
    set("currentSessionId", sid);
    syncSessionTitle(reg);
    // 任务清单随会话切换加载：读盘 await 期间可能已切到别的会话，
    // 加载完成后核对目标仍是当前会话再应用（防过期清单覆盖新视图）
    const tasksKey = `tasks:${state.currentAppName}:${sid}`;
    const tasks = await api.loadSessionTasks(state.currentAppName, sid);
    if (api.sessionTasksKey() === tasksKey) set("sessionTasks", tasks);
    if (key === res.turnKey) {
      // 切回正在进行流式回合的会话：直接投影内存实时桶，
      // 不能读盘覆盖（盘上是上一回合的旧内容，读盘会顶掉进行中的消息）
      projectBucket(key);
      set("interrupted", false); // 回合还开着，谈不上中断
    } else {
      const saved = (await selfStore.getItem(key)) || [];
      // await 期间视图可能已被其他流程接管（回合收尾迁移草稿 / 自动切换
      // 应用）：目标已不是当前视图则放弃替换，避免过期 key 覆盖新视图
      if (key === viewKey()) {
        replaceMessages(saved, key);
        // 上次回合硬中断检测（刷新 / 崩溃没走收尾 finally → 末条无 turnMs），
        // driveTurn 开始时清除；切回进行中回合的分支已在上方置 false
        set("interrupted", detectInterruptedTurn(bucketFor(key)));
      }
    }
    api.invalidateAgent(); // 会话切换后重建 Agent（threadId 变化）
  }

  // 回到「新应用」草稿（写入目标重新可选）。新流程下草稿桶永远是空的
  // （用户一开口即建项目），历史遗留的草稿数据一律清除
  async function startDraft(wipeDraft = false) {
    res.freshTurn = null; // 离开项目上下文，未消费的首回合标记作废
    setMany({
      currentAppName: "",
      currentAppDisplay: "",
      currentAppIcon: "📦",
      currentAppMode: "vfs",
      currentAppSessions: [],
      currentAppTrash: [],
      currentSessionId: "",
      currentSessionTitle: "",
      sessionTasks: [], // 草稿没有会话实体，清单不可用
      permGrantNeeded: false,
      keyError: "", // 离开本地应用上下文，旧提示随之清除
      publishedInfo: null, // 回到草稿：发布态随应用上下文清空
      publishMatch: null,
      publishShareUrl: "",
      interrupted: false, // 草稿桶恒空，不存在中断回合
    });
    res.localRootHandle = null;
    set("localDirLabel", "");
    api.invalidateAgent();
    if (selfStore) {
      await selfStore.removeItem("chat:draft");
      await selfStore.removeItem("thread:draft");
      // 草稿回合进行中被整体清空：中断并丢弃实时桶，避免回合收尾复活已删内容
      if (res.turnKey === "chat:draft") {
        api.stop();
        sessionBuckets.delete("chat:draft");
      }
      replaceMessages([]);
    } else {
      replaceMessages([]);
    }
  }

  // 在当前应用下新建会话：立即登记一条「新对话」空会话，左侧马上出现标签；
  // 已存在未使用的空会话（点过 ＋ 还没发过消息）时只聚焦它，不重复建标签。
  // 占位标题在首条消息发出时由 prepareContext 换成首句摘要（回合收尾兜底）
  let creatingSession = false;
  async function newSessionFor(name) {
    if (creatingSession) return; // 连点防抖：登记是异步的，并发会建出多条空会话
    creatingSession = true;
    try {
      if (state.currentAppName !== name) {
        await selectApp(name);
      }
      const appName = state.currentAppName;
      if (!appName) return;
      // 未使用 = 无任何消息且不在对话中；内存桶优先，未加载的读盘确认
      for (const s of state.currentAppSessions) {
        if (s.busy) continue;
        const key = `chat:${appName}:${s.id}`;
        let empty;
        const bucket = sessionBuckets.get(key);
        if (bucket) {
          empty = bucket.length === 0;
        } else if (selfStore) {
          try {
            const saved = await selfStore.getItem(key);
            empty = !Array.isArray(saved) || saved.length === 0;
          } catch {
            empty = false; // 读盘失败按已使用处理：宁可多建标签，不误聚焦
          }
        } else {
          empty = true;
        }
        if (empty) {
          await loadSessionById(s.id);
          return;
        }
      }
      const reg = await loadRegistry();
      const hit = reg.find((a) => a.name === appName);
      if (!hit) return;
      const sid = `s${Date.now().toString(36)}`;
      hit.sessions = hit.sessions || [];
      hit.sessions.push({
        id: sid,
        title: "新对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await saveRegistry(reg);
      await reloadApps();
      set("currentSessionId", sid);
      syncSessionTitle(reg);
      set("sessionTasks", []); // 新会话从空清单开始
      replaceMessages([]);
      api.invalidateAgent();
    } finally {
      creatingSession = false;
    }
  }

  // 拖拽排序：把 fromId 的会话移到 toId 当前位置；顺序持久化到
  // registry 的 sessionOrder 字段（未登记的新会话按最近更新排在最前）
  async function reorderSessions(fromId, toId) {
    const name = state.currentAppName;
    if (!name || !fromId || fromId === toId) return;
    const ids = state.currentAppSessions.map((s) => s.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    hit.sessionOrder = ids;
    await saveRegistry(reg);
    syncCurrentFromRegistry(reg);
  }

  /* ---------- 删除 ---------- */

  async function deleteApp(name) {
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    try {
      // 虚拟渠道：连同载体目录一起删；本地渠道：保留盘上文件，仅移除登记
      if (api.fs && hit.mode !== "local") {
        await deleteVfsApp(api.fs, name);
      }
      if (api.mazmotStore) {
        await unregisterAppRecord(api.mazmotStore, name);
      }
      if (selfStore) {
        for (const s of hit.sessions || []) {
          await selfStore.removeItem(`chat:${name}:${s.id}`);
          await selfStore.removeItem(`thread:${name}:${s.id}`);
          // 应用下正在进行流式回合的会话：中断并丢弃实时桶（finishTurn 见桶
          // 不存在会跳过落盘，避免把已删除的会话内容复活写回）
          const key = `chat:${name}:${s.id}`;
          if (res.turnKey === key) {
            api.stop();
            sessionBuckets.delete(key);
          }
        }
        // 回收站里的会话一并清键（应用删除 = 不留任何会话数据）
        for (const t of hit.trash || []) {
          await selfStore.removeItem(`chat:${name}:${t.id}`);
          await selfStore.removeItem(`thread:${name}:${t.id}`);
        }
        await saveRegistry(reg.filter((a) => a.name !== name));
      }
    } catch (err) {
      set("keyError", `删除应用失败：${err.message}`);
      return;
    }
    const next = await reloadApps();
    if (state.currentAppName === name) {
      // 删除的是当前项目：项目标签由 window.open 打开，随项目一起关闭
      //（beforeunload 会广播 bye，其他标签立即撤掉「已打开」徽标）；
      // 关闭失败（入口直开 / 浏览器拦截）回退常规切换逻辑
      window.close();
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (window.closed) return;
    }
    if (next.length === 0) {
      // 所有应用已删光：回草稿并清空残留对话（含历史草稿消息与记忆）
      await startDraft(true);
    } else if (state.currentAppName === name) {
      // 当前应用被删：切到下一个应用
      await selectApp(next[0].name);
    }
  }

  // 重命名当前会话（registry 标题 + 左侧列表与顶栏展示同步刷新）
  async function renameSession(title) {
    const name = state.currentAppName;
    if (!name || !state.currentSessionId || !title) return;
    const reg = await loadRegistry();
    const ses = reg
      .find((a) => a.name === name)
      ?.sessions?.find((s) => s.id === state.currentSessionId);
    if (!ses) return;
    ses.title = title;
    ses.updatedAt = Date.now();
    await saveRegistry(reg);
    await reloadApps();
    set("currentSessionTitle", title);
  }

  /* ---------- 会话回收站 ----------
   * 删除的会话登记进 registry 的 trash 字段（元数据 + deletedAt + msgCount），
   * chat:/thread: 存储键保留（还原即恢复）；本地渠道的会话快照文件挪进
   * 项目目录的 conjure-chats-trash/（gitignore 不同步，仅本机保留）。
   */

  // 删除会话：进回收站（不直接销毁数据，可还原 / 彻底删除）
  async function deleteSession(sid) {
    const name = state.currentAppName;
    // 对话进行中的会话不允许删除（UI 已隐藏删除按钮，这里兜底）
    if (res.turnKey === `chat:${name}:${sid}`) return;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    const ses = (hit.sessions || []).find((s) => s.id === sid);
    if (!ses) return;
    hit.trash = hit.trash || [];
    hit.trash.unshift({
      ...ses,
      deletedAt: Date.now(),
      msgCount: ((await selfStore?.getItem(`chat:${name}:${sid}`)) || []).length,
    });
    hit.sessions = hit.sessions.filter((s) => s.id !== sid);
    if (Array.isArray(hit.sessionOrder)) {
      hit.sessionOrder = hit.sessionOrder.filter((id) => id !== sid);
    }
    await saveRegistry(reg);
    // 本地渠道：会话快照文件先挪进回收站目录，再全量同步（孤儿清理会删
    // conjure-chats/ 里不在册的文件，顺序反了快照就没了）
    const delApp = (await loadRegistry()).find((a) => a.name === name);
    if (delApp?.mode === "local") {
      const handle = await api.localChatsHandle(name);
      if (handle) await trashProjectChat(handle, sid);
      await api.syncLocalProjectChats(name);
    }
    // 删除的正是正在进行流式回合的会话：中断并丢弃实时桶，防止回合收尾复活它
    if (res.turnKey === `chat:${name}:${sid}`) {
      api.stop();
      sessionBuckets.delete(res.turnKey);
    }
    await reloadApps();
    if (state.currentSessionId === sid) {
      const latest = state.currentAppSessions[0];
      if (latest) {
        await loadSessionById(latest.id);
      } else {
        setMany({ currentSessionId: "", currentSessionTitle: "", sessionTasks: [] });
        replaceMessages([]);
      }
    }
  }

  // 还原回收站会话：登记回 sessions、本地快照文件挪回 conjure-chats/，
  // 成功后切换到该会话
  async function restoreTrashedSession(sid) {
    const name = state.currentAppName;
    if (!name) return;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    const idx = (hit.trash || []).findIndex((t) => t.id === sid);
    if (idx === -1) return;
    const { deletedAt, msgCount, ...ses } = hit.trash[idx];
    hit.trash.splice(idx, 1);
    hit.sessions = hit.sessions || [];
    if (!hit.sessions.some((s) => s.id === sid)) hit.sessions.push(ses);
    await saveRegistry(reg);
    const app = (await loadRegistry()).find((a) => a.name === name);
    if (app?.mode === "local") {
      const handle = await api.localChatsHandle(name);
      if (handle) await restoreProjectChat(handle, sid);
      await api.syncLocalProjectChats(name);
    }
    await reloadApps();
    await loadSessionById(sid);
  }

  // 彻底删除回收站会话：清存储键 + 删本地快照文件 + 移出登记
  async function purgeTrashedSession(sid) {
    const name = state.currentAppName;
    if (!name) return;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    hit.trash = (hit.trash || []).filter((t) => t.id !== sid);
    await saveRegistry(reg);
    if (selfStore) {
      await selfStore.removeItem(`chat:${name}:${sid}`);
      await selfStore.removeItem(`thread:${name}:${sid}`);
    }
    const app = (await loadRegistry()).find((a) => a.name === name);
    if (app?.mode === "local") {
      const handle = await api.localChatsHandle(name);
      if (handle) await removeProjectTrashChat(handle, sid);
    }
    await reloadApps();
  }

  // 清空当前应用的回收站
  async function emptyTrash() {
    const name = state.currentAppName;
    if (!name) return;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    const ids = (hit.trash || []).map((t) => t.id);
    if (!ids.length) return;
    hit.trash = [];
    await saveRegistry(reg);
    if (selfStore) {
      for (const sid of ids) {
        await selfStore.removeItem(`chat:${name}:${sid}`);
        await selfStore.removeItem(`thread:${name}:${sid}`);
      }
    }
    const app = (await loadRegistry()).find((a) => a.name === name);
    if (app?.mode === "local") {
      const handle = await api.localChatsHandle(name);
      if (handle) {
        for (const sid of ids) await removeProjectTrashChat(handle, sid);
      }
    }
    await reloadApps();
  }

  // 读取回收站会话的消息（对话详情查看）：优先存储键，本地渠道回落项目
  // 回收站目录的快照文件（浏览器存储被清但项目目录还在的兜底）
  async function readTrashedMessages(sid) {
    const name = state.currentAppName;
    if (!name) return [];
    if (selfStore) {
      const msgs = await selfStore.getItem(`chat:${name}:${sid}`);
      if (Array.isArray(msgs)) return msgs;
    }
    const app = (await loadRegistry()).find((a) => a.name === name);
    if (app?.mode === "local") {
      const handle = await api.localChatsHandle(name);
      if (handle) {
        const one = await readProjectTrashChat(handle, sid);
        if (Array.isArray(one?.messages)) return one.messages;
      }
    }
    return [];
  }

  /* ---------- 会话 fork（分支） ---------- */

  // 从当前会话的某条消息处 fork：新会话复制截至该消息（含）的聊天记录，
  // Agent 记忆按完整回合截断复制；成功后切换到新会话。草稿与发送中不支持。
  // fork 共用尾段：登记新会话（titleMark 标注后缀）→ 复制聊天桶与 Agent 记忆
  //（按 kept 内完整回合数截断）→ 刷新列表并切换到新会话；返回新会话 id
  async function forkTo(name, srcSid, kept, titleMark) {
    const reg = await loadRegistry();
    const app = reg.find((a) => a.name === name);
    if (!app) return null;
    const baseTitle =
      app.sessions?.find((s) => s.id === srcSid)?.title ||
      (kept.find((m) => m.role === "user")?.content || "").slice(0, 24) ||
      "新对话";
    const sid = `s${Date.now().toString(36)}`;
    app.sessions = app.sessions || [];
    app.sessions.push({
      id: sid,
      title: `${baseTitle} ${titleMark}`.slice(0, 40),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await saveRegistry(reg);

    const dstKey = `chat:${name}:${sid}`;
    sessionBuckets.set(dstKey, kept);
    await selfStore.setItem(dstKey, kept.map((m) => ({ ...m })));

    const userTurns = kept.filter((m) => m.role === "user").length;
    const srcThread = (await selfStore.getItem(`thread:${name}:${srcSid}`)) || [];
    await selfStore.setItem(
      `thread:${name}:${sid}`,
      truncateThread(srcThread, userTurns),
    );
    // 任务清单随 fork 复制（fork 延续的是同一份工作，清单照抄）

    const srcTasks = await selfStore.getItem(`tasks:${name}:${srcSid}`);
    if (Array.isArray(srcTasks) && srcTasks.length) {
      await selfStore.setItem(
        `tasks:${name}:${sid}`,
        srcTasks.map((t) => ({ ...t })),
      );
    }

    await reloadApps();
    await loadSessionById(sid, state.apps);
    return sid;
  }

  async function forkSession(fromMessageId) {
    if (!selfStore || state.sending) return;
    const name = state.currentAppName;
    const srcSid = state.currentSessionId;
    if (!name || !srcSid) return; // 草稿没有会话实体，fork 无从谈起
    const bucket = bucketFor(`chat:${name}:${srcSid}`);
    const idx = bucket.findIndex((m) => m.id === fromMessageId);
    if (idx < 0) return;
    const kept = bucket.slice(0, idx + 1).map((m) => ({ ...m }));
    await forkTo(name, srcSid, kept, "⎇");
  }

  return {
    syncCurrentFromRegistry,
    reloadApps,
    applyApp,
    syncSessionTitle,
    selectApp,
    loadSessionById,
    startDraft,
    newSessionFor,
    reorderSessions,
    deleteApp,
    renameSession,
    deleteSession,
    restoreTrashedSession,
    purgeTrashedSession,
    emptyTrash,
    readTrashedMessages,
    forkTo,
    forkSession,
  };
}
