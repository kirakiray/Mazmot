// AI 应用生成器运行时状态仓库
// 把「AI 创作 / 运行过程」的全部业务逻辑（Agent 编排、应用与会话管理、
// 写入目标与本地句柄、消息流水线、持久化）从页面模块抽离为独立可观察对象。
// 页面只通过 subscribe 观察状态变化来更新视觉数据，所有变更必须走仓库方法。
//
// 可观察约定（subscribe 回调收到的事件）：
// 1. { type: "patch", data }        —— state 标量 / 整组数据的更新（data 为键值对）
// 2. { type: "messages", op, ... }  —— 消息流水线的细粒度变更：
//    op: "replace"（带 list，整组替换）/ "push"（带 item）/ "patch"（带 id, patch）/ "splice"（带 id）
//
// 注意：FileSystemDirectoryHandle 等类实例句柄不进 state（响应式包装会拆掉
// 原型），由仓库闭包变量持有，对外只暴露行为方法。

import {
  NAMESPACE,
  buildRunUrl,
  buildAppRecord,
  buildLocalAppRecord,
  buildSystemPrompt,
  validateApp,
  registerAppRecord,
  unregisterAppRecord,
  deleteVfsApp,
  sanitizeAppName,
} from "./builder.js";
import { createTools } from "./tools/index.js";
import {
  syncSkills,
  loadSkillIndex,
  readSkillFile,
} from "./skill-sync.js";

const REGISTRY_KEY = "apps-registry";

