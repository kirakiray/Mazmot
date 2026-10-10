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
  publishAppToHome,
  PUBLISH_NAMESPACE,
  sanitizeAppName,
  normalizeTaskList,
  mergeErrorTasks,
  errorTaskDigest,
  listAppFiles,
  readAppFile,
  writeAppFile,
  withTestingRule,
  createAppDir,
  createAppBackup,
  listAppBackups,
  sweepLegacyAutoBackups,
  pruneAppSnaps,
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
  pickAutoKey,
  COMPACTION_PROMPT,
  syncAppManifest,
} from "./builder.js";
import { diffLines, diffStat, compactHunks } from "./diff.js";
import {
  listTestCases,
  parseTestFile,
  runTestCases,
  summarizeResults,
} from "./test-runner.js";
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
    turningKey: "", // 进行中回合所属的 chatKey（响应式镜像；"" = 无进行中回合）
    stopRequested: false, // 用户点了停止、回合尚未收尾（按钮显示「停止中」并禁用）
    liveTurnStats: null, // 进行中回合的实时快照 { usage, stats, breakdown }（usage 事件写入，收尾清零）
    nextId: 1,
    turnStartTs: 0, // 进行中回合的开始时间戳（毫秒），「生成中」实时计时用
    keyError: "",
    coreError: "",
    reasoning: "low", // 推理等级偏好："off" / "low" / "medium" / "high" / "max"（无=不思考）
    // 推理等级菜单的可选项（跟随当前生效 key 的供应商 + 选中模型动态生成，
    // 各家档位不同；空数组 = 模型思考不可调）与夹取后的生效档位（"" = 不可调）
    effortOptions: [],
    effectiveReasoning: "",
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
    // 数据备份（当前应用的 backup/ 目录清单——只含发布与用户主动备份；
    // backupBusy 防创建重入）；currentHash 为当前 client/ 内容指纹
    //（「已回滚」派生态：回合快照 id 尾部与之相等即内容一致）
    backups: [],
    currentHash: "",
    backupBusy: false,
    // 场景测试（client/test/*.test.json）：tests 用例清单 / testResults 每用例
    // 上次结果（file → {ok, ms, consoleErrors, error, steps}）/ testLastRun
    // 全量摘要 {at, ok, pass, fail} / testRunning 执行进度 / testBusy 防重入
    tests: [],
    testResults: {},
    testLastRun: null,
    testRunning: null,
    testBusy: false,
    smartBackupBusy: false, // 智能备份：打包完成后的 AI 生成标题/备注阶段
    // 发布到首页应用列表：publishBusy 防重入；publishedInfo 为当前应用的
    // 发布态（null = 未发布；{ version, at } = 已发布，顶栏发布按钮提示用）；
    // publishMatch 为发布内容与当前代码的一致性（null = 未知 / 未发布，
    // true = 已是当前代码，false = 有未发布的修改），打开发布气泡时计算
    publishBusy: false,
    publishedInfo: null,
    publishMatch: null,
    publishShareUrl: "", // 已发布副本的 P2P 分享链接（?u=&h=，空 = 尚未生成）
    // 隔离预览（bridge 跨域推送）：previewBusy 防重入，previewStatus 为过程提示，
    // previewProgress 为结构化进度 {done, total}（顶栏小块进度条数据源，null = 无），
    // previewOnline 为预览窗口（应用页代理）在线状态（预览按钮亮标）
    previewBusy: false,
    previewStatus: "",
    previewProgress: null,
    previewOnline: false,
    // 多窗口预览（最多 10 个，含手机扫码设备）：窗口注册表快照 + 跨设备扫码
    // 入口（bridge 引导页 ?u=&app=；本机多窗口走「新开窗口」按钮，无需单独地址）
    // + 窗口缩略图缓存（winId → JPEG dataURL，气泡打开时经 thumb 指令抓取，空串 = 占位图）
    previewWindows: [],
    previewShareUrl: "",
    previewThumbs: {},
    // 宿主自动检测收集的预览运行错误（回合结束推送预览后读 console 的
    // error 行；下回合自动注入提示词，用户提示条可见）
    autoErrors: [],
    // 当前会话的任务清单（task_list 工具拆解 / 勾选，对话右侧面板渲染源；
    // 持久化在 tasks:<app>:<sid>，跨暂停 / 刷新续作；错误修复任务由
    // autoCheckPreview 自动同步加减）
    sessionTasks: [],
    // 对话用 API Key（镜像自 /mz/ai 的已启用 key；activeKeyId 为 "" 表示自动负载均衡）
    apiKeys: [],
    activeKeyId: "",
    activeModelId: "", // 手动选中的模型（"" = 供应商默认；须属于当前 key 可用清单）
    modelOptions: [], // 当前选中 key 的可选项（[{id,label}]，经 getModels 动态获取）
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
  // 响应式镜像（state.turningKey）：页面据此判断「当前视图是否为正在生成的
  // 会话」——生成中状态行与停止按钮只在回合视图显示，切到别的会话不再误
  // 显示全局状态。所有 turnKey 赋值一律走这里
  const setTurnKey = (v) => {
    turnKey = v;
    set("turningKey", v || "");
  };
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
  // 本地错误卡片：宿主在回合中发生的错误（如隔离预览失败）镜像进对话，
  // 紧跟触发它的工具调用便于定位问题。仅展示用——AI 的记忆走 wire thread，
  // 读不到这条消息（不传给 AI）。diag 可选：排查用诊断附件（链路事件等），
  // 只随消息落盘进对话 JSON，展示层忽略未知字段
  function pushLocalError(text, diag = null) {
    const item = {
      id: state.nextId++,
      role: "error",
      text: String(text).slice(0, 300),
      newGroup: false,
    };
    if (diag) item.diag = diag;
    return pushMessage(item);
  }
  // 预览诊断落档：把错误对象携带的 diag（链路事件段 + 推送上下文，见
  // remote-preview 的 attachDiag）写进对话 JSON——优先附在触发的 preview
  // 工具消息上（排查时紧跟现场），没有在途工具消息则补记到最近一条。
  // 仅持久化供人读：AI 上下文走 wire thread（工具返回值），不读消息桶
  function recordPreviewDiag(err) {
    const diag = err && err.diag;
    if (!diag) return;
    try {
      const bucket = bucketFor(activeKey());
      let target = null;
      for (let i = bucket.length - 1; i >= 0; i--) {
        const m = bucket[i];
        if (m.role !== "tool" || m.name !== "preview") continue;
        if (m.pending) {
          target = m;
          break;
        }
        if (!target) target = m;
      }
      if (target) patchMessage(target.id, { diag });
    } catch (_) {}
    console.warn("[preview][diag]", err?.message, diag);
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
  // 发送时即创建的全新项目 { appName, sid }：首回合用「空项目生成」提示词与
  // 工具清单（去掉 create_app），回合收尾出预览卡片后清空
  let freshTurn = null;
  // 本地目录渠道的根目录句柄（挂载后的 DirHandle），非响应式
  let localRootHandle = null;
  // 技能索引（plain 数组，对外经 state.skills 同步）
  let skillIndex = [];
  // /mz/ai 模块与 checkpointer 惰性产物

  let aiModules = null;
  let chainModules = null;
  let checkpointer = null;
  // /mz/net 联网能力模块（web_fetch 工具底层）
  let netModules = null;
  // /mz/ai/efforts.js（思考档位表；纯函数模块，惰性加载一次）
  let effortsModules = null;
  const ensureEfforts = async () => {
    if (!effortsModules) {
      effortsModules = await load("/mz/ai/efforts.js");
    }
    return effortsModules;
  };
  // 当前 Agent 实际使用的模型标识（deepseek 固定模型名，其余用 provider 名兜底）
  let activeModel = "";
  // 用户设定的上下文窗口大小（token），页面 select 切换时经 setContextWindow 注入；
  // 0 = 未设置（不做自动压缩）。仅用于发送前的水位判断，非响应式
  let contextWindow = 0;
  // 单回合工具循环步数上限（createAgent 的 maxSteps），页面「单轮步数」菜单
  // 切换时经 setMaxSteps 注入；默认 200（mz/ai 默认 80 对生成应用的完整
  // 写文件→预览→实测→修复流程偏紧）。非响应式
  let maxSteps = 200;
  // 本回合文件变更（[{path, op, prevText, nextText}]，同文件多次写保留
  // 「首改前 + 末改后」）：回合收尾统一算统计与行级内容，冻结进末条 AI 消息
  let turnChanges = [];
  // 本回合开始快照（createAppBackup 幂等内容寻址 id）：变更 diff 的旧侧 +
  // 一键回滚目标，收尾随 changes 一起挂到末条 AI 消息
  let turnSnapshotId = "";
  // 自动错误回路进行中标记（防重入）；收集到的错误行同步 state.autoErrors
  let autoCheckBusy = false;
  // 待消费的回滚通知：rollbackTurn 写入（appName 级），下一轮对话注入
  // 提示词后清除（一次性）
  let pendingRollback = null;

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

  // 参数值的展示文本：长字符串（如 code）截断省略并标注长度；对象/数组展开为紧凑 JSON 再截断
  const prettyValue = (v) => {
    let text = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    if (text.length > 80) text = `${text.slice(0, 80)}…(${text.length} 字符)`;
    return text;
  };

  const prettyArgs = (raw) => {
    let obj = raw;
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (!obj || typeof obj !== "object") return String(obj);
    const text = Object.entries(obj)
      .map(([k, v]) => `${k} = ${prettyValue(v)}`)
      .join("，");
    return text || JSON.stringify(obj);
  };

  /* ---------- Agent ---------- */

  const pickAssistant = async () => {
    const { getAssistant, getApiKeys } = aiModules;
    const keys = getApiKeys().filter((k) => !k.disabled);

    // key 选择：用户手动指定的优先（切换后经 invalidateAgent 生效），否则
    // 自动（pickAutoKey：deepseek 优先 / 单台锁定 / 多台随机负载均衡）
    let key = null;
    if (state.activeKeyId) {
      key = keys.find((k) => k.id === state.activeKeyId) || null;
    }
    if (!key) {
      key = pickAutoKey(keys);
    }

    // 模型选择：手动选中的模型优先，但须在已知可用清单里——清单来自
    // getModels 动态拉取（缓存数组）；拉取失败用内置表校验（缓存 null）；
    // 尚未拉取过（无缓存，如刷新后恢复的偏好）则不指定模型，relay 供应商
    // 会自行静默取上游首个可用模型，其余供应商走各自默认
    const cached = key ? modelOptionsCache.get(key.id) : undefined;
    const knownModels = Array.isArray(cached)
      ? cached.map((o) => o.id)
      : cached === null
        ? MODEL_OPTIONS[key.provider] || []
        : null;
    let model;
    if (
      key &&
      state.activeModelId &&
      (knownModels === null || knownModels.includes(state.activeModelId))
    ) {
      model = state.activeModelId;
    } else if (key?.provider === "deepseek") {
      model = "deepseek-flash";
    } else if (Array.isArray(knownModels) && knownModels.length) {
      // 未选模型（或选中的已不在清单里）：取已知清单第一个兜底，
      // 避免落到供应商默认模型上撞白名单 403
      model = knownModels[0];
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
    if (!netModules) {
      // 联网能力（web_fetch 工具的底层）：provider 解析见 /mz/net/README.md
      netModules = await load("/mz/net/main.js");
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
      // 模型覆写 app.json 时回填项目元数据（fresh 项目创建后的正式命名）；
      // 覆写 AGENTS.md 时失效缓存 Agent——下一回合重建即读到新版项目规则；
      // 同时记录本回合变更：同文件多次写只保留「首次写前内容 + 末次写后
      // 内容」，回合收尾一次性算行级 diff（即该回合真实的净变化）
      onFileWrite: (info) => {
        const hit = turnChanges.find((c) => c.path === info.path);
        if (hit) {
          hit.op = info.op || "write";
          hit.nextText = info.nextText ?? "";
        } else {
          turnChanges.push({
            path: info.path,
            op: info.op || "write",
            prevText: info.prevText ?? null,
            nextText: info.nextText ?? "",
          });
        }
        if (info?.path === "app.json") {
          syncAppMetaFromDisk(info.appName);
        } else if (info?.path === "AGENTS.md") {
          invalidateAgent();
        }
      },
      readSkill: (id, path) => readSkillFile(fs, id, path),
      requestForm,
      // 隔离预览调试（preview_* 工具）：推送入口 + dbg 指令通道 + 截图卡片
      openPreview: (appName) => {
        const hit = state.apps.find((a) => a.name === sanitizeAppName(appName));
        return runRemotePreview(appName, hit?.mode || state.currentAppMode);
      },
      previewDebug,
      // 多窗口清单（preview 工具 action=windows）：按需加载 remote-preview
      listPreviewWindows: async () => {
        const mod = await ensurePreviewMod();
        return mod.listPreviewWindows();
      },
      // 弹窗放行探测（preview 工具 action=check-popup）：被拦截后的确认重试用
      checkPopup: async () => {
        const mod = await ensurePreviewMod();
        return mod.checkPopupAllowed();
      },
      onPreviewShot: pushPreviewShot,
      // 场景测试（preview 工具 action=run-tests）：跑 client/test/ 下用例
      runTests: (files) => runTests(files),
      // 会话任务清单（task_list 工具）：拆解任务 / 随做随勾，右侧面板展示
      setSessionTasks: (tasks) => setSessionTasks(tasks),
      // web_fetch / web_search 工具：平台联网能力（mz/net 负责通道调度与结果规整）
      netFetch: (url, opts) => netModules.fetchText(url, opts),
      netSearch: (query, opts) => netModules.searchWeb(query, opts),
    });
    // 全新项目首回合：项目已由宿主建好，移除 create_app 并换「空项目生成」提示词
    const isFresh =
      !!freshTurn && freshTurn.appName === state.currentAppName;
    const toolList = Object.values(tools);
    // 已存在项目：自动读取项目 AGENTS.md 注入系统提示词（harness 常规机制——
    // 项目规则随会话开始自动生效，不依赖模型自觉去读；尚未写这份文档的新
    // 项目读不到则不注入，由提示词引导模型按需 read_file）
    let projectRules = "";
    if (!isFresh && state.currentAppName) {
      try {
        const rulesHandle = useLocal ? localRootHandle : undefined;
        const agentsRaw = await readAppFile(
          fs,
          state.currentAppName,
          "AGENTS.md",
          rulesHandle,
        );
        // 老项目迁移：AGENTS.md 缺「重要功能必须带场景测试」硬性约定时自动
        // 补齐并写回（新项目由 agents-template 模板自带）；本回合注入的就是
        // 补齐后的内容，失败则按原文注入不阻断
        projectRules =
          (await migrateAgentsTestingRule(agentsRaw, rulesHandle)) || "";
      } catch {
        projectRules = "";
      }
    }
    // 思考档位按当前模型支持情况夹取（各家档位不同，见 /mz/ai/efforts.js）；
    // 夹取结果为 null（模型思考不可调）时不注入思考参数；efforts 加载失败
    // 按旧逻辑直接使用偏好档位，不阻断回合
    let effort = state.reasoning;
    try {
      const { clampEffort } = await ensureEfforts();
      effort = clampEffort(assistant.providerName, model || "", state.reasoning);
    } catch {
      /* efforts 不可用：不夹取 */
    }
    agent = chainModules.createAgent({
      assistant,
      ...(model ? { model } : {}),
      thinking: !!effort && effort !== "off",
      ...(effort && effort !== "off" ? { reasoningEffort: effort } : {}),
      // 单回合步数上限（用户可在「单轮步数」菜单调整，见 setMaxSteps）
      maxSteps,
      tools: isFresh
        ? toolList.filter((t) => t.name !== "create_app")
        : toolList,
      // 注入当前应用上下文：已选应用时强制模型先读文件再回答/修改；
      // 同时列出可用技能知识库（read_skill）
      systemPrompt: buildSystemPrompt({
        appName: state.currentAppName || undefined,
        displayName: state.currentAppDisplay || undefined,
        mode: state.currentAppMode,
        skills: skillIndex,
        freshProject: isFresh,
        projectRules,
        // 上回合宿主自动检测收集的预览错误（预览窗口开着时才收集）：
        // 注入本回合提示词让模型优先修复；driveTurn 开始时取走清空
        autoErrors: state.autoErrors.length ? [...state.autoErrors] : undefined,
        // 当前会话任务清单（task_list 工具维护，按会话持久化）：每回合注入，
        // 模型跨回合 / 跨刷新续作清单（上下文压缩后记忆里未必还有它）
        sessionTasks: state.sessionTasks.length
          ? state.sessionTasks.map((t) => ({ ...t }))
          : undefined,
        // 待消费的回滚通知（中性 / 不满意）
        rollback:
          pendingRollback &&
          pendingRollback.appName === state.currentAppName
            ? { ...pendingRollback }
            : undefined,
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
    if (!/^(https?:\/\/|\/)/.test(trimmed)) {
      throw new Error("请输入 http(s) 或站内 / 开头的技能地址");
    }
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
    refreshPublishState(); // 发布态 + 与当前代码一致性（顶栏发布按钮 / 气泡用）
    refreshTests(); // 场景用例清单（测试抽屉 / 回合自动跑的存在性判断）
    restoreTestResults(); // 上次测试结果持久化还原
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
    // 刷新备份清单（含每项 current 标记）：变更卡「备份代码」的已备份感知依赖它
    refreshBackups();
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
    const tasks = await loadSessionTasks(state.currentAppName, sid);
    if (sessionTasksKey() === tasksKey) set("sessionTasks", tasks);
    if (key === turnKey) {
      // 切回正在进行流式回合的会话：直接投影内存实时桶，
      // 不能读盘覆盖（盘上是上一回合的旧内容，读盘会顶掉进行中的消息）
      projectBucket(key);
    } else {
      const saved = (await selfStore.getItem(key)) || [];
      // await 期间视图可能已被其他流程接管（回合收尾迁移草稿 / 自动切换
      // 应用）：目标已不是当前视图则放弃替换，避免过期 key 覆盖新视图
      if (key === viewKey()) {
        replaceMessages(saved, key);
      }
    }
    invalidateAgent(); // 会话切换后重建 Agent（threadId 变化）
  }

  // 回到「新应用」草稿（写入目标重新可选）。新流程下草稿桶永远是空的
  // （用户一开口即建项目），历史遗留的草稿数据一律清除
  async function startDraft(wipeDraft = false) {
    freshTurn = null; // 离开项目上下文，未消费的首回合标记作废
    setMany({
      currentAppName: "",
      currentAppDisplay: "",
      currentAppIcon: "📦",
      currentAppMode: "vfs",
      currentAppSessions: [],
      currentSessionId: "",
      currentSessionTitle: "",
      sessionTasks: [], // 草稿没有会话实体，清单不可用
      permGrantNeeded: false,
      keyError: "", // 离开本地应用上下文，旧提示随之清除
      publishedInfo: null, // 回到草稿：发布态随应用上下文清空
      publishMatch: null,
      publishShareUrl: "",
    });
    localRootHandle = null;
    set("localDirLabel", "");
    invalidateAgent();
    if (selfStore) {
      await selfStore.removeItem("chat:draft");
      await selfStore.removeItem("thread:draft");
      // 草稿回合进行中被整体清空：中断并丢弃实时桶，避免回合收尾复活已删内容
      if (turnKey === "chat:draft") {
        stop();
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
      invalidateAgent();
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

  /* ---------- 推理等级 ---------- */

  // 切换推理等级并持久化偏好；Agent 随之重建（注入前按当前模型夹取档位，
  // 见 ensureAgent 的 clampEffort；偏好存用户视角档位，菜单项为当前模型可用档）
  async function setReasoning(level) {
    if (!["off", "minimal", "low", "medium", "high", "max"].includes(level)) return;
    set("reasoning", level);
    invalidateAgent();
    refreshEffortOptions();
    if (selfStore) {
      try {
        await selfStore.setItem("pref:reasoning", level);
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
    // 本地渠道：从项目快照目录移除该会话的文件（全量同步带孤儿清理）
    const delApp = (await loadRegistry()).find((a) => a.name === name);
    if (delApp?.mode === "local") await syncLocalProjectChats(name);
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
        setMany({ currentSessionId: "", currentSessionTitle: "", sessionTasks: [] });
        replaceMessages([]);
      }
    }
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

  /* ---------- 上下文压缩 ---------- */

  // 把 wire 消息拼成摘要请求用的对话稿（超长内容掐头留尾，防止摘要请求本身撑爆窗口）
  const clip = (t, n) => {
    const text = String(t ?? "");
    if (text.length <= n) return text;
    const half = Math.floor(n / 2);
    return text.slice(0, half) + "\n…[过长截断]…\n" + text.slice(-half);
  };
  // user 消息 content 的文本视图：多模态 wire（OpenAI content 数组）取 text 部分
  // 拼接并标注图片张数，供压缩 transcript 等纯文本场景使用
  const wireTextOf = (content) => {
    if (!Array.isArray(content)) return String(content ?? "");
    const texts = content
      .filter((p) => p?.type === "text")
      .map((p) => String(p.text ?? ""));
    const nImg = content.filter((p) => p?.type === "image_url").length;
    return texts.join("\n") + (nImg ? `\n[本条含 ${nImg} 张图片]` : "");
  };
  const buildTranscript = (thread) =>
    thread
      .map((m) => {
        if (m.role === "user") return `用户：${clip(wireTextOf(m.content), 3000)}`;
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

  // 设定单回合步数上限（createAgent 的 maxSteps）；agent 按会话缓存，
  // 这里置失效让下回合重建时带上新值（对话记忆在 checkpointer，不丢）
  function setMaxSteps(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 20 || v > 9999 || v === maxSteps) return;
    maxSteps = v;
    invalidateAgent();
  }

  /* ---------- 对话 API Key 切换 ---------- */

  const API_KEY_LIST_KEY = "pref:active-key";

  // 各 key 的可用模型缓存：keyId → [{id,label}]（getModels 成功）/ null（失败，
  // 校验与展示回退 MODEL_OPTIONS 内置表）/ 无记录（未拉取）
  const modelOptionsCache = new Map();
  let modelOptionsSeq = 0; // 串行化竞态：仅最后一次拉取允许写入 state

  const staticModelOptions = (key) =>
    (MODEL_OPTIONS[key?.provider] || []).map((id) => ({ id, label: id }));

  // 模型下拉数据源（st-select :options）：头部恒置「自动」项
  const applyModelOptions = (list) => {
    set("modelOptions", list);
    set("modelSelectOptions", [
      { value: "", label: "自动（供应商默认）" },
      ...list,
    ]);
    refreshEffortOptions();
  };

  // 推理等级菜单可选项：跟随当前生效 key 的供应商 + 选中模型（未选模型取
  // 清单首项，即供应商默认）动态生成（各家档位不同，见 /mz/ai/efforts.js），
  // 同时把用户偏好夹取为生效档位 effectiveReasoning（"" = 模型思考不可调）
  function refreshEffortOptions() {
    if (!effortsModules) return; // efforts 尚未加载（init 会补一次）
    const { effortLevelsFor, clampEffort, EFFORT_LABELS } = effortsModules;
    const key = state.activeKeyId
      ? state.apiKeys.find((k) => k.id === state.activeKeyId)
      : pickAutoKey(state.apiKeys);
    const provider = key?.provider || "";
    const model = state.activeModelId || state.modelOptions[0]?.id || "";
    const levels = effortLevelsFor(provider, model);
    set(
      "effortOptions",
      levels.map((id) => ({ id, label: EFFORT_LABELS[id] || id })),
    );
    set("effectiveReasoning", clampEffort(provider, model, state.reasoning) || "");
  }

  // 拉取当前生效 key 的可用模型（getModels，relay 供应商即 /v1/models），
  // 写入 state.modelOptions 供输入区气泡展示。静默自动拉取：进应用 / key 列表
  // 变化（syncApiKeyList）/ 手动切换 key 时都会执行，「自动」模式下解析的是
  // 自动选择将命中的 key（deepseek 优先，否则第一台），无需用户手动点开菜单
  async function refreshModelOptions() {
    const seq = ++modelOptionsSeq;
    const key = state.activeKeyId
      ? state.apiKeys.find((k) => k.id === state.activeKeyId)
      : pickAutoKey(state.apiKeys);
    if (!key || !aiModules?.getAssistant) {
      set("modelOptions", []);
      refreshEffortOptions();
      return;
    }
    const cached = modelOptionsCache.get(key.id);
    if (cached !== undefined) {
      applyModelOptions(cached === null ? staticModelOptions(key) : cached);
      return;
    }
    modelOptionsCache.set(key.id, null); // 占位防并发重复拉取
    try {
      const assistant = aiModules.getAssistant(key.id);
      const models = await assistant.getModels();
      const list = (Array.isArray(models) ? models : [])
        .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
        .filter((id) => typeof id === "string" && id)
        .map((id) => ({ id, label: id }));
      modelOptionsCache.set(key.id, list);
      if (seq === modelOptionsSeq) applyModelOptions(list);
    } catch (err) {
      console.warn("获取模型列表失败，回退内置清单：", err?.message ?? err);
      modelOptionsCache.delete(key.id); // 不缓存失败结果，下次切换重试
      if (seq === modelOptionsSeq) applyModelOptions(staticModelOptions(key));
    }
  }

  // 把 /mz/ai 的 key 列表镜像进 state（只留展示所需字段）
  function syncApiKeyList(keys) {
    const active = (keys || []).filter((k) => !k.disabled);
    set(
      "apiKeys",
      active.map((k) => ({
        id: k.id,
        provider: k.provider,
        maskedKey: k.maskedKey,
        // relay 中转服务器的自定义命名（选择 provider 时展示）
        serverName: k.serverName,
      })),
    );
    set(
      "apiSelectOptions",
      [
        { value: "", label: "自动选择" },
        ...active.map((k) => ({
          value: k.id,
          label: `${k.provider === "relay" ? k.serverName || "Relay" : k.provider} · ${k.maskedKey}`,
        })),
      ],
    );
    // 选中的 key 已被删/禁用：回退自动
    if (state.activeKeyId && !keys?.some((k) => k.id === state.activeKeyId && !k.disabled)) {
      selectApiKey("");
    }
    refreshModelOptions();
  }

  // 切换对话模型（"" = 供应商默认）；切换即 invalidateAgent 下一回合生效，
  // 思考档位表跟随新模型重算
  async function selectModel(id) {
    if (state.activeModelId === id) return;
    set("activeModelId", id);
    invalidateAgent();
    refreshEffortOptions();
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
    refreshModelOptions();
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

  // share-mgr 模块缓存（发布副本的 P2P 分享：ensureUser / publishApp / buildRunUrl）
  let shareMod = null;
  async function ensureShareMod() {
    if (!shareMod) shareMod = await load("/mz/share-mgr.js");
    return shareMod;
  }

  // remote-preview 模块缓存（预览主流程 / 窗口清单 / 分享地址共用）
  let previewMod = null;
  async function ensurePreviewMod() {
    if (!previewMod) {
      previewMod = await load("/official-apps/conjure/lib/remote-preview.js");
    }
    return previewMod;
  }

  // 收集指定应用的全部文件（VFS 渠道读 ai-apps/<name>/client/，
  // 本地渠道恢复句柄后复用 app-runner 的 readAppFiles，优先 client/ 子目录）；
  // onFile({done, total, path}) 逐文件进度回调（本地渠道为整包读，仅结束时报一次）
  async function collectAppFiles(name, mode, onFile = null) {
    const report = (done, total, path) => {
      try {
        onFile?.({ done, total, path });
      } catch (_) {}
    };
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
      const list = raw.map((f) => ({ path: f.path, text: f.content }));
      report(list.length, list.length, "");
      return list;
    }
    const paths = await listAppFiles(fs, name);
    const files = [];
    let i = 0;
    for (const p of paths) {
      const text = await readAppFile(fs, name, p);
      i++;
      if (text != null) files.push({ path: p, text });
      report(i, paths.length, p);
    }
    return files;
  }

  // 隔离预览推送主流程（预览按钮与 preview 工具共用）：
  // 收集文件 → 推送到 bridge 隔离域运行（AI 代码不接触主域数据）→
  // 同步其余在线预览窗口（多窗口：手机扫码设备等一并增量更新）。
  // 失败写入 keyError 并抛出（调用方决定是否吞掉），成功返回 done（含运行 url）
  async function runRemotePreview(appName, mode) {
    const name = sanitizeAppName(appName);
    if (!name) throw new Error("应用名不合法");
    if (state.previewBusy) throw new Error("预览推送进行中，请稍候再试");
    set("previewBusy", true);
    set("previewStatus", "准备推送...");
    set("previewProgress", null);
    try {
      const mod = await ensurePreviewMod();
      const files = await collectAppFiles(name, mode, (p) => {
        set("previewStatus", `读取文件 ${p.done}/${p.total}：${p.path}`);
        set("previewProgress", p);
      });
      if (!files.length) throw new Error("应用目录为空，请先生成应用文件");
      const done = await mod.openRemotePreview({
        load,
        appName: name,
        files,
        selfStore,
        onStatus: (text) => set("previewStatus", text),
        onProgress: (p) => set("previewProgress", p),
      });
      // 其余在线窗口一并同步（排除刚推完的主窗口对端）；失败逐个吞掉不阻断
      try {
        const primaryId = await mod.getPrimaryBridgeId(selfStore);
        const others = mod
          .listPreviewWindows()
          .filter((w) => w.online && primaryId && !w.id.startsWith(`${primaryId}|`))
          .map((w) => w.id);
        if (others.length) {
          const peerIds = [...new Set(others.map((id) => id.split("|")[0]))];
          await mod.syncPreviewPeers({
            load,
            appName: name,
            files,
            peerIds,
            onStatus: (text) => set("previewStatus", text),
            onProgress: (p) => set("previewProgress", p),
          });
        }
      } catch (err) {
        console.warn("[preview] 多窗口同步失败（主窗口已更新）：", err);
      }
      refreshPreviewWindows(mod);
      refreshPreviewInfo();
      return done;
    } catch (err) {
      recordPreviewDiag(err);
      // 回合中（preview 工具触发）：不弹横幅，错误卡片镜像进对话、紧跟
      // 工具调用（AI 仍从工具结果文本得知失败）；非回合入口走可关闭横幅
      if (state.sending) {
        pushLocalError(`隔离预览失败：${err.message}`, err?.diag || null);
      } else {
        set("keyError", `隔离预览失败：${err.message}`);
      }
      throw err;
    } finally {
      set("previewBusy", false);
      set("previewStatus", "");
      set("previewProgress", null);
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

  // 新开一个预览窗口（槽位 popup）：引导页打开后由 onBridgeHello 钩子自动推送
  // 当前应用；窗口上限与弹窗拦截错误抛给调用方展示
  async function openNewPreviewWindow() {
    const name = sanitizeAppName(state.currentAppName);
    if (!name) throw new Error("还没有正在开发的应用，先创建应用再预览");
    if (state.previewBusy) throw new Error("预览推送进行中，请稍候再试");
    set("previewBusy", true);
    set("previewStatus", "新开预览窗口...");
    try {
      const mod = await ensurePreviewMod();
      const r = await mod.openPreviewWindow({ load, app: name });
      set("previewStatus", `预览窗口 #${r.slot} 已打开，等待应用推送...`);
      return r;
    } catch (err) {
      set("keyError", `新开预览窗口失败：${err.message}`);
      throw err;
    } finally {
      set("previewBusy", false);
    }
  }

  // 扫码 / 新开窗口的 bridge 引导页 hello（onBridgeHello 钩子）：自动把应用
  // 推给该对端。优先推 hello 指定的应用（?app=），不存在则回退当前应用；
  // 推送在 remote-preview 内部串行排队，失败只打日志（对端引导页有进度/错误展示）
  async function pushToWindow(peerId, appName) {
    try {
      const mod = await ensurePreviewMod();
      const hint = sanitizeAppName(appName);
      const hit = state.apps.find((a) => a.name === hint);
      const name = hit ? hint : sanitizeAppName(state.currentAppName);
      if (!name) return;
      const mode = hit
        ? hit.mode
        : state.apps.find((a) => a.name === name)?.mode || state.currentAppMode;
      const files = await collectAppFiles(name, mode, (p) => {
        set("previewStatus", `读取文件 ${p.done}/${p.total}：${p.path}`);
        set("previewProgress", p);
      });
      if (!files.length) return;
      await mod.syncPreviewPeers({
        load,
        appName: name,
        files,
        peerIds: [peerId],
        onStatus: (text) => set("previewStatus", text),
        onProgress: (p) => set("previewProgress", p),
      });
    } catch (err) {
      console.warn("[preview] 新窗口自动推送失败：", err);
    } finally {
      set("previewStatus", "");
      set("previewProgress", null);
    }
  }

  // 窗口注册表快照 → state（下拉气泡渲染源）；previewWindows 变更统一走这里
  function refreshPreviewWindows(mod) {
    try {
      const list = (mod || previewMod)?.listPreviewWindows?.() || [];
      set("previewWindows", list);
    } catch (_) {}
  }

  /* ---------- 预览能力桥 broker（remote-preview 接线） ----------
   * 预览域的 /mz/* 替身（bridge/guest/*）经能力桥发来的调用：用主容器当前
   * 选中的 key/模型（pickAssistant）与联网通道（mz/net）执行，结果序列化后
   * 回传。key 与通道配置永不过桥；模型/推理档位不开放 guest 指定（统一用
   * 主界面当前选中项，防止生成代码烧不认识的贵模型）。并发闸与窗口校验在
   * remote-preview.handleCapEnvelope（本函数只做单次执行）。
   */
  async function handleCapRequest({ cap, args, onChunk, signal }) {
    if (cap === "ai.chat") {
      const messages = Array.isArray(args.messages) ? args.messages : null;
      if (!messages?.length) throw new Error("ai.chat：messages 不能为空");
      if (!aiModules) aiModules = await load("/mz/ai/main.js");
      const { assistant, model } = await pickAssistant();
      const res = await assistant.chat({
        ...(model ? { model } : {}),
        thinking: args.thinking === true,
        stream: true,
        messages,
        onStream: (d) =>
          onChunk({ delta: d.delta || "", deltaReasoning: d.deltaReasoning || "" }),
        signal,
      });
      return {
        content: res.content ?? "",
        reasoningContent: res.reasoningContent ?? "",
        model: res.model ?? model ?? "",
        usage: res.usage ?? null,
      };
    }
    if (cap === "ai.models") {
      if (!aiModules) aiModules = await load("/mz/ai/main.js");
      const { assistant } = await pickAssistant();
      const models = await assistant.getModels();
      return { models: Array.isArray(models) ? models : [] };
    }
    if (cap === "net.fetch") {
      if (!netModules) netModules = await load("/mz/net/main.js");
      const res = await netModules.fetch(String(args.url ?? ""), { signal });
      let text = await res.text();
      let truncated = !!res.truncated;
      if (text.length > 400_000) {
        text = text.slice(0, 400_000);
        truncated = true;
      }
      return {
        url: res.url,
        status: res.status,
        ok: res.ok,
        truncated,
        provider: res.provider,
        contentType: res.headers?.get?.("content-type") || "",
        text,
      };
    }
    if (cap === "net.fetchText") {
      if (!netModules) netModules = await load("/mz/net/main.js");
      const maxChars = Number(args.maxChars);
      return await netModules.fetchText(String(args.url ?? ""), {
        raw: args.raw === true,
        noCache: args.noCache === true,
        ...(Number.isFinite(maxChars) && maxChars > 0 ? { maxChars } : {}),
        signal,
      });
    }
    if (cap === "net.searchWeb") {
      if (!netModules) netModules = await load("/mz/net/main.js");
      return await netModules.searchWeb(String(args.query ?? ""), {
        signal,
        ...(args.engine ? { engine: args.engine } : {}),
      });
    }
    throw new Error(`未知能力：${cap}`);
  }

  // 跨设备扫码入口地址：bridge 引导页（?u=<conjure userId>&app=<应用>），
  // 手机扫码即自动收到当前应用
  async function refreshPreviewInfo() {
    try {
      const mod = await ensurePreviewMod();
      const name = sanitizeAppName(state.currentAppName);
      if (!name) {
        set("previewShareUrl", "");
        return;
      }
      const { userId } = await mod.getPreviewIdentity({ load });
      set(
        "previewShareUrl",
        `${mod.BRIDGE_ORIGIN}/bridge/?u=${encodeURIComponent(userId)}` +
          `&app=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      console.warn("[preview] 预览地址生成失败：", err);
    }
  }

  // 窗口缩略图抓取（预览气泡打开时调用 + 打开期间定时刷新）：逐个在线窗口
  // 定向发 wire 指令。wire 两级返回：① snapdom 真实渲染截图（vendor 本地库，
  // shadow DOM/字体/渐变保真，免屏幕授权、手机可用）的 JPEG dataURL 直接用；
  // ② 线框节点清单 JSON → thumb-paint 本地重绘近似图兜底。失败置空串由占位
  // 图兜底。thumbSeq 过期守卫防面板已关闭/新一轮已启动后旧结果继续写入
  let thumbSeq = 0;
  async function refreshPreviewThumbs() {
    const seq = ++thumbSeq;
    try {
      const mod = await ensurePreviewMod();
      const paint = await load("/official-apps/conjure/lib/thumb-paint.js");
      const validIds = new Set(state.previewWindows.map((w) => w.id));
      const next = {};
      for (const [k, v] of Object.entries(state.previewThumbs)) {
        if (validIds.has(k)) next[k] = v; // 清掉已消失窗口的旧缩略图
      }
      for (const w of state.previewWindows.filter((x) => x.online)) {
        try {
          const outcome = await mod.debugPreviewCommand({
            load,
            selfStore,
            cmd: "wire",
            args: {},
            timeoutMs: 20_000,
            winId: w.id,
          });
          const raw = outcome?.result || "";
          next[w.id] = raw.startsWith("data:image")
            ? raw
            : paint.paintWireframe(JSON.parse(raw || "{}"));
        } catch {
          next[w.id] = "";
        }
        if (seq !== thumbSeq) return; // 面板已关 / 新一轮抓取已启动
        set("previewThumbs", { ...next });
      }
    } catch (err) {
      console.warn("[preview] 窗口缩略图抓取失败：", err);
    }
  }

  // 调试指令通道（preview 工具）：转发到 remote-preview 的 dbg 链路；
  // winId 缺省投递给最近心跳的在线窗口。失败同样落诊断（dbg 超时/投递
  // 失败没有错误卡，diag 只能附在工具消息上）
  async function previewDebug(cmd, args = {}, timeoutMs, winId) {
    const mod = await ensurePreviewMod();
    try {
      return await mod.debugPreviewCommand({
        load,
        selfStore,
        cmd,
        args,
        timeoutMs,
        winId: winId || null,
      });
    } catch (err) {
      recordPreviewDiag(err);
      throw err;
    }
  }

  /* ---------- 会话任务清单（task_list 工具 / 对话右侧面板） ----------
   * 模型开发前拆解任务、随做随勾；清单按会话持久化（tasks:<app>:<sid>），
   * 暂停 / 刷新后继续开发时原样恢复。预览自动检测的运行错误由
   * syncErrorTasks 自动登记为修复任务、验证通过后自动勾掉（不依赖模型）。
   * 纯逻辑（规整 / 错误合并）在 builder.js，供单测。 */

  // 当前会话的任务清单存储键；草稿（发送即建项目）与无会话态没有清单
  const sessionTasksKey = () =>
    state.currentAppName === "" || state.currentSessionId === ""
      ? null
      : `tasks:${state.currentAppName}:${state.currentSessionId}`;

  // 写状态镜像 + 落盘（小数据直接写，不防抖）
  function applySessionTasks(list) {
    set("sessionTasks", list);
    const key = sessionTasksKey();
    if (key && selfStore) {
      selfStore.setItem(key, list.map((m) => ({ ...m }))).catch(() => {});
    }
  }

  // 读取某会话的任务清单（无记录 = 空清单）
  async function loadSessionTasks(appName, sid) {
    if (!selfStore || !appName || !sid) return [];
    try {
      const saved = await selfStore.getItem(`tasks:${appName}:${sid}`);
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  // task_list 工具入口：全量替换清单（TodoWrite 语义）。返回给模型的
  // 结果文本带最新进度，模型据此汇报
  function setSessionTasks(tasks) {
    const key = sessionTasksKey();
    if (!key) {
      return "任务清单不可用：当前没有活动会话（发送首条消息建立会话后再用）";
    }
    const list = normalizeTaskList(tasks);
    if (!list) {
      return "tasks 无效：需要非空数组 [{ text: 任务描述, status: pending|in_progress|done }]，text 必填（≤120 字）";
    }
    applySessionTasks(list);
    // 模型重写清单（需求变化）时，当前仍检测在案的运行错误自动补回，
    // 防「错误修完前清单被整体替换导致修复任务丢失」
    if (state.autoErrors?.length) syncErrorTasks(state.autoErrors);
    // 清单进了系统提示词（「当前任务清单」节）：作废缓存的 Agent，下一
    // 回合重建即带上最新清单（运行中回合持有自身引用，不受影响）
    invalidateAgent();
    const done = state.sessionTasks.filter((t) => t.status === "done").length;
    return `任务清单已更新（${done}/${state.sessionTasks.length} 完成）：${state.sessionTasks
      .map((t, i) => `${i + 1}.[${t.status}]${t.text}`)
      .join("；")}`;
  }

  // 预览运行错误 ↔ 修复任务同步：新错误自动登记、消失的错误自动勾完成。
  // 由 autoCheckPreview（每回合收尾后的自动检测）与 setSessionTasks（模型
  // 重写清单）共同调用，保证「检测在案的错误必然有对应任务」
  function syncErrorTasks(lines) {
    const key = sessionTasksKey();
    if (!key) return;
    const merged = mergeErrorTasks(state.sessionTasks, lines);
    if (merged !== state.sessionTasks) applySessionTasks(merged);
  }

  // 回合后自动错误检测：推送最新代码 → 等应用重载与首轮报错 → 读 console
  // 的 error 行挂 state.autoErrors（fire-and-forget，不阻塞回合收尾；重入
  // 保护防连发回合叠加）。仅在预览窗口已开时被调用，不自动开窗
  async function autoCheckPreview(appName) {
    if (autoCheckBusy) return;
    autoCheckBusy = true;
    try {
      const hit = state.apps.find((a) => a.name === appName);
      await runRemotePreview(appName, hit?.mode || "vfs");
      await new Promise((r) => setTimeout(r, 2200));
      const outcome = await previewDebug("console", { limit: 30 });
      const lines = String(outcome?.result ?? "")
        .split("\n")
        .filter((l) => l.includes("[error]"))
        .slice(-6);
      set("autoErrors", lines);
      // 错误 ↔ 任务同步：新错误进清单（用户在面板看到「要修什么」），
      // 已消失的错误勾完成（修完自动打钩，不依赖模型记得）
      syncErrorTasks(lines);
      if (lines.length) invalidateAgent(); // 下回合重建提示词带上错误
    } catch (err) {
      console.warn("[autoCheck] 预览自动检测失败：", err);
    } finally {
      autoCheckBusy = false;
    }
  }

  // 用户忽略自动检测到的错误：清空（下回合提示词不再注入；新错误会重新收集）
  function dismissAutoErrors() {
    set("autoErrors", []);
  }

  // 关闭错误横幅（keyError 仅提示用；关闭不代表问题已解决，下次出错会再弹）
  function dismissError() {
    set("keyError", "");
  }

  // 老项目 AGENTS.md 迁移（withTestingRule 判定与插入，这里只做 IO）：缺场景
  // 测试硬性约定时补一条并写回，返回注入用内容；raw 为 null（尚无该文件）或
  // 写入失败时原样返回，不阻断注入
  async function migrateAgentsTestingRule(raw, rootHandle) {
    if (raw == null) return raw;
    const next = withTestingRule(raw);
    if (next == null) return raw;
    try {
      await writeAppFile(
        fs,
        state.currentAppName,
        "AGENTS.md",
        next,
        rootHandle,
      );
    } catch (err) {
      console.warn("[builder] AGENTS.md 补测试约定失败：", err);
      return raw;
    }
    return next;
  }

  /* ---------- 场景测试（client/test/*.test.json，经预览调试通道执行） ---------- */

  const testResultsKey = (appName) => `test-results:${sanitizeAppName(appName)}`;

  // 用例清单（测试抽屉 / 回合自动跑的存在性判断）
  async function refreshTests() {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      set("tests", await listTestCases(fs, state.currentAppName, rootHandle));
    } catch (err) {
      console.warn("读取测试用例失败：", err);
    }
  }

  // 还原上次全量测试结果（随应用切换加载；草稿态清空）
  async function restoreTestResults() {
    if (state.currentAppName === "" || !selfStore) {
      setMany({ testResults: {}, testLastRun: null });
      return;
    }
    try {
      const saved = await selfStore.getItem(testResultsKey(state.currentAppName));
      set("testResults", saved?.results ? Object.fromEntries(saved.results.map((r) => [r.file, r])) : {});
      set("testLastRun", saved ? { at: saved.at, ok: saved.ok, pass: saved.pass, fail: saved.fail } : null);
    } catch {
      /* 还原失败按无结果处理 */
    }
  }

  // reload 步骤后等调试代理回线：轮询 status 直到可应答（应用页重载会打断
  // dbg 链路，inject 重新挂载并心跳后恢复）
  async function waitTestAgentOnline(timeoutMs = 30_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        await previewDebug("status", {}, 5_000);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    return false;
  }

  /**
   * 跑场景用例（files 缺省 = 全部）：确保预览在线（离线先走推送流程，测的
   * 永远是最新代码）→ 逐条执行 → 结果落 state.testResults / testLastRun 并
   * 持久化（test-results:<app>）；失败行写 autoErrors 回流下回合修复
   */
  async function runTests(files) {
    if (state.testBusy || state.currentAppName === "" || !fs) return null;
    set("testBusy", true);
    try {
      await refreshTests();
      const all = state.tests.filter((t) => !t.broken);
      const picked = files?.length ? all.filter((t) => files.includes(t.file)) : all;
      if (!picked.length) {
        return { ok: true, noTests: true, summary: "没有测试用例", results: [] };
      }
      // 连接预检：previewOnline 可能是陈旧亮标（窗口已关 / 页面卡死），
      // status 探活失败就重推最新代码再跑
      try {
        await previewDebug("status", {}, 8_000);
      } catch {
        await runRemotePreview(state.currentAppName, state.currentAppMode);
      }
      const rootHandle = await backupRootHandle();
      const cases = [];
      for (const t of picked) {
        const raw = await readAppFile(fs, state.currentAppName, t.file, rootHandle);
        const parsed = parseTestFile(raw, t.file);
        cases.push({ file: t.file, name: parsed.name, steps: parsed.steps });
      }
      const results = await runTestCases({
        cases,
        previewDebug,
        waitOnline: waitTestAgentOnline,
        onProgress: (p) => set("testRunning", p),
        // 用例中途连接失效的自愈：重推预览 + 等回线后重试该用例
        recover: async () => {
          await runRemotePreview(state.currentAppName, state.currentAppMode);
          await waitTestAgentOnline();
        },
      });
      const pass = results.filter((r) => r.ok).length;
      const summary = {
        at: Date.now(),
        ok: pass === results.length,
        pass,
        fail: results.length - pass,
      };
      set("testResults", Object.fromEntries(results.map((r) => [r.file, r])));
      set("testLastRun", summary);
      set("testRunning", null);
      try {
        await selfStore.setItem(testResultsKey(state.currentAppName), {
          at: summary.at,
          ok: summary.ok,
          pass,
          fail: summary.fail,
          results,
        });
      } catch {
        /* 结果持久化失败不影响本次报告 */
      }
      // 失败回流：写 autoErrors（下回合提示词自动附带，UI 可忽略），AI 从
      // 摘要行定位失败用例
      const fails = results.filter((r) => !r.ok);
      if (fails.length) {
        set(
          "autoErrors",
          fails.map((r) => `[测试] ${r.name}：${r.error}`),
        );
        invalidateAgent();
      }
      return { ok: summary.ok, summary: summarizeResults(results), results };
    } catch (err) {
      set("keyError", `测试执行失败：${err.message}`);
      return null;
    } finally {
      set("testBusy", false);
      set("testRunning", null);
    }
  }

  // 回合收尾自动跑（fire-and-forget，不阻塞收尾）：仅预览窗口已开时，与
  // autoCheckPreview 同策略不自动开窗打扰
  async function autoRunTests() {
    if (state.testBusy) return;
    await refreshTests();
    if (!state.tests.length) return;
    await runTests();
  }

  // 变更卡展开：快照（该回合开始前）vs 当前盘上指定文件的行级 diff。
  // 历史回合展开时当前盘可能含后续回合改动（diff 随时间漂移，UI 如实标注）
  async function getTurnDiff(appName, snapshotId, path) {
    try {
      const hit = state.apps.find((a) => a.name === appName);
      const handle = hit?.mode === "local" ? localRootHandle : undefined;
      const files = await readBackupFiles(fs, appName, snapshotId, handle);
      const prev = files.find((f) => f.path === path)?.text ?? "";
      const cur = (await readAppFile(fs, appName, path, handle)) ?? "";
      if (prev === cur) return { hunks: [], same: true };
      return { hunks: compactHunks(diffLines(prev, cur), 3), same: false };
    } catch (err) {
      return { hunks: [], same: false, error: err.message };
    }
  }

  // 一键回滚到回合前快照（restoreAppBackup 清空 client/ 后按备份写回；
  // unchanged = 当前内容与快照一致未写入）。opts.sentiment："neutral"（默认）
  // / "dissatisfied"（用户对该回合改动不满意）；opts.requestText 为该回合的
  // 用户请求摘要（不满意通知里带给模型，让它知道否决的是哪次改动）。
  // 回滚后失效 Agent 并登记待消费通知——下次对话（同应用）注入「回滚通知」，
  // AI 感知回滚与反馈，不凭旧记忆把撤销的内容写回
  async function rollbackTurn(appName, snapshotId, opts = {}) {
    const hit = state.apps.find((a) => a.name === appName);
    const handle = hit?.mode === "local" ? localRootHandle : undefined;
    const res = await restoreAppBackup(fs, appName, snapshotId, handle);
    pendingRollback = {
      appName,
      sentiment: opts.sentiment === "dissatisfied" ? "dissatisfied" : "neutral",
      requestText: String(opts.requestText || "").slice(0, 120),
    };
    invalidateAgent();
    try {
      await syncAppMetaFromDisk(appName);
    } catch {
      /* meta 同步失败不阻塞回滚结果 */
    }
    await refreshBackups();
    return res;
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

  /* ---------- 数据备份与回合快照（client/ 同层 backup/ 与 snaps/ 目录） ---------- */

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

  // 读当前应用在 mazmot apps[] 登记记录里的发布态（mazmot 子对象，无则 null）
  async function readPublishedMeta() {
    if (!mazmotStore || state.currentAppName === "") return null;
    try {
      const apps = (await mazmotStore.getItem("apps")) || [];
      const rec = apps.find(
        (a) => a.mazmot?.source === "ai-builder" && a.name === state.currentAppName,
      );
      return rec?.mazmot?.published ? rec.mazmot : null;
    } catch {
      return null;
    }
  }

  // 同步发布态到页面状态（顶栏发布按钮提示；切应用 / 发布后调用）
  async function syncPublishedInfo() {
    const meta = await readPublishedMeta();
    set(
      "publishedInfo",
      meta ? { version: meta.publishedVersion, at: meta.publishedAt } : null,
    );
  }

  // 计算发布内容与当前代码的一致性（打开发布气泡时调用）：
  // publishMatch = true（已是当前代码）/ false（有未发布的修改）/ null（未知）；
  // 同时解析发布副本的 P2P 分享链接（优先用上次发布记住的，否则按副本
  // payloadHash 现场拼装）
  async function refreshPublishState() {
    await syncPublishedInfo();
    let match = null;
    let shareUrl = "";
    if (state.publishedInfo && fs && state.currentAppName !== "") {
      try {
        const rootHandle = await backupRootHandle();
        const meta = await readPublishedMeta();
        const hash = await currentAppHash(fs, state.currentAppName, rootHandle);
        match = hash !== "" && meta?.publishedHash === hash;
      } catch {
        match = null;
      }
      try {
        const shareMgr = await ensureShareMod();
        const meta = await readPublishedMeta();
        if (meta?.publishedShare?.shareUrl) {
          shareUrl = meta.publishedShare.shareUrl;
        } else if (meta?.publishedName) {
          const apps = (await mazmotStore.getItem("apps")) || [];
          const home = apps.find(
            (a) =>
              a.namespace === PUBLISH_NAMESPACE &&
              a.name === meta.publishedName &&
              a.mazmot?.source === "conjure-publish",
          );
          if (home?.payloadHash) {
            const { userId } = await shareMgr.ensureUser();
            shareUrl = shareMgr.buildRunUrl(
              location.origin,
              userId,
              home.payloadHash,
            );
          }
        }
      } catch (err) {
        console.warn("[publish] 分享链接解析失败：", err);
        shareUrl = "";
      }
    }
    setMany({ publishMatch: match, publishShareUrl: shareUrl });
  }

  async function refreshBackups() {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      // 历史版本把回合快照混进了 backup/：顺手清扫（纯快照删除，被发布
      // 流程复用标注过的保留），备份管理从此只有发布与用户主动备份
      try {
        await sweepLegacyAutoBackups(fs, state.currentAppName, rootHandle);
      } catch {
        /* 清扫失败不影响清单读取 */
      }
      // listAppBackups 返回 { id, label, note }；当前内容指纹与 id 尾部 hash
      // 一致的项标记 current（即「这份备份就是现在的内容」）；内容指纹命中
      // 发布记录 publishedVersions 的项带 publishedVersion（「已发布 vX.Y.Z」徽标）
      const currentHash = await currentAppHash(fs, state.currentAppName, rootHandle);
      const list = await listAppBackups(fs, state.currentAppName, rootHandle);
      const publishedVersions =
        (await readPublishedMeta())?.publishedVersions || {};
      set("currentHash", currentHash);
      set(
        "backups",
        list.map((b) => ({
          ...b,
          current: currentHash !== "" && b.id.endsWith(`-${currentHash}`),
          publishedVersion: publishedVersions[b.id.slice(-8)] || "",
        })),
      );
    } catch (err) {
      console.warn("读取备份列表失败：", err);
    }
  }

  // 发布当前应用到首页应用列表（复制 client/ 到 mazmot-apps/<发布名>/）；
  // 发布成功同时在备份管理打一条带正式版本号标注的备份（已有同内容备份
  // 且用户未命名时也补标注，不覆盖用户自定义名称）
  async function publishCurrent() {
    if (state.publishBusy || state.currentAppName === "" || !fs) return null;
    set("publishBusy", true);
    try {
      // 当前用户 userId：副本记录的 appId 用（首页「我开发的」标记）
      let userId = "";
      try {
        const shareMgr = await ensureShareMod();
        userId = (await shareMgr.ensureUser()).userId;
      } catch (err) {
        console.warn("[publish] 获取用户失败（appId 省略）：", err);
      }
      const rootHandle = await backupRootHandle();
      const res = await publishAppToHome(
        fs,
        mazmotStore,
        state.currentAppName,
        rootHandle,
        { userId },
      );
      try {
        const backup = await createAppBackup(
          fs,
          state.currentAppName,
          rootHandle,
        );
        await refreshBackups(); // AI 标注的「上一版」对比要基于最新备份清单
        // 发布备份走智能备份的 AI 标注（标题 + 备注）——裸日期看不出这版
        // 发了什么；AI 失败 / 没产出标题 / 幂等重发时回退「发布 vX.Y.Z」标注
        let labeled = "";
        if (!backup.skipped) {
          try {
            labeled = (await applySmartBackupMeta(backup.id, rootHandle)).label;
          } catch (err) {
            console.warn("[publish] 发布备份 AI 标注失败：", err);
          }
        }
        if (!labeled) {
          const list = await listAppBackups(fs, state.currentAppName, rootHandle);
          const hit = list.find((b) => b.id === backup.id);
          if (!hit?.label) {
            await renameAppBackup(
              fs,
              state.currentAppName,
              backup.id,
              `发布 v${res.version}`,
            );
          }
        }
      } catch (err) {
        // 备份标注失败不影响发布结果
        console.warn("[publish] 发布备份标注失败：", err);
      }
      // P2P 分享发布：把副本发布到分享网络并回写 payloadHash，分享链接
      // 立即可用；失败不阻断发布（主系统列表打开时 autoShare 会自动重试）
      let shareUrl = "";
      try {
        const shareMgr = await ensureShareMod();
        const publishRoot = await fs.init(PUBLISH_NAMESPACE);
        const copyHandle = await publishRoot.get(res.publishName);
        const apps = (await mazmotStore.getItem("apps")) || [];
        const home = apps.find(
          (a) =>
            a.namespace === PUBLISH_NAMESPACE &&
            a.name === res.publishName &&
            a.mazmot?.source === "conjure-publish",
        );
        const { shareUrl: url, payloadHash, fileHash } =
          await shareMgr.publishApp(
            {
              source: "virtual",
              namespace: PUBLISH_NAMESPACE,
              name: res.publishName,
              virtualDirName: res.publishName,
              dirName: `${PUBLISH_NAMESPACE}/${res.publishName}`,
              version: res.version,
              desc: home?.desc || "",
              icon: home?.icon || "📦",
              _recordName: res.publishName,
              _handle: copyHandle,
            },
            { appId: home?.appId || undefined },
          );
        shareUrl = url;
        if (home) {
          home.payloadHash = payloadHash;
          home.fileHash = fileHash || "";
        }
        const src = apps.find(
          (a) =>
            a.mazmot?.source === "ai-builder" &&
            a.name === state.currentAppName,
        );
        if (src) {
          src.mazmot = {
            ...src.mazmot,
            publishedShare: { payloadHash, shareUrl, at: Date.now() },
          };
        }
        await mazmotStore.setItem("apps", apps);
        set("publishShareUrl", shareUrl);
      } catch (err) {
        console.warn("[publish] 分享发布失败（首页列表会自动重试）：", err);
        set("publishShareUrl", "");
      }
      await syncPublishedInfo();
      await refreshBackups(); // 发布版本的指纹徽标 / 备份标注即刻反映到备份清单
      set("publishMatch", true);
      return res;
    } catch (err) {
      set("keyError", `发布失败：${err.message}`);
      return null;
    } finally {
      set("publishBusy", false);
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

  // 智能备份的 AI 标注段（smartBackup 与发布备份共用）：对比上一版备份生成
  // 标题与备注并写入 meta。返回 { label, note }（都可能为空串——AI 没产出时
  // 由调用方兜底）。须先 refreshBackups：「上一版」取自最新备份清单
  async function applySmartBackupMeta(id, rootHandle) {
    const prev = state.backups.find((b) => b.id !== id);
    const currentFiles = await currentAppFiles(fs, state.currentAppName, rootHandle);
    const prevFiles = prev
      ? await readBackupFiles(fs, state.currentAppName, prev.id, rootHandle)
      : [];
    const { label, note } = await generateBackupMeta(currentFiles, prevFiles);
    if (label) {
      await renameAppBackup(fs, state.currentAppName, id, label, rootHandle);
    }
    if (note) {
      await setBackupNote(fs, state.currentAppName, id, note, rootHandle);
    }
    return { label, note };
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
      const { label, note } = await applySmartBackupMeta(res.id, rootHandle);
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
      reasoningOpen: false, // 思考默认收起：头部只滚动展示最后一行，点击展开
      newGroup: false,
    });
    activeBubble = item;
    bubbleRTStart = turnUsage?.reasoning_tokens ?? 0;
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
      // 气泡关闭：本模型调用的思考 token 增量落独立字段（turnUsage 为回合
      // 累计，差值即该次调用的思考消耗；统计聚合只读 usage，互不影响）
      if (activeBubble) {
        const rtDelta = (turnUsage?.reasoning_tokens ?? 0) - bubbleRTStart;
        if (rtDelta > 0) {
          patchMessage(activeBubble.id, { reasoningTokens: rtDelta });
        }
      }
      if (activeBubble && !activeBubble.content) {
        removeMessage(activeBubble.id);
      }
      activeBubble = null;
      for (const call of ev.toolCalls) {
        // args 可能是字符串（OpenAI 风格）或对象（部分供应商），统一转成
        // 展示用文本，避免模板直接渲染出 [object Object]
        const rawArgs = call.function?.arguments ?? call.args ?? "{}";
        let argsText = rawArgs;
        if (typeof rawArgs !== "string") {
          try {
            argsText = JSON.stringify(rawArgs, null, 2);
          } catch {
            argsText = String(rawArgs);
          }
        }
        pushMessage({
          id: state.nextId++,
          role: "tool",
          name: call.function?.name ?? call.name,
          args: argsText,
          summary: prettyArgs(argsText),
          result: "",
          pending: true,
          open: false,
          newGroup: false,
          toolCallId: call.id,
        });
      }
    } else if (ev.type === "usage" && ev.usage) {
      // 工具循环中间模型调用的实时快照：写进 state.liveTurnStats 供底部
      // 统计条即时刷新——不 patch 消息，模型不说话直接调工具的步同样有数据；
      // 最终数值随 done / 停止收尾落到回合末条 AI 消息（页面聚合时消息是
      // 「既往回合」，live 是「进行中回合」，两边相加不重复）
      turnUsage = ev.usage;
      turnStats = ev.stats || null;
      turnBreakdown = ev.contextBreakdown || null;
      set("liveTurnStats", {
        usage: { ...turnUsage },
        stats: turnStats ? { ...turnStats } : null,
        breakdown: turnBreakdown ? { ...turnBreakdown } : null,
      });
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
      turnUsage = ev.usage || turnUsage;
      if (ev.stats) turnStats = ev.stats;
      if (ev.contextBreakdown) turnBreakdown = ev.contextBreakdown;
      const patch = turnPatchPayload();
      if (activeBubble) {
        if (ev.content) {
          activeBubble.content = ev.content;
          patch.content = ev.content;
        }
        // 用响应里的真实模型名回填徽标（随机 assistant 场景 provider 名只是兜底）
        if (ev.model) {
          activeBubble.model = ev.model;
          patch.model = ev.model;
        }
        Object.assign(activeBubble, patch);
        if (Object.keys(patch).length) carryTurnData(activeBubble.id, patch);
      } else if (ev.content || ev.usage) {
        const bubble = newBubble();
        bubble.content = ev.content || "";
        if (ev.model) bubble.model = ev.model;
        Object.assign(bubble, patch);
        patchMessage(bubble.id, {
          content: bubble.content,
          ...(ev.model ? { model: ev.model } : {}),
          ...patch,
        });
      }
    }
  }

  // 回合统计/用量 patch 载荷（usage 恒有；stats / contextBreakdown 有则带）
  function turnPatchPayload() {
    const patch = {};
    if (turnUsage) patch.usage = turnUsage;
    if (turnStats) patch.turnStats = turnStats;
    if (turnBreakdown) patch.contextBreakdown = turnBreakdown;
    return patch;
  }

  // 回合内用量/统计的单一载体：数据落到 carrier 消息，并剥掉本回合其它
  // assistant 消息上的同类字段（工具循环中途换气泡时防止聚合重复累计）
  function carryTurnData(carrierId, patch) {
    for (const m of bucketFor(turnKey)) {
      if (m.role !== "assistant" || m.id < turnFirstId || m.id === carrierId)
        continue;
      if (m.usage || m.turnStats || m.contextBreakdown) {
        delete m.usage;
        delete m.turnStats;
        delete m.contextBreakdown;
        patchMessage(m.id, {
          usage: null,
          turnStats: null,
          contextBreakdown: null,
        });
      }
    }
    const carrier = bucketFor(turnKey).find((m) => m.id === carrierId);
    if (carrier) Object.assign(carrier, patch);
    patchMessage(carrierId, patch);
  }

  /* ---------- 发送与回合收尾 ---------- */

  // 用户在草稿态发出第一条消息：**立即**创建项目（目录 + 登记 + 切换上下文 +
  // 首个会话），不等回合结束——中断 / 关页的回合也归属项目，下次进来接着迭代，
  // 草稿桶不再积攒半成品对话
  async function createProjectNow(text) {
    const isLocal = state.storageMode === "local" && !!localRootHandle;
    // 应用名从请求文本取 slug；中文等取不出时用时间戳兜底（模型稍后会写入
    // 正式的 app.json，元数据经 syncAppMetaFromDisk 回填）
    const clean = sanitizeAppName(text) || `app-${Date.now().toString(36)}`;
    const displayName = String(text || "").trim().slice(0, 24) || clean;
    await createAppDir(
      fs,
      { name: clean, displayName, description: "", icon: "📦" },
      isLocal ? localRootHandle : undefined,
    );

    // mazmot 登记：本地句柄必须尽早落库，否则刷新后无法恢复授权
    if (mazmotStore) {
      try {
        await registerAppRecord(
          mazmotStore,
          isLocal
            ? buildLocalAppRecord({
                appName: clean,
                displayName,
                icon: "📦",
                handle: localRootHandle,
              })
            : buildAppRecord({ appName: clean, displayName, icon: "📦" }),
        );
      } catch (err) {
        console.warn("登记应用记录失败：", err);
      }
    }

    // registry + 首个会话；同名项目已存在（如同类需求重建）时并入为新会话
    const reg = await loadRegistry();
    const sid = `s${Date.now().toString(36)}`;
    const hit = reg.find((a) => a.name === clean);
    const session = {
      id: sid,
      title: String(text || "").trim().slice(0, 24) || "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (hit) {
      hit.mode = isLocal ? "local" : hit.mode;
      hit.sessions = hit.sessions || [];
      hit.sessions.push(session);
    } else {
      reg.push({
        name: clean,
        displayName,
        icon: "📦",
        mode: isLocal ? "local" : "vfs",
        createdAt: Date.now(),
        sessions: [session],
      });
    }
    await saveRegistry(reg);
    await reloadApps();
    await applyApp(hit || reg.find((a) => a.name === clean));
    set("currentSessionId", sid);
    syncSessionTitle(reg);
    freshTurn = { appName: clean, sid };
  }

  // 模型覆写 app.json 后，用盘上真实元数据回填 registry 与当前视图
  //（占位的 displayName/icon 在项目创建后很快被正式值替换）
  async function syncAppMetaFromDisk(appName) {
    if (!fs) return;
    try {
      const isLocal = state.currentAppMode === "local" && !!localRootHandle;
      const raw = await readAppFile(
        fs,
        appName,
        "app.json",
        isLocal ? localRootHandle : undefined,
      );
      if (!raw) return;
      const meta = JSON.parse(raw);
      const reg = await loadRegistry();
      const hit = reg.find((a) => a.name === appName);
      if (!hit) return;
      const display = String(meta.displayName || "").trim();
      const icon = String(meta.icon || "").trim();
      let changed = false;
      if (display && display !== hit.displayName) {
        hit.displayName = display;
        changed = true;
      }
      if (icon && icon !== hit.icon) {
        hit.icon = icon;
        changed = true;
      }
      if (!changed) return;
      await saveRegistry(reg);
      await reloadApps();
      if (state.currentAppName === appName) {
        set("currentAppDisplay", hit.displayName || appName);
        set("currentAppIcon", hit.icon || "📦");
      }
    } catch (err) {
      console.warn("回填项目元数据失败：", err);
    }
  }

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
      if (state.currentAppName === "") {
        // 用户一开口即建项目（方案定稿：项目存在先于对话结束）
        await createProjectNow(text);
        return `${state.currentAppName}:${state.currentSessionId}`;
      }
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
      set("sessionTasks", []); // 新会话从空清单开始
    } else {
      // 「＋ 新对话」预建的空会话：首条消息发出即把占位标题换成首句摘要
      //（不等回合收尾，左侧标签与顶栏立刻跟随）；fork/导入等带真实标题的
      // 会话不动
      const reg = await loadRegistry();
      const hit = reg.find((a) => a.name === state.currentAppName);
      const ses = hit?.sessions?.find((s) => s.id === state.currentSessionId);
      if (ses && (!ses.title || ses.title === "新对话")) {
        ses.title = text.slice(0, 24) || "新对话";
        ses.updatedAt = Date.now();
        await saveRegistry(reg);
        await reloadApps();
        set("currentSessionTitle", ses.title);
      }
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

    // 发送时即创建的全新项目：首回合结束出预览卡片（卡片须在快照前入桶，
    // 随会话一起落盘；中断 / 出错的回合同样出卡——项目与文件现状如实呈现）
    if (freshTurn && threadId === `${freshTurn.appName}:${freshTurn.sid}`) {
      freshTurn = null;
      // 首回合的「空项目生成」agent 到此为止：重建后后续回合换常规
      // 「已存在应用」提示词与完整工具清单
      invalidateAgent();
      const isLocal = state.currentAppMode === "local" && !!localRootHandle;
      let check = { ready: false, missing: [] };
      try {
        check = await validateApp(
          fs,
          state.currentAppName,
          isLocal ? localRootHandle : undefined,
        );
      } catch (err) {
        console.warn("校验新项目失败：", err);
      }
      pushMessage({
        id: state.nextId++,
        role: "app",
        appName: state.currentAppName,
        displayName: state.currentAppDisplay,
        icon: state.currentAppIcon,
        mode: state.currentAppMode,
        ready: check.ready,
        missing: check.missing,
        newGroup: false,
      });
    }

    // 本轮创建了新应用：草稿回合把草稿会话迁移为该应用的第一个会话；
    // 既有会话里 AI 另建新应用（create_app）时只登记 + 在本会话出预览卡片
    // ——不迁移会话（会搬走用户当前正查看的对话）、不强制切视图（会把用户
    // 刚切换到的视图拽走：回合进行中切走再切回，表象即「对话消失 / 会话
    // 被顶替」）。卡片入桶后不 return，落入下方正常落盘与会话收尾
    if (pendingNewApp) {
      const info = pendingNewApp;
      pendingNewApp = null;
      if (chatKey === "chat:draft") {
        await adoptNewApp(info, firstUserText, chatKey, elapsedMs);
        await syncLocalProjectChats(info.appName);
        return;
      }
      await adoptNewApp(info, firstUserText, chatKey, elapsedMs, {
        migrate: false,
      });
    }

    await selfStore.setItem(
      chatKey,
      bucketFor(chatKey).map((m) => ({ ...m })),
    );

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
    // 本地渠道：回合结束把对话快照写入项目目录（conjure-chats/ 目录，
    // 只重写本会话的文件），供下次选择该目录时走导入流程恢复对话数据
    if (appName) await syncLocalProjectChats(appName, sid || null);

    // 本回合有文件写入：同步 client/__app.json 安装清单（文件增删自动
    // bump app.json 版本，AI 无须感知）；失败不阻塞收尾
    if (fs && appName && turnChanges.length > 0) {
      try {
        await syncAppManifest(
          fs,
          appName,
          state.currentAppName === appName && state.currentAppMode === "local"
            ? localRootHandle
            : undefined,
        );
      } catch (err) {
        console.warn("[builder] 同步 __app.json 失败：", err);
      }
    }
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
  async function adoptNewApp(
    info,
    firstUserText,
    draftKey,
    elapsedMs = 0,
    { migrate = true } = {},
  ) {
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

    if (!migrate) {
      // 既有会话里另建的新应用：登记进项目列表即可（无会话），预览卡片出在
      // 产生它的当前会话里（pushMessage 落回合桶）；不迁移消息、不切视图
      const reg = await loadRegistry();
      if (!reg.find((a) => a.name === info.appName)) {
        reg.push({
          name: info.appName,
          displayName: info.displayName,
          icon: info.icon,
          mode: isLocal ? "local" : "vfs",
          createdAt: Date.now(),
          sessions: [],
        });
        await saveRegistry(reg);
      }
      await reloadApps();
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
      // 本回合 AI 已往新应用写文件：收口一次清单（createAppDir 只生成初始）
      try {
        await syncAppManifest(fs, info.appName, isLocal ? localRootHandle : undefined);
      } catch (err) {
        console.warn("[builder] 同步 __app.json 失败：", err);
      }
      return;
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
    if (turnKey === draftKey) setTurnKey(`chat:${info.appName}:${sid}`);

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
  // currentAbort：本轮的中止信号；stop() 触发后置位并 abort 在途模型请求，
  // Agent 对话被中断，已产生的流式内容保留，回合照常收尾落盘（下次发送继续
  // 同一 thread）；turnUsage 暂存本轮最近一次模型调用的用量（停止收尾补挂）
  let currentAbort = null;
  let currentAbortCtrl = null;
  let turnUsage = null;
  // 当前气泡（模型调用）开始时的回合累计推理 token：气泡关闭时差值即
  // 本次思考消耗，落独立字段 reasoningTokens（统计聚合读 usage，互不影响）
  let bubbleRTStart = 0; // 本回合最近一次模型调用的用量快照（停止收尾补挂用）
  let turnStats = null; // 本回合执行统计快照（步数/模型用时/工具用时/TTFT/TPS 分母）
  let turnBreakdown = null; // 本回合上下文构成估算快照（系统提示词/工具定义/对话消息）
  let turnFirstId = 0; // 本回合第一条消息的 id 基线（单载体剥离只看本回合消息）

  /**
   * 发送一条用户消息（可带图片，多模态）。
   * @param {string} text 文本内容（纯图片消息可为空串）
   * @param {string[]} images 图片 dataURL 列表（data:image/*；随消息持久化，
   *        wire 侧组装为 OpenAI content 数组——text + image_url 混排，由
   *        supplier 层原样透传给支持视觉的模型）
   */
  async function send(text, images = []) {
    const body = String(text ?? "").trim();
    const imgs = (Array.isArray(images) ? images : []).filter(
      (s) => typeof s === "string" && s.startsWith("data:image/"),
    );
    if (state.sending) return;
    if (!body && !imgs.length) return;
    if (!fs) {
      set("keyError", state.coreError);
      return;
    }

    let threadId;
    try {
      threadId = await prepareContext(body);
    } catch (err) {
      set("keyError", err.message);
      return;
    }

    // 本回合固定写自己的会话桶：此后无论用户切到哪个会话/项目，
    // 流式消息、落盘、收尾都以该 key 为准，不再随当前视图漂移
    setTurnKey(threadId === "draft" ? "chat:draft" : `chat:${threadId}`);
    if (!sessionBuckets.has(turnKey)) {
      sessionBuckets.set(turnKey, [...state.messages]);
    }
    turnStartAt = Date.now();
    markBusy(turnKey, true);

    setMany({ keyError: "" });
    // 用户消息记录发送时间 ts（聊天区 hover 展示）；图片随消息持久化
    pushMessage({
      id: state.nextId++,
      role: "user",
      content: body,
      ...(imgs.length ? { images: imgs } : {}),
      newGroup: true,
      ts: turnStartAt,
    });
    setMany({ turnStartTs: turnStartAt });

    // 上回合自动检测到预览错误：失效缓存 Agent，本回合重建提示词时带上
    //（ensureAgent 读 state.autoErrors 注入；driveTurn 开始时取走清空）
    if (state.autoErrors.length) invalidateAgent();
    // 存在待消费的回滚通知：失效 Agent 让本回合提示词带上；
    // driveTurn 开始时消费清除
    if (pendingRollback && pendingRollback.appName === state.currentAppName) {
      invalidateAgent();
    }
    try {
      await ensureAgent();
    } catch {
      setTurnKey(null); // 回合未真正开始，回退到视图内联模式
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
      const estimate = info.used + Math.ceil((body.length || 0) / 2) + 64;
      if (contextWindow > 0 && info.used > 0 && estimate >= contextWindow) {
        await compressThread(turnKey);
      }
    } catch (err) {
      console.warn("自动压缩上下文失败：", err);
    }
    // wire 侧多模态组装：有图片时 content 为 OpenAI 数组（text 部分仅在有文本
    // 时包含），无图片保持纯字符串（与历史消息一致）
    const wireContent = buildWireContent(body, imgs);
    await driveTurn(threadId, body, [{ role: "user", content: wireContent }]);
  }

  // OpenAI wire 消息组装（send 与编辑重发共用）：图片随 content 数组携带
  const buildWireContent = (body, imgs) =>
    imgs.length
      ? [
          ...(body ? [{ type: "text", text: body }] : []),
          ...imgs.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : body;

  /**
   * 编辑并重发末条用户消息（仅停止/完成后可调用，UI 已限定入口）。
   * 撤销最后一个回合：删除末条 user 之后的所有消息（AI 回复 / 工具记录）、
   * user 内容就地更新、Agent 记忆截断到该回合之前，再以新内容重新驱动回合。
   * 记忆截断按 wire 末条 user 定位而非 chat 侧序号——上下文压缩会改写
   * thread 头部的回合结构，序号对应不可靠；wire 末条 user 恒为最近一次发送。
   * 图片不可编辑（保留原消息的附件），仅文本可改。
   */
  async function resendLastUser(text) {
    const body = String(text ?? "").trim();
    if (state.sending) return { ok: false, reason: "sending" };
    const key = viewKey();
    const list = bucketFor(key);
    let userIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return { ok: false, reason: "no-user" };
    const userMsg = list[userIdx];
    const imgs = Array.isArray(userMsg.images) ? userMsg.images : [];
    if (!body && !imgs.length) return { ok: false, reason: "empty" };
    if (!fs) {
      set("keyError", state.coreError);
      return { ok: false, reason: "no-fs" };
    }

    // 撤销该轮：末条 user 之后全部删除，user 就地更新（逐条 splice 事件，
    // 页面窗口按 fill-key 增量移除）
    const removed = list.splice(userIdx + 1);
    for (const m of removed) msgEvent({ op: "splice", id: m.id });
    userMsg.content = body;
    patchMessage(userMsg.id, { content: body });
    scheduleSave(key);

    // Agent 记忆回退：截掉 wire 末条 user 起的最后一个回合（停止留下的
    // 悬空 tool_calls 恰好整段在删除范围内）
    if (selfStore) {
      const threadKey = `thread:${key.slice("chat:".length)}`;
      try {
        const wire = (await selfStore.getItem(threadKey)) || [];
        let cut = -1;
        for (let i = wire.length - 1; i >= 0; i--) {
          if (wire[i]?.role === "user") {
            cut = i;
            break;
          }
        }
        if (cut > -1) await selfStore.setItem(threadKey, wire.slice(0, cut));
      } catch (err) {
        console.warn("[builder] 重发前记忆截断失败：", err);
      }
    }

    // 以下与 send 同构：建回合 → 自动压缩检查 → 驱动
    setTurnKey(key);
    turnStartAt = Date.now();
    markBusy(key, true);
    setMany({ keyError: "", turnStartTs: turnStartAt });
    if (state.autoErrors.length) invalidateAgent();
    // 旧回合的回滚通知已随撤销失效，不带入重发回合
    if (pendingRollback && pendingRollback.appName === state.currentAppName) {
      pendingRollback = null;
    }
    try {
      await ensureAgent();
    } catch {
      setTurnKey(null);
      turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return { ok: false, reason: "no-key" };
    }
    set("sending", true);
    try {
      const info = contextInfo(bucketFor(turnKey));
      const estimate = info.used + Math.ceil((body.length || 0) / 2) + 64;
      if (contextWindow > 0 && info.used > 0 && estimate >= contextWindow) {
        await compressThread(turnKey);
      }
    } catch (err) {
      console.warn("自动压缩上下文失败：", err);
    }
    const threadId = key.slice("chat:".length);
    await driveTurn(threadId, body, [
      { role: "user", content: buildWireContent(body, imgs) },
    ]);
    return { ok: true };
  }

  // 驱动一轮 agent 对话循环：流式转发、错误入气泡、收尾（取消挂起表单、
  // 落盘、迁移草稿、清忙）。send 与表单恢复回合共用
  async function driveTurn(threadId, firstUserText, inputMessages) {
    activeBubble = null;
    currentAbort = { stopped: false };
    currentAbortCtrl = new AbortController();
    turnUsage = null;
    turnStats = null;
    turnBreakdown = null;
    const abort = currentAbort;
    // 本回合第一条消息的 id 基线：收尾标记（turnMs / stopped / usage）只
    // patch 本回合内产生的消息，避免误改上一回合的末条 AI 消息
    turnFirstId = state.nextId;
    // 上回合自动检测的预览错误已随本回合 agent 构建（send 侧失效重建）注入
    // 提示词，此处取走清空，避免跨回合重复注入
    if (state.autoErrors.length) set("autoErrors", []);
    // 回滚通知同理：本回合 agent 的提示词已带上（send 侧失效重建），消费清除
    if (pendingRollback && pendingRollback.appName === state.currentAppName) {
      pendingRollback = null;
    }
    // 回合开始快照（存应用目录 snaps/，不进备份管理清单）：变更卡 diff 的
    // 旧侧 + 一键回滚目标。内容寻址幂等——未改动的回合与既有快照同 id 零
    // 成本；草稿态（项目未建）跳过
    turnChanges = [];
    turnSnapshotId = "";
    if (state.currentAppName) {
      try {
        const snapHandle =
          state.currentAppMode === "local" ? localRootHandle : undefined;
        const snap = await createAppBackup(fs, state.currentAppName, snapHandle, {
          snapshot: true,
        });
        turnSnapshotId = snap.id;
        // 只保留最近 10 份快照（被更早回合变更卡引用到的会被清掉，回滚按钮
        // 随 snapshotAvailable 失效；diff 内容已冻结进消息，不受影响）
        await pruneAppSnaps(fs, state.currentAppName, snapHandle);
      } catch (err) {
        console.warn("回合快照失败：", err);
      }
    }
    try {
      await agent.chat({
        messages: inputMessages,
        threadId,
        stream: true,
        signal: currentAbortCtrl.signal,
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
      currentAbortCtrl = null;
      set("stopRequested", false);
      // 先清实时快照再落终值：避免「消息终值 + live」叠加的瞬时双计
      set("liveTurnStats", null);
      cancelPendingForm("回合已结束"); // 表单仍挂起时兜底取消（如 Agent 自行结束）
      set("sending", false);
      // 本轮耗时 / 手动停止标记 / 停止与异常收场的实时用量 patch 到回合内
      // 末条 AI 消息（须在 finishTurn 落盘前 patch，随会话桶一起持久化）
      if (turnStartAt) {
        const lastAi = [...bucketFor(turnKey)]
          .reverse()
          .find((m) => m.role === "assistant" && m.id >= turnFirstId);
        if (lastAi) {
          const patch = { turnMs: Date.now() - turnStartAt };
          if (abort.stopped) patch.stopped = true;
          // 本回合文件变更（含回滚目标快照 id）：统计与行级内容统一从
          // 「首改前 + 末改后」重算——即该回合自己的净变化，冻结进消息，
          // 此后无论磁盘如何变化（后续回合 / 回滚），展开看到的都是当时的改动
          if (turnChanges.length) {
            patch.changes = turnChanges.map((c) => {
              // prevText 为 null = 新文件（无旧内容）：全行 add，不产生 del
              const full =
                c.prevText == null
                  ? (c.nextText ?? "")
                      .split("\n")
                      .map((text, i) => ({
                        type: "add",
                        aLn: null,
                        bLn: i + 1,
                        text,
                      }))
                  : diffLines(c.prevText, c.nextText ?? "");
              const stat = diffStat(full);
              const out = { path: c.path, op: c.op, ...stat };
              // 行级内容冻结（±3 行上下文折叠）；单文件超 200 行不保留，
              // 只留统计（展开时提示改动过大）
              const compacted = compactHunks(full, 3);
              if (compacted.length <= 200) out.hunks = compacted;
              else out.tooLarge = true;
              return out;
            });
            if (turnSnapshotId) patch.snapshotId = turnSnapshotId;
          }
          // 停止 / 异常收场（步数上限、网络错误…）没有 done 事件把终值落到
          // 消息，这里统一把累计的实时快照补上，否则统计胶囊整轮消失；
          // 正常完成时 lastAi.usage 已有值，守卫自动跳过不重复累计
          if (turnUsage && !lastAi.usage) patch.usage = turnUsage;
          // 末条气泡的思考 token 增量（badge 显示「本次思考」而非回合累计）
          const rtDelta = (turnUsage?.reasoning_tokens ?? 0) - bubbleRTStart;
          if (rtDelta > 0) patch.reasoningTokens = rtDelta;
          if (turnStats && !lastAi.turnStats) patch.turnStats = turnStats;
          if (turnBreakdown && !lastAi.contextBreakdown) {
            patch.contextBreakdown = turnBreakdown;
          }
          patchMessage(lastAi.id, patch);
        }
      }
      turnUsage = null;
      turnStats = null;
      turnBreakdown = null;
      await finishTurn(firstUserText, threadId, Date.now() - turnStartAt);
      // 回合结束刷新备份清单：回合开始的自动快照 + 当前内容是否已有备份
      //（变更卡「备份代码」按钮的已备份感知数据源）；不阻塞收尾
      refreshBackups();
      // 自动错误回路：本回合有文件改动且预览窗口开着（不自动开窗打扰）时，
      // 推送最新代码 → 等应用跑起 → 读 console 的 error 行挂 state.autoErrors，
      // 下回合提示词自动注入（见 ensureAgent / buildSystemPrompt）
      const changedFiles = turnChanges;
      const changedApp = threadId === "draft" ? "" : threadId.split(":")[0];
      turnChanges = [];
      turnSnapshotId = "";
      if (
        changedFiles.length &&
        changedApp &&
        state.previewOnline &&
        !abort.stopped
      ) {
        autoCheckPreview(changedApp);
        // 场景测试自动跑：有文件改动且存在用例时执行，失败行回流 autoErrors
        autoRunTests();
      }
      // adoptNewApp 可能把回合迁移到新应用会话，收尾后按最终 turnKey 清忙
      markBusy(turnKey, false);
      setTurnKey(null);
      turnStartAt = 0;
      setMany({ turnStartTs: 0 });
    }
  }

  // 停止当前生成：置位中止信号 + abort 在途模型请求（不必等下一个流式
  // 事件，模型长流式 / 工具执行中点击都能尽快中断），已生成内容保留并照常
  // 落盘收尾（耗时 / 用量 / stopped 标记见 driveTurn 收尾）。
  // 视觉表单挂起中（Agent 在等用户提交）时一并取消，工具以 cancelled 返回；
  // stopRequested 供按钮显示「停止中」并防重复点击
  function stop() {
    if (!currentAbort || currentAbort.stopped) return;
    currentAbort.stopped = true;
    set("stopRequested", true);
    try {
      currentAbortCtrl?.abort();
    } catch {}
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
    setTurnKey(viewKeyNow);
    if (!sessionBuckets.has(turnKey)) {
      sessionBuckets.set(turnKey, [...state.messages]);
    }
    turnStartAt = Date.now();
    markBusy(turnKey, true);
    setMany({ keyError: "", turnStartTs: turnStartAt });

    try {
      await ensureAgent();
    } catch {
      setTurnKey(null);
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
      setTurnKey(null);
      turnStartAt = 0;
      markBusy(null);
      setMany({
        sending: false,
        stopRequested: false,
        liveTurnStats: null,
        turnStartTs: 0,
        keyError: err.message,
      });
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
    // 预览窗口（应用页代理）在线状态监听：预览按钮亮标（失败静默，不影响主流程）。
    // 同时接线多窗口钩子：onWindowsChange 刷新注册表快照（下拉气泡），
    // onBridgeHello 在扫码/新窗口引导页连入时自动推送对应应用；
    // onCapRequest 执行预览能力桥（guest 替身）的 AI/联网调用
    (async () => {
      try {
        const mod = await ensurePreviewMod();
        mod.setPreviewHooks({
          onBridgeHello: (userId, app) => pushToWindow(userId, app),
          onWindowsChange: () => refreshPreviewWindows(mod),
          onCapRequest: handleCapRequest,
        });
        mod.watchPreviewAgent({
          load,
          selfStore,
          onChange: (online) => set("previewOnline", online),
        });
      } catch (_) {}
    })();
    // 恢复推理等级偏好（无记录时从旧版思考模式开关迁移：开=low，关=off；
    // 校验放宽到 efforts 全档位集，minimal / max 为后来新增）
    if (selfStore) {
      try {
        let level = await selfStore.getItem("pref:reasoning");
        if (!["off", "minimal", "low", "medium", "high", "max"].includes(level)) {
          const legacy = await selfStore.getItem("pref:thinking");
          level = legacy === false ? "off" : "low";
        }
        set("reasoning", level);
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
    // 思考档位表加载 + 首算（此前 refreshEffortOptions 因模块未就绪被跳过）
    try {
      await ensureEfforts();
      refreshEffortOptions();
    } catch {
      /* efforts 加载失败保持空表（菜单显示默认态，注入按通用表 clamp 兜底） */
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
    resendLastUser,
    stop,
    reloadApps,
    selectApp,
    startDraft,
    newSessionFor,
    setSessionTasks,
    reorderSessions,
    loadSession: loadSessionById,
    deleteApp,
    deleteSession,
    renameSession,
    forkSession,
    compress,
    setContextWindow,
    setMaxSteps,
    selectApiKey,
    selectModel,
    selectMode,
    chooseLocalDir,
    grantLocalPermission,
    installSkillFromSource,
    openApp,
    openAppRemote,
    openNewPreviewWindow,
    refreshPreviewWindows,
    refreshPreviewInfo,
    refreshPreviewThumbs,
    submitForm,
    // 变更卡 / 回滚（回合快照体系，见 driveTurn 收尾与 rollbackTurn）
    getTurnDiff,
    rollbackTurn,
    dismissAutoErrors,
    dismissError,
    refreshTests,
    runTests,
    refreshBackups,
    createBackup,
    smartBackup,
    publishCurrent,
    refreshPublishState,
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
    setReasoning,
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
