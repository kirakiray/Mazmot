// 妙造运行时状态仓库
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
  listAppFiles,
  readAppFile,
  createAppBackup,
  listAppBackups,
  deleteAppBackup,
  renameAppBackup,
  setBackupNote,
  restoreAppBackup,
  currentAppHash,
  currentAppFiles,
  readBackupFiles,
  detectLocalProject,
  loadProjectChats,
  saveProjectChats,
  truncateThread,
  tailThread,
  contextInfo,
  MODEL_OPTIONS,
  COMPACTION_PROMPT,
} from "./builder.js";
import { createTools } from "./tools/index.js";
import {
  syncSkills,
  loadSkillIndex,
  readSkillFile,
  installSkillFromUrl,
  idFromUrl,
  getSkillSources,
  setSkillSources,
} from "./skill-sync.js";

const REGISTRY_KEY = "apps-registry";

export function createBuilderStore({ fs, mazmotStore, selfStore, load }) {
  /* ---------- 可观察 state 与事件 ---------- */

  const state = {
    // 消息与发送
    messages: [],
    sending: false,
    nextId: 1,
    turnStartTs: 0, // 进行中回合的开始时间戳（毫秒），「生成中」实时计时用
    keyError: "",
    coreError: "",
    thinking: true, // 思考模式开关（传给 Agent 的 thinking 参数）
    activeModel: "", // 当前 Agent 使用的模型标识（AI 消息徽标用）
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
    // 数据备份（当前应用的 backup/ 目录清单；backupBusy 防创建重入）
    backups: [],
    backupBusy: false,
    smartBackupBusy: false, // 智能备份：打包完成后的 AI 生成标题/备注阶段
    // 隔离预览（bridge 跨域推送）：previewBusy 防重入，previewStatus 为过程提示，
    // previewOnline 为预览窗口（应用页代理）在线状态（预览按钮亮标）
    previewBusy: false,
    previewStatus: "",
    previewOnline: false,
    // 对话用 API Key（镜像自 /mz/ai 的已启用 key；activeKeyId 为 "" 表示自动负载均衡）
    apiKeys: [],
    activeKeyId: "",
    activeModelId: "", // 手动选中的模型（"" = 供应商默认；须属于当前 key 的供应商）
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

  /* ---------- 消息流水线（每会话独立消息桶 + 细粒度事件） ----------
   *
   * 每个会话（含草稿）有自己独立的消息桶（plain 数组），state.messages 只是
   * 「当前正在查看的会话」桶的视图镜像。进行中的回合（turnKey）始终写自己的
   * 桶——即便用户中途切到别的会话，流式内容也不会串台；切回来时直接投影
   * 内存中的实时桶继续流式显示。
   */

  const msgEvent = (evt) => listeners.forEach((f) => f({ type: "messages", ...evt }));

  // 会话消息桶：chatKey（"chat:draft" / "chat:<app>:<sid>"）→ plain 消息数组
  const sessionBuckets = new Map();
  // 进行中回合所属的 chatKey；null = 无进行中回合（消息操作落在当前视图桶）
  let turnKey = null;
  // 当前回合开始时刻（毫秒时间戳）：用于会话对话时长统计与列表实时计时
  let turnStartAt = 0;

  const viewKey = () =>
    state.currentAppName === ""
      ? "chat:draft"
      : `chat:${state.currentAppName}:${state.currentSessionId}`;

  const bucketFor = (key) => {
    let bucket = sessionBuckets.get(key);
    if (!bucket) {
      bucket = [];
      sessionBuckets.set(key, bucket);
    }
    return bucket;
  };
  // 消息操作的目标桶：回合进行中固定写回合桶，否则写当前视图桶
  const activeKey = () => turnKey || viewKey();

  // 增量落盘（防抖 400ms）：回合中途（表单挂起、流式输出等）也把消息写进
  // IndexedDB，刷新 / 意外关闭不再丢失整轮对话。捕获当下的 key，避免防抖
  // 触发时回合已收尾、activeKey 变化而写错桶
  function scheduleSave(key) {
    if (!selfStore || !sessionBuckets.has(key)) return;
    clearTimeout(scheduleSave._timer);
    scheduleSave._timer = setTimeout(() => {
      if (!sessionBuckets.has(key)) return;
      selfStore
        .setItem(key, bucketFor(key).map((m) => ({ ...m })))
        .catch(() => {});
    }, 400);
  }

  function pushMessage(item) {
    const key = activeKey();
    // 消息落盘时间：所有角色（含用户消息）统一在这里补时间戳，hover 展示
    if (item.ts == null) item.ts = Date.now();
    bucketFor(key).push(item);
    scheduleSave(key);
    if (key === viewKey()) {
      state.messages.push(item);
      msgEvent({ op: "push", item });
    }
    return item;
  }
  function patchMessage(id, patch) {
    const key = activeKey();
    const item = bucketFor(key).find((m) => m.id === id);
    if (!item) return;
    Object.assign(item, patch);
    scheduleSave(key);
    if (key === viewKey()) msgEvent({ op: "patch", id, patch });
  }
  function removeMessage(id) {
    const key = activeKey();
    const list = bucketFor(key);
    const idx = list.findIndex((m) => m.id === id);
    if (idx > -1) {
      list.splice(idx, 1);
      scheduleSave(key);
      if (key === viewKey()) msgEvent({ op: "splice", id });
    }
  }
  // 整组替换某个会话桶并（若是当前视图）刷新镜像；nextId 全局单调递增，
  // 避免多桶并存时 id 撞车导致补丁打到别的会话消息上。
  // 注意：pending 表单原样保留——刷新后仍可填写提交（submitForm 走恢复回合）
  function replaceMessages(list, key = viewKey()) {
    const norm = (list || []).map((m) => {
      return {
        ...m,
        pending: false,
        open: false,
        reasoningOpen: false, // 历史消息的思考过程默认收起
      };
    });
    sessionBuckets.set(key, norm);
    state.nextId = Math.max(
      state.nextId,
      norm.reduce((max, m) => Math.max(max, m.id), 0) + 1,
    );
    if (key === viewKey()) {
      state.messages = [...norm];
      msgEvent({ op: "replace", list: norm });
    }
  }
  // 把某个桶直接投影为当前视图（切回「正在流式的会话」时用，不读盘）
  function projectBucket(key) {
    if (key !== viewKey()) return;
    state.messages = [...bucketFor(key)];
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
  // 当前 Agent 实际使用的模型标识（deepseek 固定模型名，其余用 provider 名兜底）
  let activeModel = "";
  // 用户设定的上下文窗口大小（token），页面 select 切换时经 setContextWindow 注入；
  // 0 = 未设置（不做自动压缩）。仅用于发送前的水位判断，非响应式
  let contextWindow = 0;

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
    const { getAssistant, getApiKeys } = aiModules;
    const keys = getApiKeys().filter((k) => !k.disabled);

    // key 选择：用户手动指定的优先（切换后经 invalidateAgent 生效）；
    // 否则自动——deepseek 优先，其余随机负载均衡
    let key = null;
    if (state.activeKeyId) {
      key = keys.find((k) => k.id === state.activeKeyId) || null;
    }
    if (!key && keys.length) {
      key = keys.find((k) => k.provider === "deepseek") || null;
      if (!key && keys.length > 1) {
        key = keys[Math.floor(Math.random() * keys.length)];
      }
    }

    // 模型选择：手动选中的模型（须属于该 key 的供应商）优先；
    // 否则 deepseek 走代码生成专属模型名，其余跟随供应商默认
    const providerModels = key ? MODEL_OPTIONS[key.provider] || [] : [];
    let model;
    if (key && state.activeModelId && providerModels.includes(state.activeModelId)) {
      model = state.activeModelId;
    } else if (key?.provider === "deepseek") {
      model = "deepseek-flash";
    } else {
      model = undefined;
    }
    return { assistant: getAssistant(key?.id), model };
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
    activeModel = model || assistant.providerName || "";
    set("activeModel", activeModel);
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
      requestForm,
      // 隔离预览调试（preview_* 工具）：推送入口 + dbg 指令通道 + 截图卡片
      openPreview: (appName) => {
        const hit = state.apps.find((a) => a.name === sanitizeAppName(appName));
        return runRemotePreview(appName, hit?.mode || state.currentAppMode);
      },
      previewDebug,
      onPreviewShot: pushPreviewShot,
    });
    agent = chainModules.createAgent({
      assistant,
      ...(model ? { model } : {}),
      thinking: state.thinking,
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

  async function reloadSkillIndex() {
    skillIndex = await loadSkillIndex(fs);
    set("skills", [...skillIndex]);
  }

  // 用户主动安装 / 更新技能：先把 loading 占位放到列表，下载完成后刷新索引。
  // 同 id 已存在则原地置为 loading（即更新）；来源登记进 skill-sources，
  // 之后后台同步也会持续检查这个地址。失败抛错由 UI 提示并回滚占位。
  async function installSkillFromSource(url) {
    const trimmed = String(url || "").trim();
    if (!/^https?:\/\//.test(trimmed)) throw new Error("请输入 http(s) 技能地址");
    const id = idFromUrl(trimmed);

    const existing = skillIndex.find((s) => s.id === id);
    if (existing) {
      set(
        "skills",
        skillIndex.map((s) => (s.id === id ? { ...s, loading: true } : s)),
      );
    } else {
      set("skills", [
        ...skillIndex,
        { id, name: id, version: "", description: "正在下载…", source: trimmed, loading: true },
      ]);
    }

    try {
      await installSkillFromUrl(fs, trimmed);
      await reloadSkillIndex();
      invalidateAgent(); // 提示词中的技能清单随之更新
      if (selfStore) {
        const urls = await getSkillSources(selfStore);
        if (!urls.includes(trimmed)) {
          await setSkillSources(selfStore, [...urls, trimmed]);
        }
      }
    } catch (err) {
      await reloadSkillIndex(); // 回滚 loading 占位
      throw err;
    }
  }

  /* ---------- 应用 / 会话切换 ---------- */

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
        busy: turnKey === `chat:${state.currentAppName}:${s.id}`,
        duration: s.duration || 0,
      })),
    });
  }

  // 标记/清除会话的「对话进行中」状态（key 传 null 清除全部标记）
  function markBusy(key, busy = false) {
    const sid = key && key !== "chat:draft" ? key.split(":").pop() : "";
    set(
      "currentAppSessions",
      state.currentAppSessions.map((s) => ({
        ...s,
        busy: sid ? s.id === sid && busy : false,
      })),
    );
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
    set("currentSessionId", sid);
    syncSessionTitle(reg);
    if (key === turnKey) {
      // 切回正在进行流式回合的会话：直接投影内存实时桶，
      // 不能读盘覆盖（盘上是上一回合的旧内容，读盘会顶掉进行中的消息）
      projectBucket(key);
    } else {
      const saved = (await selfStore.getItem(key)) || [];
      replaceMessages(saved, key);
    }
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
        // 草稿回合进行中被整体清空：中断并丢弃实时桶，避免回合收尾复活已删内容
        if (turnKey === "chat:draft") {
          stop();
          sessionBuckets.delete("chat:draft");
        }
        replaceMessages([]);
      } else if (turnKey === "chat:draft") {
        projectBucket("chat:draft");
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

  /* ---------- 思考模式 ---------- */

  // 切换思考模式并持久化偏好；Agent 随开关重建（thinking 参数在创建时注入）
  async function toggleThinking() {
    const next = !state.thinking;
    set("thinking", next);
    invalidateAgent();
    if (selfStore) {
      try {
        await selfStore.setItem("pref:thinking", next);
      } catch {
        /* 存储失败不影响本次会话 */
      }
    }
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
      // 草稿阶段选中的目录已是既有项目（client/app.json 存在）：
      // 走导入流程恢复项目与对话数据，而不是当作新项目
      if (state.currentAppName === "") {
        try {
          const meta = await detectLocalProject(handle);
          if (meta && meta.name) {
            await importLocalProject(meta, handle);
            return true;
          }
        } catch (err) {
          console.warn("导入本地项目失败：", err);
          set("keyError", `导入本地项目失败：${err.message}`);
        }
      }
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
          // 应用下正在进行流式回合的会话：中断并丢弃实时桶（finishTurn 见桶
          // 不存在会跳过落盘，避免把已删除的会话内容复活写回）
          const key = `chat:${name}:${s.id}`;
          if (turnKey === key) {
            stop();
            sessionBuckets.delete(key);
          }
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

  async function deleteSession(sid) {
    const name = state.currentAppName;
    // 对话进行中的会话不允许删除（UI 已隐藏删除按钮，这里兜底）
    if (turnKey === `chat:${name}:${sid}`) return;
    const reg = await loadRegistry();
    const hit = reg.find((a) => a.name === name);
    if (!hit) return;
    hit.sessions = (hit.sessions || []).filter((s) => s.id !== sid);
    await saveRegistry(reg);
    if (selfStore) {
      await selfStore.removeItem(`chat:${name}:${sid}`);
      await selfStore.removeItem(`thread:${name}:${sid}`);
    }
    // 删除的正是正在进行流式回合的会话：中断并丢弃实时桶，防止回合收尾复活它
    if (turnKey === `chat:${name}:${sid}`) {
      stop();
      sessionBuckets.delete(turnKey);
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

  /* ---------- 会话 fork（分支） ---------- */

  // 从当前会话的某条消息处 fork：新会话复制截至该消息（含）的聊天记录，
  // Agent 记忆按完整回合截断复制；成功后切换到新会话。草稿与发送中不支持。
  async function forkSession(fromMessageId) {
    if (!selfStore || state.sending) return;
    const name = state.currentAppName;
    const srcSid = state.currentSessionId;
    if (!name || !srcSid) return; // 草稿没有会话实体，fork 无从谈起
    const srcKey = `chat:${name}:${srcSid}`;
    const bucket = bucketFor(srcKey);
    const idx = bucket.findIndex((m) => m.id === fromMessageId);
    if (idx < 0) return;
    const kept = bucket.slice(0, idx + 1).map((m) => ({ ...m }));

    // 新会话登记（标题沿用原会话并标注分支）
    const reg = await loadRegistry();
    const app = reg.find((a) => a.name === name);
    if (!app) return;
    const baseTitle =
      app.sessions?.find((s) => s.id === srcSid)?.title ||
      (kept.find((m) => m.role === "user")?.content || "").slice(0, 24) ||
      "新对话";
    const sid = `s${Date.now().toString(36)}`;
    app.sessions = app.sessions || [];
    app.sessions.push({
      id: sid,
      title: `${baseTitle} ⎇`.slice(0, 40),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await saveRegistry(reg);

    // 复制聊天记录（实时桶 + 落盘）
    const dstKey = `chat:${name}:${sid}`;
    sessionBuckets.set(dstKey, kept);
    await selfStore.setItem(dstKey, kept.map((m) => ({ ...m })));

    // 复制 Agent 记忆：按完整回合截断（fork 点所在回合若未闭合则整段舍弃）
    const userTurns = kept.filter((m) => m.role === "user").length;
    const srcThread = (await selfStore.getItem(`thread:${name}:${srcSid}`)) || [];
    await selfStore.setItem(
      `thread:${name}:${sid}`,
      truncateThread(srcThread, userTurns),
    );

    await reloadApps();
    await loadSessionById(sid, state.apps);
  }

  /* ---------- 上下文压缩 ---------- */

  // 把 wire 消息拼成摘要请求用的对话稿（超长内容掐头留尾，防止摘要请求本身撑爆窗口）
  const clip = (t, n) => {
    const text = String(t ?? "");
    if (text.length <= n) return text;
    const half = Math.floor(n / 2);
    return text.slice(0, half) + "\n…[过长截断]…\n" + text.slice(-half);
  };
  const buildTranscript = (thread) =>
    thread
      .map((m) => {
        if (m.role === "user") return `用户：${clip(m.content, 3000)}`;
        if (m.role === "assistant") {
          const calls = (m.tool_calls || [])
            .map(
              (c) =>
                `  [调用工具] ${c.function?.name} ${clip(c.function?.arguments, 600)}`,
            )
            .join("\n");
          return `助手：${clip(m.content, 3000)}${calls ? "\n" + calls : ""}`;
        }
        if (m.role === "tool") return `工具结果：${clip(m.content, 1200)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

  /**
   * 压缩指定会话的 Agent 记忆：用摘要替换旧历史 + 保留最近 2 个完整回合原文，
   * 并在聊天流里插一张 compact 卡片告知用户（显示层聊天记录不动）。
   * 只应在两回合之间调用（sending = false）。返回 { ok, reason? }。
   */
  async function compressThread(chatKey) {
    const threadId = chatKey === "chat:draft" ? "draft" : chatKey.slice("chat:".length);
    const threadKey = `thread:${threadId}`;
    const thread = (await selfStore.getItem(threadKey)) || [];
    const turns = thread.filter((m) => m.role === "user").length;
    // 太短不值得压：摘要 + 尾部原文不会比原记忆小多少
    if (turns < 3) return { ok: false, reason: "对话还很短，暂不需要压缩" };

    if (!aiModules) aiModules = await load("/mz/ai/main.js");
    const { assistant, model } = await pickAssistant();
    const res = await assistant.chat({
      ...(model ? { model } : {}),
      thinking: false,
      stream: false,
      messages: [
        { role: "system", content: COMPACTION_PROMPT },
        { role: "user", content: buildTranscript(thread) },
      ],
    });
    const summary = String(res.content || "").trim();
    if (!summary) return { ok: false, reason: "摘要生成失败，请稍后重试" };

    const newThread = [
      {
        role: "user",
        content: `以下是此前对话的压缩摘要，请基于它继续工作（细节需要时先用 list_files / read_file 核实）：\n\n${summary}`,
      },
      { role: "assistant", content: "已了解，我将基于该摘要继续。" },
      ...tailThread(thread, 2),
    ];
    await selfStore.setItem(threadKey, newThread);

    // 聊天流里插卡片（显示层记录不动，仅告知）；pushMessage 路由到 activeKey 桶
    pushMessage({
      id: state.nextId++,
      role: "compact",
      count: thread.length - tailThread(thread, 2).length,
      summary,
      open: false,
      newGroup: true,
    });
    // 卡片随会话落盘
    await selfStore.setItem(
      chatKey,
      bucketFor(chatKey).map((m) => ({ ...m })),
    );
    return { ok: true };
  }

  // 手动压缩：压缩当前正在查看的会话
  async function compress() {
    if (!selfStore || state.sending) {
      return { ok: false, reason: state.sending ? "请等本轮对话结束后再压缩" : "" };
    }
    return await compressThread(viewKey());
  }

  // 设定上下文窗口（token），发送前的自动压缩判断用
  function setContextWindow(n) {
    contextWindow = Number(n) || 0;
  }

  /* ---------- 对话 API Key 切换 ---------- */

  const API_KEY_LIST_KEY = "pref:active-key";

  // 把 /mz/ai 的 key 列表镜像进 state（只留展示所需字段）
  function syncApiKeyList(keys) {
    set(
      "apiKeys",
      (keys || [])
        .filter((k) => !k.disabled)
        .map((k) => ({ id: k.id, provider: k.provider, maskedKey: k.maskedKey })),
    );
    // 选中的 key 已被删/禁用：回退自动
    if (state.activeKeyId && !keys?.some((k) => k.id === state.activeKeyId && !k.disabled)) {
      selectApiKey("");
    }
  }

  // 切换对话模型（"" = 供应商默认）；切换即 invalidateAgent 下一回合生效
  async function selectModel(id) {
    if (state.activeModelId === id) return;
    set("activeModelId", id);
    invalidateAgent();
    if (selfStore) {
      try {
        await selfStore.setItem("pref:active-model", id);
      } catch {
        /* 存储失败不影响本次会话 */
      }
    }
  }

  // 切换对话用的 API Key（"" = 自动）；下一回合经 invalidateAgent 生效
  async function selectApiKey(id) {
    if (state.activeKeyId === id) return;
    set("activeKeyId", id);
    invalidateAgent();
    if (selfStore) {
      try {
        await selfStore.setItem(API_KEY_LIST_KEY, id);
      } catch {
        /* 存储失败不影响本次会话 */
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

  /* ---------- 隔离预览（bridge 跨域推送） ---------- */

  // 收集指定应用的全部文件（VFS 渠道读 ai-apps/<name>/client/，
  // 本地渠道恢复句柄后复用 app-runner 的 readAppFiles，优先 client/ 子目录）
  async function collectAppFiles(name, mode) {
    if (mode === "local") {
      let handle = localRootHandle;
      if (!handle) {
        handle = await getLocalHandleFromRecord(name);
        if (handle) {
          localRootHandle = handle;
          set("localDirLabel", handle?.name || "");
        }
      }
      if (!handle) throw new Error("本地目录句柄已丢失，请重新选择目录");
      const granted = await ensureLocalPermission(handle);
      if (!granted) throw new Error("本地目录权限未授予，无法读取应用文件");
      const { readAppFiles } = await load("/mz/app-runner.js");
      const raw = await readAppFiles(handle);
      return raw.map((f) => ({ path: f.path, text: f.content }));
    }
    const paths = await listAppFiles(fs, name);
    const files = [];
    for (const p of paths) {
      const text = await readAppFile(fs, name, p);
      if (text != null) files.push({ path: p, text });
    }
    return files;
  }

  // 隔离预览推送主流程（预览按钮与 preview_app 工具共用）：
  // 收集文件 → 推送到 bridge 隔离域运行（AI 代码不接触主域数据）。
  // 失败写入 keyError 并抛出（调用方决定是否吞掉），成功返回 done（含运行 url）
  async function runRemotePreview(appName, mode) {
    const name = sanitizeAppName(appName);
    if (!name) throw new Error("应用名不合法");
    if (state.previewBusy) throw new Error("预览推送进行中，请稍候再试");
    set("previewBusy", true);
    set("previewStatus", "准备推送...");
    try {
      const files = await collectAppFiles(name, mode);
      if (!files.length) throw new Error("应用目录为空，请先生成应用文件");
      const { openRemotePreview } = await load(
        "/official-apps/conjure/lib/remote-preview.js",
      );
      return await openRemotePreview({
        load,
        appName: name,
        files,
        selfStore,
        onStatus: (text) => set("previewStatus", text),
      });
    } catch (err) {
      set("keyError", `隔离预览失败：${err.message}`);
      throw err;
    } finally {
      set("previewBusy", false);
      set("previewStatus", "");
    }
  }

  // 预览按钮入口：错误已写入 keyError，这里吞掉避免未处理拒绝
  async function openAppRemote(appName, mode) {
    try {
      await runRemotePreview(appName, mode);
    } catch (_) {
      /* 错误提示已写入 keyError */
    }
  }

  // 调试指令通道（preview_* 工具）：转发到 remote-preview 的 dbg 链路
  async function previewDebug(cmd, args = {}, timeoutMs) {
    const { debugPreviewCommand } = await load(
      "/official-apps/conjure/lib/remote-preview.js",
    );
    return debugPreviewCommand({ load, selfStore, cmd, args, timeoutMs });
  }

  // preview_screenshot 工具：截图以图片卡片进入聊天流（用户可视核对）
  function pushPreviewShot(dataUrl, meta) {
    pushMessage({
      id: state.nextId++,
      role: "image",
      src: dataUrl,
      w: meta?.w || 0,
      h: meta?.h || 0,
      newGroup: false,
    });
  }

  // 本地目录应用：应用文件在所选目录的 client/ 子目录（与虚拟渠道布局一致）
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

  /* ---------- 数据备份管理（client/ 同层 backup/ 目录） ---------- */

  // 当前应用对应的备份根句柄：本地渠道恢复句柄（只读列出 / 写入用），虚拟渠道 null
  async function backupRootHandle() {
    if (state.currentAppMode !== "local") return null;
    if (!localRootHandle) {
      localRootHandle =
        (await getLocalHandleFromRecord(state.currentAppName)) || null;
      if (localRootHandle) set("localDirLabel", localRootHandle?.name || "");
    }
    return localRootHandle;
  }

  async function refreshBackups() {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      // listAppBackups 返回 { id, label, note }；当前内容指纹与 id 尾部 hash
      // 一致的项标记 current（即「这份备份就是现在的内容」）
      const currentHash = await currentAppHash(fs, state.currentAppName, rootHandle);
      const list = await listAppBackups(fs, state.currentAppName, rootHandle);
      set(
        "backups",
        list.map((b) => ({
          ...b,
          current: currentHash !== "" && b.id.endsWith(`-${currentHash}`),
        })),
      );
    } catch (err) {
      console.warn("读取备份列表失败：", err);
    }
  }

  async function createBackup() {
    if (state.backupBusy || state.currentAppName === "" || !fs) return;
    set("backupBusy", true);
    try {
      const rootHandle = await backupRootHandle();
      const res = await createAppBackup(fs, state.currentAppName, rootHandle);
      await refreshBackups();
      return res;
    } catch (err) {
      set("keyError", `创建备份失败：${err.message}`);
    } finally {
      set("backupBusy", false);
    }
  }

  // 智能备份的 AI 阶段：对比当前与上一版备份，生成备份标题与变更备注
  async function generateBackupMeta(currentFiles, prevFiles) {
    if (!aiModules) aiModules = await load("/mz/ai/main.js");
    const { assistant, model } = await pickAssistant();
    const clip = (t) =>
      t.length > 2500 ? `${t.slice(0, 2500)}\n…（过长截断）` : t;
    const prevMap = new Map(prevFiles.map((f) => [f.path, f.text]));
    const curMap = new Map(currentFiles.map((f) => [f.path, f.text]));
    const parts = [];
    for (const f of currentFiles) {
      if (!prevMap.has(f.path)) {
        parts.push(`[新增文件] ${f.path}\n${clip(f.text)}`);
      } else if (prevMap.get(f.path) !== f.text) {
        parts.push(
          `[修改文件] ${f.path}\n--- 新版 ---\n${clip(f.text)}\n--- 旧版 ---\n${clip(prevMap.get(f.path))}`,
        );
      }
    }
    for (const f of prevFiles) {
      if (!curMap.has(f.path)) parts.push(`[删除文件] ${f.path}`);
    }
    const hasPrev = prevFiles.length > 0;
    const diffText =
      parts.join("\n\n") || "（两个版本内容没有文件级差异）";

    const system = `你是软件版本发布助手。根据用户提供的应用文件差异，输出备份的标题与备注。
要求：
1. 只输出一个 JSON 对象，格式：{"label":"...","note":"..."}，不要输出任何其他内容或代码块标记。
2. label：备份标题，不超过 16 字，概括这个版本的主题（如「任务清单页」）；首个备份则概括应用功能。
3. note：不超过 120 字的中文备注${hasPrev ? "，说明相比上一版新增了什么功能、少了/移除了什么功能" : "，简要介绍应用包含的功能"}；用「新增：…；移除：…」结构化表述，无对应项可省略。`;
    const res = await assistant.chat({
      ...(model ? { model } : {}),
      thinking: false,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `文件差异：\n\n${diffText}` },
      ],
    });
    const raw = String(res.content || "").trim();
    const m = /\{[\s\S]*\}/.exec(raw);
    let out = {};
    try {
      out = JSON.parse(m ? m[0] : raw) || {};
    } catch {
      // 解析失败退化为把整段回复当备注
      out = { note: raw.slice(0, 200) };
    }
    return {
      label: String(out.label || "").trim().slice(0, 50),
      note: String(out.note || "").trim().slice(0, 200),
    };
  }

  // 智能备份：打包当前版本后，用 AI 对比上一版生成标题与备注并写入备份 meta。
  // 返回 { id, label, note }；内容无变化时返回 { skipped: true }
  async function smartBackup() {
    if (state.backupBusy || state.currentAppName === "" || !fs) return;
    set("backupBusy", true);
    set("smartBackupBusy", true);
    try {
      const rootHandle = await backupRootHandle();
      const res = await createAppBackup(fs, state.currentAppName, rootHandle);
      await refreshBackups();
      if (res?.skipped) return { skipped: true };
      // 上一版 = 备份列表（新的在前）里除新备份外的第一份；首个备份则无对比基准
      const prev = state.backups.find((b) => b.id !== res.id);
      const currentFiles = await currentAppFiles(fs, state.currentAppName, rootHandle);
      const prevFiles = prev
        ? await readBackupFiles(fs, state.currentAppName, prev.id, rootHandle)
        : [];
      const { label, note } = await generateBackupMeta(currentFiles, prevFiles);
      if (label) {
        await renameAppBackup(fs, state.currentAppName, res.id, label, rootHandle);
      }
      if (note) {
        await setBackupNote(fs, state.currentAppName, res.id, note, rootHandle);
      }
      await refreshBackups();
      return { id: res.id, label, note };
    } catch (err) {
      set("keyError", `智能备份失败：${err.message}`);
    } finally {
      set("backupBusy", false);
      set("smartBackupBusy", false);
    }
  }

  async function deleteBackup(id) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await deleteAppBackup(fs, state.currentAppName, id, rootHandle);
      await refreshBackups();
    } catch (err) {
      set("keyError", `删除备份失败：${err.message}`);
    }
  }

  // 备份更名：写入备份目录内 __meta.json 的 label（目录名/内容寻址不变）
  async function renameBackup(id, label) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await renameAppBackup(fs, state.currentAppName, id, label, rootHandle);
      await refreshBackups();
      return true;
    } catch (err) {
      set("keyError", `备份更名失败：${err.message}`);
    }
  }

  // 设置 / 清除备份备注（空串清除），存 __meta.json 的 note
  async function setNote(id, note) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await setBackupNote(fs, state.currentAppName, id, note, rootHandle);
      await refreshBackups();
      return true;
    } catch (err) {
      set("keyError", `设置备注失败：${err.message}`);
    }
  }

  // 还原备份：内容无变动返回 { reason: "unchanged" }，失败返回 undefined
  async function restoreBackup(id) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      return await restoreAppBackup(fs, state.currentAppName, id, rootHandle);
    } catch (err) {
      set("keyError", `还原备份失败：${err.message}`);
    }
  }

  /* ---------- 消息流水线（流式事件 → 消息变更） ---------- */

  function newBubble() {
    const item = pushMessage({
      id: state.nextId++,
      role: "assistant",
      content: "",
      reasoning: "",
      model: activeModel,
      reasoningOpen: true, // 思考过程默认展开（流式可见），用户可手动收起
      newGroup: false,
    });
    activeBubble = item;
    return item;
  }

  function handleStreamEvent(ev) {
    if (ev.type === "text" && (ev.delta || ev.deltaReasoning)) {
      const bubble = activeBubble ?? newBubble();
      const patch = {};
      if (ev.delta) {
        bubble.content += ev.delta;
        patch.content = bubble.content;
      }
      if (ev.deltaReasoning) {
        bubble.reasoning = (bubble.reasoning || "") + ev.deltaReasoning;
        patch.reasoning = bubble.reasoning;
      }
      patchMessage(bubble.id, patch);
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
      const item = bucketFor(activeKey()).find(
        (m) => m.toolCallId === ev.toolCallId,
      );
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
        // 用响应里的真实模型名回填徽标（随机 assistant 场景 provider 名只是兜底）
        if (ev.model) {
          activeBubble.model = ev.model;
          patchMessage(activeBubble.id, { model: ev.model });
        }
        // 本轮 token 用量（Agent 已跨工具循环累计）随末条 AI 消息落盘
        if (ev.usage) {
          activeBubble.usage = ev.usage;
          patchMessage(activeBubble.id, { usage: ev.usage });
        }
      } else if (ev.content || ev.usage) {
        const bubble = newBubble();
        bubble.content = ev.content || "";
        if (ev.model) bubble.model = ev.model;
        if (ev.usage) bubble.usage = ev.usage;
        patchMessage(bubble.id, {
          content: bubble.content,
          ...(ev.model ? { model: ev.model } : {}),
          ...(ev.usage ? { usage: ev.usage } : {}),
        });
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
      // 选中的目录是既有项目：chooseLocalDir 已自动导入并切换应用，
      // 不返回草稿，继续走下方既有应用的会话准备流程
      if (state.currentAppName === "") return "draft";
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
  // 全程以回合所属 chatKey（发送时固定）为准，与用户当前正查看哪个会话无关
  async function finishTurn(firstUserText, threadId, elapsedMs = 0) {
    if (!selfStore) return;
    const chatKey = threadId === "draft" ? "chat:draft" : `chat:${threadId}`;
    // 会话桶已在中途被删除（删除会话/应用时丢弃实时桶）：跳过落盘
    if (!sessionBuckets.has(chatKey)) return;
    const plain = bucketFor(chatKey).map((m) => ({ ...m }));

    // 本轮创建了新应用：草稿会话迁移为该应用的第一个会话
    if (pendingNewApp) {
      const info = pendingNewApp;
      pendingNewApp = null;
      await adoptNewApp(info, firstUserText, chatKey, elapsedMs);
      await syncLocalProjectChats(info.appName);
      return;
    }

    await selfStore.setItem(chatKey, plain);

    // 更新会话标题与时间（应用/会话取自回合的 threadId，不受当前视图影响）
    const [appName, sid] = threadId === "draft" ? ["", ""] : threadId.split(":");
    if (appName && sid) {
      const reg = await loadRegistry();
      const app = reg.find((a) => a.name === appName);
      const ses = app?.sessions?.find((s) => s.id === sid);
      if (ses) {
        if (!ses.title || ses.title === "新对话") {
          ses.title = firstUserText.slice(0, 24) || "新对话";
        }
        ses.updatedAt = Date.now();
        // 累计本回合对话耗时（会话从创建到现在的所有回合时长之和）
        ses.duration = (ses.duration || 0) + (elapsedMs || 0);
        await saveRegistry(reg);
        await reloadApps();
        if (
          state.currentAppName === appName &&
          state.currentSessionId === sid
        ) {
          syncSessionTitle();
        }
      }
      // 兜底：记录缺失（历史会话/旧版本创建）时补登记，保证句柄可恢复
      await ensureAppRegistered(appName);
    }
    // 本地渠道：回合结束把对话快照写入项目目录（conjure-chats.json），
    // 供下次选择该目录时走导入流程恢复对话数据
    if (appName) await syncLocalProjectChats(appName);
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
    await selectApp(clean);
    await reloadApps();
  }

  // 把当前本地项目的对话数据写快照到项目目录（conjure-chats.json）。
  // 每次对话回合结束后调用；appName 可与当前视图不同（回合归属优先）
  async function syncLocalProjectChats(appName = state.currentAppName) {
    if (!selfStore || appName === "") return;
    try {
      const reg = await loadRegistry();
      const app = reg.find((a) => a.name === appName);
      if (!app || app.mode !== "local") return;
      // 句柄：当前应用用闭包句柄；其它应用从登记记录恢复
      let handle = localRootHandle;
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
      const isLocal = mode === "local" && !!localRootHandle;
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
  // draftKey：本轮回合所属的草稿 chatKey，消息从其实时桶迁移（不读盘）
  async function adoptNewApp(info, firstUserText, draftKey, elapsedMs = 0) {
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
      duration: elapsedMs || 0,
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
      // 消息桶迁移：草稿实时桶 → 新应用第一个会话桶（存储副本下面统一落盘）
      sessionBuckets.set(`chat:${info.appName}:${sid}`, [...bucketFor(draftKey)]);
      sessionBuckets.delete(draftKey);
      await selfStore.removeItem(draftKey);
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
    // 回合指向新会话：预览卡片写入新桶并镜像到当前视图
    if (turnKey === draftKey) turnKey = `chat:${info.appName}:${sid}`;

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

    // 卡片入桶后统一落盘（含卡片在内的完整首会话）
    if (selfStore) {
      const newKey = `chat:${info.appName}:${sid}`;
      await selfStore.setItem(
        newKey,
        bucketFor(newKey).map((m) => ({ ...m })),
      );
    }
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

    // 本回合固定写自己的会话桶：此后无论用户切到哪个会话/项目，
    // 流式消息、落盘、收尾都以该 key 为准，不再随当前视图漂移
    turnKey = threadId === "draft" ? "chat:draft" : `chat:${threadId}`;
    if (!sessionBuckets.has(turnKey)) {
      sessionBuckets.set(turnKey, [...state.messages]);
    }
    turnStartAt = Date.now();
    markBusy(turnKey, true);

    setMany({ keyError: "" });
    // 用户消息记录发送时间 ts（聊天区 hover 展示）
    pushMessage({
      id: state.nextId++,
      role: "user",
      content: text,
      newGroup: true,
      ts: turnStartAt,
    });
    setMany({ turnStartTs: turnStartAt });

    try {
      await ensureAgent();
    } catch {
      turnKey = null; // 回合未真正开始，回退到视图内联模式
      turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return;
    }

    set("sending", true);
    // 自动压缩：预计本轮输入会突破窗口时，先压缩记忆再开聊（失败不阻塞对话）
    try {
      const info = contextInfo(bucketFor(turnKey));
      const estimate = info.used + Math.ceil((text.length || 0) / 2) + 64;
      if (contextWindow > 0 && info.used > 0 && estimate >= contextWindow) {
        await compressThread(turnKey);
      }
    } catch (err) {
      console.warn("自动压缩上下文失败：", err);
    }
    await driveTurn(threadId, text, [{ role: "user", content: text }]);
  }

  // 驱动一轮 agent 对话循环：流式转发、错误入气泡、收尾（取消挂起表单、
  // 落盘、迁移草稿、清忙）。send 与表单恢复回合共用
  async function driveTurn(threadId, firstUserText, inputMessages) {
    activeBubble = null;
    currentAbort = { stopped: false };
    const abort = currentAbort;
    try {
      await agent.chat({
        messages: inputMessages,
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
      cancelPendingForm("回合已结束"); // 表单仍挂起时兜底取消（如 Agent 自行结束）
      set("sending", false);
      // 本轮耗时 patch 到回合末条 AI 消息（ai-foot 右侧展示；须在 finishTurn
      // 落盘前 patch，随会话桶一起持久化）
      if (turnStartAt) {
        const lastAi = [...bucketFor(turnKey)]
          .reverse()
          .find((m) => m.role === "assistant");
        if (lastAi) patchMessage(lastAi.id, { turnMs: Date.now() - turnStartAt });
      }
      await finishTurn(firstUserText, threadId, Date.now() - turnStartAt);
      // adoptNewApp 可能把回合迁移到新应用会话，收尾后按最终 turnKey 清忙
      markBusy(turnKey, false);
      turnKey = null;
      turnStartAt = 0;
      setMany({ turnStartTs: 0 });
    }
  }

  // 停止当前生成：中断流式回调链，已生成内容保留并照常落盘。
  // 视觉表单挂起中（Agent 在等用户提交）时一并取消，工具以 cancelled 返回
  function stop() {
    if (currentAbort) currentAbort.stopped = true;
    cancelPendingForm("用户停止了生成");
  }

  /* ---------- 视觉交互表单（show_form 工具） ---------- */

  // 当前挂起的表单等待器：{ msgId, resolve }；同一时刻最多一张
  let formWaiter = null;
  let formResuming = false; // 恢复回合防重入

  // show_form 工具入口：把表单卡片作为一条 assistant 消息推入当前回合，
  // 返回的 Promise 在用户提交（submitForm）或取消（cancelPendingForm）时落定
  function requestForm(spec) {
    const item = pushMessage({
      id: state.nextId++,
      role: "assistant",
      type: "form",
      content: "",
      form: { ...spec, status: "pending", data: null },
      newGroup: false,
    });
    return new Promise((resolve) => {
      formWaiter = { msgId: item.id, resolve };
    });
  }

  // 用户在卡片上点「提交」：数据写回消息（随会话桶持久化，历史只读回填），
  // 并把数据交回 Agent 工具调用。
  // 无活动等待器（页面刷新后恢复的挂起表单）→ 走恢复回合
  function submitForm(msgId, values) {
    if (formWaiter && formWaiter.msgId === msgId) {
      const { resolve } = formWaiter;
      formWaiter = null;
      const item = bucketFor(activeKey()).find((m) => m.id === msgId);
      const form = { ...(item?.form || {}), status: "submitted", data: values };
      patchMessage(msgId, { form });
      resolve({ data: values });
      return true;
    }
    const item = bucketFor(viewKey()).find((m) => m.id === msgId);
    if (item?.type === "form" && item.form?.status === "pending") {
      resumeFormTurn(item, values); // 异步恢复回合
      return true;
    }
    return false;
  }

  // 恢复回合：页面刷新后用户提交恢复的挂起表单时，原回合的工具等待已随页面
  // 消失、且本轮对话从未写入模型记忆（检查点只在回合收尾落盘）。
  // 做法：把「用户请求 → assistant 调 show_form → 工具结果（用户提交的数据）」
  // 合成进记忆线程，再以空输入重新驱动 agent 循环，模型即可接上上下文继续。
  async function resumeFormTurn(item, values) {
    if (state.sending || formResuming || !fs) return;
    formResuming = true;
    try {
      await doResumeFormTurn(item, values);
    } finally {
      formResuming = false;
    }
  }

  async function doResumeFormTurn(item, values) {
    if (!fs) return;
    const viewKeyNow = viewKey();

    // 找本轮的用户请求文本（表单消息之前最近一条 user 消息）
    const list = bucketFor(viewKeyNow);
    let firstUserText = "（继续表单）";
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        firstUserText = list[i].content;
        break;
      }
    }

    const threadId =
      viewKeyNow === "chat:draft" ? "draft" : viewKeyNow.slice("chat:".length);
    turnKey = viewKeyNow;
    if (!sessionBuckets.has(turnKey)) {
      sessionBuckets.set(turnKey, [...state.messages]);
    }
    turnStartAt = Date.now();
    markBusy(turnKey, true);
    setMany({ keyError: "", turnStartTs: turnStartAt });

    try {
      await ensureAgent();
    } catch {
      turnKey = null;
      turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return; // 表单保持 pending，修复环境后仍可提交
    }

    set("sending", true);
    // 表单落「已提交」（随会话桶持久化，历史只读回填）
    const form = { ...(item.form || {}), status: "submitted", data: values };
    patchMessage(item.id, { form });

    // 合成记忆：user 请求 → assistant 的 show_form 调用 → 工具结果（提交的数据）
    try {
      const threadKey = `thread:${threadId}`;
      const history = (await selfStore.getItem(threadKey)) ?? [];
      const toolCallId = `call_resume_${Date.now().toString(36)}`;
      const wire = [
        { role: "user", content: firstUserText },
        {
          role: "assistant",
          content: "",
          // DeepSeek 思考模式要求带 tool_calls 的 assistant 消息必须回传
          // reasoning_content（合成消息没有真实思考内容，传空字符串）
          reasoning_content: "",
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "show_form",
                arguments: JSON.stringify({
                  title: form.title,
                  description: form.description,
                  fields: form.fields,
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: toolCallId,
          name: "show_form",
          content: JSON.stringify({ data: values }),
        },
      ];
      await selfStore.setItem(threadKey, [...history, ...wire]);
      await driveTurn(threadId, firstUserText, []);
    } catch (err) {
      turnKey = null;
      turnStartAt = 0;
      markBusy(null);
      setMany({ sending: false, turnStartTs: 0, keyError: err.message });
    }
  }

  // 取消挂起的表单（用户停止 / 回合兜底结束）：卡片置 cancelled 只读
  function cancelPendingForm(reason = "") {
    if (!formWaiter) return;
    const { msgId, resolve } = formWaiter;
    formWaiter = null;
    const item = bucketFor(activeKey()).find((m) => m.id === msgId);
    const form = { ...(item?.form || {}), status: "cancelled" };
    patchMessage(msgId, { form });
    resolve({ cancelled: true, reason });
  }

  /* ---------- 初始化 ---------- */

  // 会话停留记忆（sessionStorage，标签页级）：刷新后回到该项目当前激活的
  // 会话而不是最近会话；不同项目标签互不干扰（sessionStorage 随标签隔离）
  const SESSION_KEY = (name) => `aib:session:${name}`;
  function rememberSession() {
    try {
      if (state.currentAppName) {
        sessionStorage.setItem(
          SESSION_KEY(state.currentAppName),
          state.currentSessionId || "",
        );
      }
    } catch {
      /* 隐私模式等场景静默降级 */
    }
  }
  function recallSession(appName) {
    try {
      return sessionStorage.getItem(SESSION_KEY(appName)) || "";
    } catch {
      return "";
    }
  }

  // initialApp：URL ?p= 带入的项目名。项目标签按名恢复（优先回到上次激活的
  // 会话，无记忆则开最近会话）；无 p 参数 = 草稿标签（新项目），恢复 chat:draft
  // （切换/新建项目由页面在新标签页打开，本标签不再承担跳转）
  async function init({ initialApp = "" } = {}) {
    if (!fs) {
      set(
        "coreError",
        "NoneOS Core 未就绪：无法写入文件系统，请从 Mazmot 主系统打开本应用。",
      );
    }
    // 预览窗口（应用页代理）在线状态监听：预览按钮亮标（失败静默，不影响主流程）
    (async () => {
      try {
        const { watchPreviewAgent } = await load(
          "/official-apps/conjure/lib/remote-preview.js",
        );
        watchPreviewAgent({
          load,
          selfStore,
          onChange: (online) => set("previewOnline", online),
        });
      } catch (_) {}
    })();
    // 恢复思考模式偏好
    if (selfStore) {
      try {
        const pref = await selfStore.getItem("pref:thinking");
        if (typeof pref === "boolean") set("thinking", pref);
      } catch {
        /* 忽略 */
      }
      // 恢复手动选中的 API Key 与模型
      try {
        const keyId = await selfStore.getItem(API_KEY_LIST_KEY);
        if (typeof keyId === "string") set("activeKeyId", keyId);
        const modelId = await selfStore.getItem("pref:active-model");
        if (typeof modelId === "string") set("activeModelId", modelId);
      } catch {
        /* 忽略 */
      }
    }
    // API Key 列表镜像 + 变化订阅（惰性加载 /mz/ai，失败仅代表宿主未提供）
    try {
      const m = await load("/mz/ai/main.js");
      aiModules = aiModules || m;
      syncApiKeyList(m.getApiKeys());
      m.onApiKeysChange(syncApiKeyList);
    } catch (err) {
      console.warn("API Key 列表加载失败：", err);
    }
    await reloadApps();

    if (initialApp) {
      const hit = state.apps.find((a) => a.name === initialApp);
      if (hit) {
        // 必须在 selectApp 之前取记忆：selectApp 打开最近会话时
        // 会触发记忆监听器，把记住的会话覆盖成最近会话
        const sid = recallSession(hit.name);
        await selectApp(hit.name);
        // 刷新恢复：回到该项目上次激活的会话（记忆失效则保持最近会话）
        if (
          sid &&
          sid !== state.currentSessionId &&
          hit.sessions?.some((s) => s.id === sid)
        ) {
          await loadSessionById(sid);
        }
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

  // 会话停留记忆跟随变更自动落 sessionStorage（currentSessionId 变化即记录，
  // 含清空场景），刷新后由 init 的 recallSession 恢复
  listeners.add((evt) => {
    if (evt.type === "patch" && "currentSessionId" in evt.data) {
      rememberSession();
    }
  });

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
    reorderSessions,
    loadSession: loadSessionById,
    deleteApp,
    deleteSession,
    renameSession,
    forkSession,
    compress,
    setContextWindow,
    selectApiKey,
    selectModel,
    selectMode,
    chooseLocalDir,
    grantLocalPermission,
    installSkillFromSource,
    openApp,
    openAppRemote,
    submitForm,
    refreshBackups,
    createBackup,
    smartBackup,
    deleteBackup,
    renameBackup,
    setNote,
    restoreBackup,
    // 折叠开关作用于「当前查看的会话」桶（可能不是流式回合的桶），
    // 直接改桶内条目并向前端发视图事件，不走 patchMessage 的回合路由
    toggleTool(id) {
      const item = bucketFor(viewKey()).find((m) => m.id === id);
      if (item) {
        item.open = !item.open;
        msgEvent({ op: "patch", id, patch: { open: item.open } });
      }
    },
    toggleThinking,
    toggleReasoning(id) {
      const item = bucketFor(viewKey()).find((m) => m.id === id);
      if (item) {
        item.reasoningOpen = !item.reasoningOpen;
        msgEvent({ op: "patch", id, patch: { reasoningOpen: item.reasoningOpen } });
      }
    },
    // 本地句柄查询（预览等 UI 场景只读使用；句柄不进 state）
    getLocalHandle() {
      return localRootHandle;
    },
  };
}