export function createBuilderStore({ fs, mazmotStore, selfStore, load }) {
  /* ---------- 可观察 state 与事件 ---------- */

  const state = {
    // 消息与发送
    messages: [],
    sending: false,
    nextId: 1,
    keyError: "",
    coreError: "",
    // 应用与会话
    apps: [],
    currentAppName: "", // "" = 新应用草稿
    currentAppDisplay: "",
    currentAppIcon: "📦",
    currentAppMode: "vfs",
    currentAppSessions: [],
    currentSessionId: "",
    currentSessionTitle: "", // 当前会话标题（顶栏展示；草稿/无会话为空）
    // 写入目标（草稿阶段偏好）
    storageMode: "vfs",
    localDirLabel: "",
    permGrantNeeded: false,
    // 技能知识库索引
    skills: [],
  };

  const listeners = new Set();
  const emitPatch = (data) => listeners.forEach((f) => f({ type: "patch", data }));
  const set = (key, value) => {
    state[key] = value;
    emitPatch({ [key]: value });
  };
  const setMany = (patch) => {
    Object.assign(state, patch);
    emitPatch(patch);
  };

  /* ---------- 消息流水线（内部 plain 数组 + 细粒度事件） ---------- */

  const msgEvent = (evt) => listeners.forEach((f) => f({ type: "messages", ...evt }));

  function pushMessage(item) {
    state.messages.push(item);
    msgEvent({ op: "push", item });
    return item;
  }
  function patchMessage(id, patch) {
    const item = state.messages.find((m) => m.id === id);
    if (!item) return;
    Object.assign(item, patch);
    msgEvent({ op: "patch", id, patch });
  }
  function removeMessage(id) {
    const idx = state.messages.findIndex((m) => m.id === id);
    if (idx > -1) {
      state.messages.splice(idx, 1);
      msgEvent({ op: "splice", id });
    }
  }
  function replaceMessages(list) {
    state.messages = (list || []).map((m) => ({
      ...m,
      pending: false,
      open: false,
    }));
    state.nextId =
      state.messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
    msgEvent({ op: "replace", list: state.messages });
  }

  /* ---------- 内部可变资源（非响应式） ---------- */

  let agent = null;
  let activeBubble = null;
  // 本轮对话生成的应用（create_app 工具回调写入），回合结束后校验并出卡片
  let pendingNewApp = null;
  // 本地目录渠道的根目录句柄（挂载后的 DirHandle），非响应式
  let localRootHandle = null;
  // 技能索引（plain 数组，对外经 state.skills 同步）
  let skillIndex = [];
  // /mz/ai 模块与 checkpointer 惰性产物
  let aiModules = null;
  let chainModules = null;
  let checkpointer = null;

  /* ---------- 持久化辅助 ---------- */

  const loadRegistry = async () =>
    selfStore ? ((await selfStore.getItem(REGISTRY_KEY)) ?? []) : [];
  const saveRegistry = async (reg) => {
    if (selfStore) await selfStore.setItem(REGISTRY_KEY, reg);
  };

  // 从 mazmot apps[] 记录恢复本地目录句柄（local 渠道跨会话复用，无需重新 open）
  const getLocalHandleFromRecord = async (appName) => {
    if (!mazmotStore) return null;
    const apps = (await mazmotStore.getItem("apps")) || [];
    const rec = apps.find(
      (a) =>
        a.mazmot?.source === "ai-builder" &&
        a.source === "local" &&
        a.name === sanitizeAppName(appName),
    );
    return rec?.handle || null;
  };

  const prettyArgs = (raw) => {
    try {
      const obj = JSON.parse(raw);
      const text = Object.entries(obj)
        .map(([k, v]) => {
          const vText = String(v);
          return `${k} = ${vText.length > 60 ? vText.slice(0, 60) + "…" : vText}`;
        })
        .join("，");
      return text || raw;
    } catch {
      return raw;
    }
  };

  /* ---------- Agent ---------- */

  const pickAssistant = async () => {
    // 代码生成优先用 deepseek-v4-flash，其余随机负载均衡
    const { getAssistant, getApiKeys } = aiModules;
    try {
      const deepseekKey = getApiKeys().find((k) => k.provider === "deepseek");
      if (deepseekKey) {
        return { assistant: getAssistant(deepseekKey.id), model: "deepseek-v4-flash" };
      }
    } catch {
      /* 无 key 时 getAssistant 稍后统一报错 */
    }
    return { assistant: getAssistant(), model: undefined };
  };

  async function ensureAgent() {
    if (agent) return agent;
    if (!aiModules) {
      aiModules = await load("/mz/ai/main.js");
    }
    if (!chainModules) {
      chainModules = await load("/mz/ai/chain/main.js");
    }
    if (!checkpointer) {
      checkpointer = selfStore
        ? {
            async get(threadId) {
              return (await selfStore.getItem(`thread:${threadId}`)) ?? [];
            },
            async set(threadId, messages) {
              await selfStore.setItem(`thread:${threadId}`, messages);
            },
            async delete(threadId) {
              await selfStore.removeItem(`thread:${threadId}`);
            },
          }
        : new chainModules.MemorySaver();
    }

    const { assistant, model } = await pickAssistant();
    // 写入目标：已选应用随应用记录锁定；草稿阶段跟随目标偏好
    const useLocal =
      state.currentAppName !== ""
        ? state.currentAppMode === "local"
        : state.storageMode === "local" && !!localRootHandle;
    const lockedMode =
      state.currentAppName !== "" ? state.currentAppMode : state.storageMode;
    const tools = createTools({
      tool: chainModules.tool,
      fs,
      rootHandle: useLocal ? localRootHandle : undefined,
      onAppCreated: (info) => {
        pendingNewApp = { ...info, mode: lockedMode };
      },
      readSkill: (id, path) => readSkillFile(fs, id, path),
    });
    agent = chainModules.createAgent({
      assistant,
      ...(model ? { model } : {}),
      tools: Object.values(tools),
      // 注入当前应用上下文：已选应用时强制模型先读文件再回答/修改；
      // 同时列出可用技能知识库（read_skill）
      systemPrompt: buildSystemPrompt({
        appName: state.currentAppName || undefined,
        displayName: state.currentAppDisplay || undefined,
        mode: state.currentAppMode,
        skills: skillIndex,
      }),
      checkpointer,
    });
    return agent;
  }

  function invalidateAgent() {
    agent = null;
  }

  /* ---------- 技能知识库 ---------- */

  // 后台任务：按技能源清单下载安装到 VFS skills 空间（zip / 裸 SKILL.md），
  // 同内容（sha256 一致）跳过写入；离线或单个失败保留已有副本不影响使用
  async function backgroundSyncSkills() {
    try {
      const { changed } = await syncSkills({ fs, storage: selfStore });
      if (changed) {
        skillIndex = await loadSkillIndex(fs);
        set("skills", [...skillIndex]);
        invalidateAgent(); // 提示词中的技能清单随之更新
      }
    } catch (err) {
      console.warn("技能后台同步失败：", err);
    }
  }

  /* ---------- 应用 / 会话切换 ---------- */

  // registry 变化后同步 currentApp* 展示字段与当前应用的会话列表
  function syncCurrentFromRegistry(reg) {
    const hit = reg.find((a) => a.name === state.currentAppName);
    if (state.currentAppName === "" || !hit) return;
    setMany({
      apps: reg,
      currentAppDisplay: hit.displayName || hit.name,
      currentAppIcon: hit.icon || "📦",
      currentAppMode: hit.mode || "vfs",
      currentAppSessions: [...(hit.sessions || [])].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
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
      localRootHandle = (await getLocalHandleFromRecord(hit.name)) || null;
      set("localDirLabel", localRootHandle?.name || "");
      if (!localRootHandle) {
        set("keyError", "本地目录授权已失效，发送消息时会重新选择目录。");
      } else if (!(await ensureLocalPermission(localRootHandle))) {
        // 刷新后权限重置且用户未授权：给出「授权目录」按钮主动补授权
        set("permGrantNeeded", true);
        set("keyError", "本地目录权限未授予，点击右侧按钮重新授权。");
      }
    } else {
      // 切到虚拟应用：本地句柄与相关提示一并清除
      localRootHandle = null;
      setMany({ localDirLabel: "", keyError: "" });
    }
    invalidateAgent(); // 切换应用后重建 Agent（工具根目录随应用变化）
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
    const saved = (await selfStore.getItem(key)) || [];
    set("currentSessionId", sid);
    syncSessionTitle(reg);
    replaceMessages(saved);
    invalidateAgent(); // 会话切换后重建 Agent（threadId 变化）
  }

  // 回到「新应用」草稿（写入目标重新可选）；
  // wipeDraft = true 时连历史草稿一起清空（删光所有应用后的全新开始）
  async function startDraft(wipeDraft = false) {
    setMany({
      currentAppName: "",
      currentAppDisplay: "",
      currentAppIcon: "📦",
      currentAppMode: "vfs",
      currentAppSessions: [],
      currentSessionId: "",
      currentSessionTitle: "",
      permGrantNeeded: false,
      keyError: "", // 离开本地应用上下文，旧提示随之清除
    });
    localRootHandle = null;
    set("localDirLabel", "");
    invalidateAgent();
    if (selfStore) {
      if (wipeDraft) {
        await selfStore.removeItem("chat:draft");
        await selfStore.removeItem("thread:draft");
        replaceMessages([]);
      } else {
        const draft = (await selfStore.getItem("chat:draft")) || [];
        replaceMessages(Array.isArray(draft) ? draft : []);
      }
    } else {
      replaceMessages([]);
    }
  }

  // 在当前应用下新建会话
  async function newSessionFor(name) {
    if (state.currentAppName !== name) {
      await selectApp(name);
    }
    setMany({ currentSessionId: "", currentSessionTitle: "" });
    replaceMessages([]);
    invalidateAgent();
  }

  /* ---------- 写入目标（仅草稿阶段） ---------- */

  async function selectMode(mode) {
    if (state.storageMode === mode) return;
    if (mode === "local" && !localRootHandle) {
      const ok = await chooseLocalDir();
      if (ok) {
        set("storageMode", mode);
        invalidateAgent(); // 工具根目录随目标变化
      }
      return;
    }
    set("storageMode", mode);
    invalidateAgent();
  }

  // 确认句柄的读写权限：已授权直接通过；仅剩 prompt 状态则借助用户手势
  // requestPermission 补授权（刷新后句柄仍在但权限重置的场景）；被拒/异常返回 false
  async function ensureLocalPermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return false;
    }
    const opts = { mode: "readwrite" };
    try {
      if ((await handle.queryPermission(opts)) === "granted") {
        return true;
      }
      if ((await handle.requestPermission(opts)) !== "granted") {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // 「授权目录」：主动补授权本地句柄（需在用户手势调用链内 requestPermission）
  async function grantLocalPermission() {
    if (!localRootHandle) {
      set("permGrantNeeded", false);
      return;
    }
    if (await ensureLocalPermission(localRootHandle)) {
      setMany({ keyError: "", permGrantNeeded: false });
    } else {
      set("keyError", "授权未完成，可再次点击授权，或重新选择目录。");
    }
  }

  // fs.open() 打开本地目录选择器（仅 Chrome 支持），成功返回 true；
  // 用户取消（AbortError）静默返回 false，不算失败
  async function chooseLocalDir() {
    if (!fs || typeof fs.open !== "function") {
      set(
        "keyError",
        "当前环境不支持本地目录选择（fs.open 仅 Chrome 可用），请使用「虚拟系统」渠道。",
      );
      return false;
    }
    try {
      let handle = await fs.open();
      if (!handle) return false; // 用户取消
      // nos-storage 按路径引用存句柄：open() 的本地目录必须先 mount()，
      // 否则登记记录写 mazmot apps[] 时 setItem 直接抛错（句柄存不进去）
      if (typeof fs.mount === "function") {
        try {
          handle = await fs.mount(handle);
        } catch (err) {
          set("keyError", `挂载本地目录失败：${err.message}`);
          return false;
        }
      }
      localRootHandle = handle;
      setMany({
        localDirLabel: handle.name || "本地目录",
        keyError: "",
        permGrantNeeded: false,
      });
      // 旧应用补救：已登记的本地应用记录可能缺失句柄（mount 修复前
      // 入库失败），重选目录后把新挂载句柄写回登记记录
      if (
        mazmotStore &&
        state.currentAppName !== "" &&
        state.currentAppMode === "local"
      ) {
        try {
          await registerAppRecord(
            mazmotStore,
            buildLocalAppRecord({
              name: state.currentAppName,
              displayName: state.currentAppDisplay,
              icon: state.currentAppIcon,
              handle,
            }),
          );
        } catch (err) {
          console.warn("更新应用登记句柄失败：", err);
        }
      }
      return true;
    } catch (err) {
      if (err?.name === "AbortError") return false; // 用户关闭选择器
      set("keyError", `选择本地目录失败：${err.message}`);
      return false;
    }
  }

  /* ---------- 删除 ---------- */

  async function deleteApp(name) {
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    try {
      // 虚拟渠道：连同载体目录一起删；本地渠道：保留盘上文件，仅移除登记
      if (fs && hit.mode !== "local") {
        await deleteVfsApp(fs, name);
      }
      if (mazmotStore) {
        await unregisterAppRecord(mazmotStore, name);
      }
      if (selfStore) {
        for (const s of hit.sessions || []) {
          await selfStore.removeItem(`chat:${name}:${s.id}`);
          await selfStore.removeItem(`thread:${name}:${s.id}`);
        }
        await saveRegistry(reg.filter((a) => a.name !== name));
      }
    } catch (err) {
      set("keyError", `删除应用失败：${err.message}`);
      return;
    }
    const next = await reloadApps();
    if (next.length === 0) {
      // 所有应用已删光：回草稿并清空残留对话（含历史草稿消息与记忆）
      await startDraft(true);
    } else if (state.currentAppName === name) {
      // 当前应用被删：切到下一个应用
      await selectApp(next[0].name);
    }
  }

  async function deleteSession(sid) {
    const name = state.currentAppName;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    hit.sessions = (hit.sessions || []).filter((s) => s.id !== sid);
    await saveRegistry(reg);
    if (selfStore) {
      await selfStore.removeItem(`chat:${name}:${sid}`);
      await selfStore.removeItem(`thread:${name}:${sid}`);
    }
    await reloadApps();
    if (state.currentSessionId === sid) {
      const latest = state.currentAppSessions[0];
      if (latest) {
        await loadSessionById(latest.id);
      } else {
        setMany({ currentSessionId: "", currentSessionTitle: "" });
        replaceMessages([]);
      }
    }
  }

  /* ---------- 预览 ---------- */

  function openApp(appName, mode) {
    const name = sanitizeAppName(appName);
    if (!name) return;
    if (mode === "local") {
      openLocalApp(name);
      return;
    }
    window.open(buildRunUrl(name), `mazmot-app-${name}`);
  }

  // 本地目录应用：所选目录即项目根，直接挂载该目录打开
  // （app-runner 的 getRunUrl 本地逻辑会挂载 client/，不存在时回退挂载根目录）
  async function openLocalApp(name) {
    if (!localRootHandle) {
      const fromRecord = await getLocalHandleFromRecord(name);
      if (fromRecord) {
        localRootHandle = fromRecord;
        set("localDirLabel", localRootHandle?.name || "");
      }
    }
    if (localRootHandle) {
      // 刷新后权限重置：requestPermission 补授权，失败回退重选
      const granted = await ensureLocalPermission(localRootHandle);
      if (!granted) {
        const ok = await chooseLocalDir();
        if (!ok) return;
      }
    } else {
      const ok = await chooseLocalDir();
      if (!ok) return;
    }
    try {
      const { getRunUrl } = await load("/mz/app-runner.js");
      const url = await getRunUrl({
        source: "local",
        _handle: localRootHandle,
      });
      window.open(url, `mazmot-app-${name}`);
    } catch (err) {
      set("keyError", `打开应用失败：${err.message}`);
    }
  }

  /* ---------- 消息流水线（流式事件 → 消息变更） ---------- */

  function newBubble() {
    const item = pushMessage({
      id: state.nextId++,
      role: "assistant",
      content: "",
      newGroup: false,
    });
    activeBubble = item;
    return item;
  }

  function handleStreamEvent(ev) {
    if (ev.type === "text" && ev.delta) {
      const bubble = activeBubble ?? newBubble();
      bubble.content += ev.delta;
      patchMessage(bubble.id, { content: bubble.content });
    } else if (ev.type === "toolCalls") {
      if (activeBubble && !activeBubble.content) {
        removeMessage(activeBubble.id);
      }
      activeBubble = null;
      for (const call of ev.toolCalls) {
        const args = call.function?.arguments ?? call.args ?? "{}";
        pushMessage({
          id: state.nextId++,
          role: "tool",
          name: call.function?.name ?? call.name,
          args,
          summary: prettyArgs(args),
          result: "",
          pending: true,
          open: false,
          newGroup: false,
          toolCallId: call.id,
        });
      }
    } else if (ev.type === "toolResult") {
      const item = state.messages.find((m) => m.toolCallId === ev.toolCallId);
      if (item) {
        item.result = ev.result;
        item.pending = false;
        patchMessage(item.id, { result: ev.result, pending: false });
      }
    } else if (ev.type === "done") {
      if (activeBubble) {
        if (ev.content) {
          activeBubble.content = ev.content;
          patchMessage(activeBubble.id, { content: ev.content });
        }
      } else if (ev.content) {
        newBubble().content = ev.content;
      }
    }
  }

  /* ---------- 发送与回合收尾 ---------- */

  // 发送前确保落点就绪：草稿需本地句柄；已选应用需会话（无则自动新建）
  async function prepareContext(text) {
    if (state.currentAppName === "") {
      if (state.storageMode === "local" && !localRootHandle) {
        const ok = await chooseLocalDir();
        if (!ok) {
          set("storageMode", "vfs");
          invalidateAgent();
        }
      }
      return "draft";
    }
    if (state.currentSessionId === "") {
      const reg = await loadRegistry();
      const hit = reg.find((a) => a.name === state.currentAppName);
      if (!hit) throw new Error("当前应用记录已不存在");
      const sid = `s${Date.now().toString(36)}`;
      hit.sessions = hit.sessions || [];
      hit.sessions.push({
        id: sid,
        title: text.slice(0, 24) || "新对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await saveRegistry(reg);
      await reloadApps();
      set("currentSessionId", sid);
      syncSessionTitle();
    }
    // 本地渠道句柄可能因切换应用 / 刷新丢失，从记录恢复；
    // 句柄还在时先尝试补授权（requestPermission），失败才回退重选目录
    if (state.currentAppMode === "local") {
      if (!localRootHandle) {
        localRootHandle = await getLocalHandleFromRecord(
          state.currentAppName,
        );
        if (localRootHandle) {
          set("localDirLabel", localRootHandle?.name || "");
        }
      }
      if (localRootHandle) {
        const granted = await ensureLocalPermission(localRootHandle);
        if (!granted) {
          const ok = await chooseLocalDir();
          if (!ok) throw new Error("本地目录不可用，无法继续开发");
        }
      } else {
        const ok = await chooseLocalDir();
        if (!ok) throw new Error("本地目录不可用，无法继续开发");
      }
      invalidateAgent(); // 工具闭包需要新句柄
    }
    return `${state.currentAppName}:${state.currentSessionId}`;
  }

  // 回合收尾：落盘会话、（若本轮创建了应用）迁移草稿 → 注册 → 出预览卡片
  async function finishTurn(firstUserText, threadId) {
    if (!selfStore) return;
    const plain = state.messages.map((m) => ({ ...m }));

    // 本轮创建了新应用：草稿会话迁移为该应用的第一个会话
    if (pendingNewApp) {
      const info = pendingNewApp;
      pendingNewApp = null;
      await adoptNewApp(info, firstUserText, plain);
      return;
    }

    const chatKey =
      state.currentAppName === ""
        ? "chat:draft"
        : `chat:${state.currentAppName}:${state.currentSessionId}`;
    await selfStore.setItem(chatKey, plain);

    // 更新会话标题与时间
    if (state.currentAppName !== "" && state.currentSessionId) {
      const reg = await loadRegistry();
      const app = reg.find((a) => a.name === state.currentAppName);
      const ses = app?.sessions?.find(
        (s) => s.id === state.currentSessionId,
      );
      if (ses) {
        if (!ses.title || ses.title === "新对话") {
          ses.title = firstUserText.slice(0, 24) || "新对话";
        }
        ses.updatedAt = Date.now();
        await saveRegistry(reg);
        await reloadApps();
        syncSessionTitle();
      }
      // 兜底：记录缺失（历史会话/旧版本创建）时补登记，保证句柄可恢复
      await ensureAppRegistered();
    }
  }

  // 确保 mazmot apps[] 里存在当前应用的登记记录（本地渠道携带句柄）
  async function ensureAppRegistered() {
    if (!mazmotStore || state.currentAppName === "") return;
    try {
      const apps = (await mazmotStore.getItem("apps")) || [];
      const hit = apps.some(
        (a) =>
          a.mazmot?.source === "ai-builder" &&
          a.name === state.currentAppName,
      );
      if (hit) return;
      const info = {
        appName: state.currentAppName,
        displayName: state.currentAppDisplay,
        icon: state.currentAppIcon,
      };
      const isLocal = state.currentAppMode === "local" && !!localRootHandle;
      await registerAppRecord(
        mazmotStore,
        isLocal
          ? buildLocalAppRecord({ ...info, handle: localRootHandle })
          : buildAppRecord(info),
      );
    } catch (err) {
      console.warn("补登记应用记录失败：", err);
    }
  }

  // 新应用落地：注册（mazmot apps[] + 本应用 registry）、迁移草稿会话、出预览卡片
  async function adoptNewApp(info, firstUserText, plainMessages) {
    const isLocal = info.mode === "local" && !!localRootHandle;
    const check = await validateApp(
      fs,
      info.appName,
      isLocal ? localRootHandle : undefined,
    );

    // 创建即登记（不等文件齐全）：本地句柄必须随记录尽早落库，
    // 否则刷新后无法恢复授权、被迫重新选择目录
    if (mazmotStore) {
      try {
        await registerAppRecord(
          mazmotStore,
          isLocal
            ? buildLocalAppRecord({ ...info, handle: localRootHandle })
            : buildAppRecord(info),
        );
      } catch (err) {
        console.warn("登记应用记录失败：", err);
      }
    }

    // registry + 第一个会话；草稿消息与 Agent 记忆迁移过去
    const reg = await loadRegistry();
    const sid = `s${Date.now().toString(36)}`;
    const existed = reg.find((a) => a.name === info.appName);
    const session = {
      id: sid,
      title: firstUserText.slice(0, 24) || "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (existed) {
      existed.sessions = existed.sessions || [];
      existed.sessions.push(session);
    } else {
      reg.push({
        name: info.appName,
        displayName: info.displayName,
        icon: info.icon,
        mode: isLocal ? "local" : "vfs",
        createdAt: Date.now(),
        sessions: [session],
      });
    }
    await saveRegistry(reg);

    if (selfStore) {
      const oldChat = (await selfStore.getItem("chat:draft")) ?? plainMessages;
      await selfStore.setItem(`chat:${info.appName}:${sid}`, oldChat);
      await selfStore.removeItem("chat:draft");
      const oldThread = await selfStore.getItem("thread:draft");
      if (oldThread) {
        await selfStore.setItem(`thread:${info.appName}:${sid}`, oldThread);
        await selfStore.removeItem("thread:draft");
      }
    }

    // 切换到新应用上下文（目标随应用锁定）
    await applyApp(reg.find((a) => a.name === info.appName));
    set("currentSessionId", sid);
    syncSessionTitle(reg);

    pushMessage({
      id: state.nextId++,
      role: "app",
      appName: info.appName,
      displayName: info.displayName,
      icon: info.icon,
      mode: isLocal ? "local" : "vfs",
      ready: check.ready,
      missing: check.missing,
      newGroup: false,
    });
  }

  // 发送主流程：落点准备 → 用户消息入列 → Agent 流式对话 → 回合收尾
  // currentAbort：本轮的中止信号；stop() 触发后 Agent 对话被中断，
  // 已产生的流式内容保留，回合照常收尾落盘（下次发送继续同一 thread）
  let currentAbort = null;

  async function send(text) {
    if (state.sending) return;
    if (!fs) {
      set("keyError", state.coreError);
      return;
    }

    let threadId;
    try {
      threadId = await prepareContext(text);
    } catch (err) {
      set("keyError", err.message);
      return;
    }

    setMany({ keyError: "" });
    pushMessage({
      id: state.nextId++,
      role: "user",
      content: text,
      newGroup: true,
    });

    try {
      await ensureAgent();
    } catch {
      set(
        "keyError",
        "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
      );
      return;
    }

    set("sending", true);
    activeBubble = null;
    currentAbort = { stopped: false };
    const abort = currentAbort;
    try {
      await agent.chat({
        messages: [{ role: "user", content: text }],
        threadId,
        stream: true,
        onStream: (ev) => {
          if (abort.stopped) throw new Error("已停止生成");
          handleStreamEvent(ev);
        },
      });
    } catch (error) {
      if (!abort.stopped) {
        const bubble = activeBubble ?? newBubble();
        bubble.content +=
          (bubble.content ? "\n\n" : "") + `出错了：${error.message}`;
        patchMessage(bubble.id, { content: bubble.content });
      }
    } finally {
      activeBubble = null;
      currentAbort = null;
      set("sending", false);
      await finishTurn(text, threadId);
    }
  }

  // 停止当前生成：中断流式回调链，已生成内容保留并照常落盘
  function stop() {
    if (currentAbort) currentAbort.stopped = true;
  }

  /* ---------- 初始化 ---------- */

  // initialApp：URL ?p= 带入的项目名。项目标签按名恢复（并打开最近会话）；
  // 无 p 参数 = 草稿标签（新项目），恢复 chat:draft（切换/新建项目由页面
  // 在新标签页打开，本标签不再承担跳转）
  async function init({ initialApp = "" } = {}) {
    if (!fs) {
      set(
        "coreError",
        "NoneOS Core 未就绪：无法写入文件系统，请从 Mazmot 主系统打开本应用。",
      );
    }
    await reloadApps();

    if (initialApp) {
      const hit = state.apps.find((a) => a.name === initialApp);
      if (hit) {
        await selectApp(hit.name);
      } else {
        set("keyError", `项目 ${initialApp} 不存在，已回到新项目草稿。`);
        await startDraft();
      }
    } else {
      await startDraft();
    }
    // 先读一次已安装索引（VFS skills 空间）让「技能」列表立即有数据，
    // 再后台增量同步；同步无变化（changed=false）时索引早已就位
    if (fs) {
      try {
        skillIndex = await loadSkillIndex(fs);
        set("skills", [...skillIndex]);
      } catch (err) {
        console.warn("加载技能索引失败：", err);
      }
      backgroundSyncSkills();
    }
  }

  /* ---------- 对外接口 ---------- */

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // 事件
    init,
    send,
    stop,
    reloadApps,
    selectApp,
    startDraft,
    newSessionFor,
    loadSession: loadSessionById,
    deleteApp,
    deleteSession,
    selectMode,
    chooseLocalDir,
    grantLocalPermission,
    openApp,
    toggleTool(id) {
      const item = state.messages.find((m) => m.id === id);
      if (item) {
        item.open = !item.open;
        patchMessage(id, { open: item.open });
      }
    },
    // 本地句柄查询（预览等 UI 场景只读使用；句柄不进 state）
    getLocalHandle() {
      return localRootHandle;
    },
  };
}
