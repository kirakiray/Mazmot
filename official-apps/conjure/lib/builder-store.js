// 妙造运行时状态仓库（组合根）
// 把「AI 创作 / 运行过程」的全部业务逻辑（Agent 编排、应用与会话管理、
// 写入目标与本地句柄、消息流水线、持久化）从页面模块抽离为独立可观察对象。
// 页面只通过 subscribe 观察状态变化来更新视觉数据，所有变更必须走仓库方法。
//
// 领域拆分（lib/store/ 下每个模块一个领域）：
//   state-core      可观察 state 与变更原语（set / setMany / registry 读写）
//   messages        每会话独立消息桶 + 细粒度消息事件
//   agent           Agent 创建与失效、上下文压缩、推理等级、API Key / 模型
//   skills          技能知识库装载与安装
//   apps-sessions   应用/会话切换、增删改名、回收站、fork
//   storage-target  写入目标（草稿阶段）与本地句柄授权、应用打开
//   local-project   本地项目导入、对话快照、句柄恢复
//   preview         隔离预览推送、多窗口、能力桥 broker
//   tasks           会话任务清单与预览错误自动同步
//   tests           场景测试执行与结果持久化
//   backups         数据备份、回合快照、发布、变更卡 diff 与回滚
//   locale          locale-text 多语种翻译（开发工具：扫描 / 合并 / 写回）
//   turn            发送主流程与回合收尾（含流式事件映射）
//   forms           视觉交互表单（show_form）
//   init            初始化装配
//
// 组合约定：每个模块导出 createXxxPart(api) 工厂，接收共享上下文 api
// （state 原语、消息原语、环境句柄、共享可变资源 res），返回本领域方法
// 集合并合并进同一个 api 对象；跨领域调用一律经 api.<fn> 晚绑定（各 part
// 之间禁止互相 import）。可变的非响应式资源（Agent、句柄、模块缓存、
// 回合暂存等类实例/普通对象）集中放 res 包——响应式包装会拆掉类实例原型，
// 不能进 state。
//
// 可观察约定（subscribe 回调收到的事件）：
// 1. { type: "patch", data }        —— state 标量 / 整组数据的更新（data 为键值对）
// 2. { type: "messages", op, ... }  —— 消息流水线的细粒度变更：
//    op: "replace"（带 list，整组替换）/ "push"（带 item）/ "patch"（带 id, patch）/ "splice"（带 id）

import { createStateCore } from "./store/state-core.js";
import { createMessagesPart } from "./store/messages.js";
import { createAgentPart } from "./store/agent.js";
import { createSkillsPart } from "./store/skills.js";
import { createAppsPart } from "./store/apps-sessions.js";
import { createStoragePart } from "./store/storage-target.js";
import { createLocalProjectPart } from "./store/local-project.js";
import { createPreviewPart } from "./store/preview.js";
import { createTasksPart } from "./store/tasks.js";
import { createTestsPart } from "./store/tests.js";
import { createBackupsPart } from "./store/backups.js";
import { createLocalePart } from "./store/locale.js";
import { createTurnPart } from "./store/turn.js";
import { createFormsPart } from "./store/forms.js";
import { createInitPart } from "./store/init.js";

