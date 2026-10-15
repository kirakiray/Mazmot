/* ---------- 状态核心（builder-store 组合根的基建层） ----------
 * 可观察 state 与变更原语：set / setMany 是唯一的状态写入口，变更统一
 * 发 patch 事件，页面经 subscribe 观察（subscribe 在组合根对外暴露）。
 * registry（apps-registry 键）的读写原语也在这里——它是应用/会话/回合
 * 收尾等多个领域共用的持久化入口。
 * 拆分约定见 builder-store.js 头部注释。
 */

const REGISTRY_KEY = "apps-registry";

export function createStateCore({ selfStore }) {
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
    interrupted: false, // 上次回合被硬中断（刷新 / 崩溃，没走收尾 finally）；会话加载时检测，对话末尾出「继续」提醒卡
    // 接口请求自动重试倒计时（driveTurn 写入，null = 无重试进行）：
    // { attempt, maxAttempts, remain, error }——状态行展示「N 秒后自动重试」
    turnRetry: null,

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
    currentAppTrash: [], // 当前应用回收站（registry trash 镜像，删除会话进这里）
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

  const loadRegistry = async () =>
    selfStore ? ((await selfStore.getItem(REGISTRY_KEY)) ?? []) : [];
  const saveRegistry = async (reg) => {
    if (selfStore) await selfStore.setItem(REGISTRY_KEY, reg);
  };

  return { state, listeners, set, setMany, loadRegistry, saveRegistry };
}