export function createBuilderStore({ fs, mazmotStore, selfStore, load }) {
  /* ---------- 跨领域共享的可变资源（非响应式） ---------- */

  const res = {
    agent: null, // 缓存的 Agent 实例（ensureAgent 建 / invalidateAgent 失效）
    agentKeyId: "", // 缓存 Agent 构建时所用的 key id（模型被供应商拒绝时自愈定向清缓存）
    activeModel: "", // 当前 Agent 实际使用的模型标识
    aiModules: null, // /mz/ai 模块缓存
    netModules: null, // /mz/net 联网能力模块缓存（web_fetch 工具与能力桥共用）
    localRootHandle: null, // 本地目录渠道的根目录句柄（挂载后的 DirHandle）
    freshTurn: null, // 发送时即创建的全新项目 { appName, sid }，收尾出卡后清空
    pendingNewApp: null, // 本轮对话生成的应用（create_app 回调写入），收尾校验出卡
    pendingRollback: null, // 待消费的回滚通知（rollbackTurn 写入，下回合注入后清除）
    turnChanges: [], // 本回合文件变更 [{path, op, prevText, nextText}]（onFileWrite 写入，收尾冻结）
    turnStartAt: 0, // 进行中回合的开始时间戳（毫秒），turn / forms 共用
    contextWindow: 0, // 用户设定的上下文窗口（token），0 = 不做自动压缩
    maxSteps: 200, // 单回合工具循环步数上限（createAgent 的 maxSteps）
    skillIndex: [], // 技能索引（plain 数组，对外经 state.skills 同步）
    turnKey: null, // 进行中回合所属的 chatKey；null = 无进行中回合
  };

  /* ---------- 组合：core 原语 → 按领域装配各 part ---------- */

  const api = {
    fs,
    mazmotStore,
    selfStore,
    load,
    res,
    ...createStateCore({ selfStore }),
  };
  Object.assign(api, createMessagesPart(api));
  Object.assign(api, createAgentPart(api));
  Object.assign(api, createSkillsPart(api));
  Object.assign(api, createAppsPart(api));
  Object.assign(api, createStoragePart(api));
  Object.assign(api, createLocalProjectPart(api));
  Object.assign(api, createPreviewPart(api));
  Object.assign(api, createTasksPart(api));
  Object.assign(api, createTestsPart(api));
  Object.assign(api, createBackupsPart(api));
  Object.assign(api, createLocalePart(api));
  Object.assign(api, createTurnPart(api));
  Object.assign(api, createFormsPart(api));
  Object.assign(api, createInitPart(api));

  // 会话停留记忆跟随变更自动落 sessionStorage（currentSessionId 变化即记录，
  // 含清空场景），刷新后由 init 的 recallSession 恢复
  api.listeners.add((evt) => {
    if (evt.type === "patch" && "currentSessionId" in evt.data) {
      api.rememberSession();
    }
  });

  /* ---------- 对外接口（与拆分前的方法表逐项一致） ---------- */

  return {
    state: api.state,
    subscribe(fn) {
      api.listeners.add(fn);
      return () => api.listeners.delete(fn);
    },
    // 事件
    init: api.init,
    send: api.send,
    resendLastUser: api.resendLastUser,
    stop: api.stop,
    reloadApps: api.reloadApps,
    selectApp: api.selectApp,
    startDraft: api.startDraft,
    newSessionFor: api.newSessionFor,
    setSessionTasks: api.setSessionTasks,
    reorderSessions: api.reorderSessions,
    loadSession: api.loadSessionById,
    deleteApp: api.deleteApp,
    deleteSession: api.deleteSession,
    restoreTrashedSession: api.restoreTrashedSession,
    purgeTrashedSession: api.purgeTrashedSession,
    emptyTrash: api.emptyTrash,
    readTrashedMessages: api.readTrashedMessages,
    renameSession: api.renameSession,
    forkSession: api.forkSession,
    compress: api.compress,
    setContextWindow: api.setContextWindow,
    setMaxSteps: api.setMaxSteps,
    selectApiKey: api.selectApiKey,
    selectModel: api.selectModel,
    selectMode: api.selectMode,
    chooseLocalDir: api.chooseLocalDir,
    grantLocalPermission: api.grantLocalPermission,
    installSkillFromSource: api.installSkillFromSource,
    openApp: api.openApp,
    openAppRemote: api.openAppRemote,
    openNewPreviewWindow: api.openNewPreviewWindow,
    refreshPreviewWindows: api.refreshPreviewWindows,
    refreshPreviewInfo: api.refreshPreviewInfo,
    refreshPreviewThumbs: api.refreshPreviewThumbs,
    submitForm: api.submitForm,
    // 变更卡 / 回滚（回合快照体系，见 driveTurn 收尾与 rollbackTurn）
    getTurnDiff: api.getTurnDiff,
    rollbackTurn: api.rollbackTurn,
    dismissAutoErrors: api.dismissAutoErrors,
    dismissError: api.dismissError,
    refreshTests: api.refreshTests,
    runTests: api.runTests,
    fixFailedTests: api.fixFailedTests,
    updateAppMeta: api.updateAppMeta,
    refreshBackups: api.refreshBackups,
    createBackup: api.createBackup,
    smartBackup: api.smartBackup,
    publishCurrent: api.publishCurrent,
    refreshPublishState: api.refreshPublishState,
    deleteBackup: api.deleteBackup,
    renameBackup: api.renameBackup,
    setNote: api.setNote,
    restoreBackup: api.restoreBackup,
    // 折叠开关作用于「当前查看的会话」桶（可能不是流式回合的桶），
    // 直接改桶内条目并向前端发视图事件，不走 patchMessage 的回合路由
    toggleTool(id) {
      const item = api.bucketFor(api.viewKey()).find((m) => m.id === id);
      if (item) {
        item.open = !item.open;
        api.msgEvent({ op: "patch", id, patch: { open: item.open } });
      }
    },
    // 错误卡/工具消息的诊断详情折叠开关（diagOpen 是临时 UI 态，不刻意落盘）
    toggleDiag(id) {
      const item = api.bucketFor(api.viewKey()).find((m) => m.id === id);
      if (item) {
        item.diagOpen = !item.diagOpen;
        api.msgEvent({ op: "patch", id, patch: { diagOpen: item.diagOpen } });
      }
    },
    setReasoning: api.setReasoning,
    toggleReasoning(id) {
      const item = api.bucketFor(api.viewKey()).find((m) => m.id === id);
      if (item) {
        item.reasoningOpen = !item.reasoningOpen;
        api.msgEvent({ op: "patch", id, patch: { reasoningOpen: item.reasoningOpen } });
      }
    },
    // 本地句柄查询（预览等 UI 场景只读使用；句柄不进 state）
    getLocalHandle() {
      return res.localRootHandle;
    },
  };
}
