// 妙造核心库
// 职责：存放系统提示词、应用名/路径校验、VFS 写入编排、apps[] 记录登记。
// 本模块不静态 import /nos/* 与 /mz/*（受 Core 加载时机约束），
// fs / storage / tool 均由页面模块通过 load() 加载后注入。

import {
  AGENTS_MD_TEMPLATE,
  buildAgentsMd,
  buildProjectDocs,
} from "./agents-template.js";

// 生成应用在虚拟文件系统中的根命名空间：init("ai-apps") 在 VFS 根创建该目录，
// 每个生成的应用再在其下建 <name>/client/ 作为应用载体目录。
// 独立命名空间、不与主系统的 mazmot-apps/ 混用；生成应用也不进主系统应用列表。
export const NAMESPACE = "ai-apps";

// 旧版命名空间（历史生成的应用被迁到共享的 mazmot-apps/ 下，启动时迁回 ai-apps/）
export const LEGACY_NAMESPACE = "mazmot-apps";

// 一个可运行应用在 client/ 下必须存在的文件
export const REQUIRED_FILES = ["app.json", "index.html", "app-config.js"];

// 各供应商可用的对话模型（与 mz/ai/supplier 里支持的模型清单保持一致）；
// 模型可选项依赖当前选中的 API Key 所属供应商。
// 国外供应商与 Qwen 动态拉取（getModels）为准，这里仅作拉取失败时的兜底校验表。
export const MODEL_OPTIONS = {
  deepseek: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"],
  glm: ["glm-5.3-flash", "glm-5.3"],
  "glm-coding": ["glm-5.3-flash", "glm-5.3"],
  kimi: ["kimi-k3", "kimi-k2.7-code"],
  qwen: ["qwen3-max", "qwen3-plus", "qwen3-flash"],
  openai: ["gpt-5.6", "gpt-5.5", "gpt-5.1", "gpt-5"],
  gemini: ["gemini-3-flash", "gemini-3-pro", "gemini-2.5-pro", "gemini-2.5-flash"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
};

/**
 * 「自动」模式下的 key 选择：deepseek 优先；只有一台时直接锁定（模型清单
 * 展示与实际请求保持一致），多台非 deepseek 时随机负载均衡。
 * builder-store 的 pickAssistant（发请求）与 refreshModelOptions（拉模型清单）
 * 共用此逻辑，保证「自动」下拉取到的清单就是即将使用的那把 key 的。
 * @param {Array} keys 已过滤 disabled 的 key 列表
 * @returns {object|null} 命中的 key；空列表返回 null
 */
export function pickAutoKey(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const deepseekKey = keys.find((k) => k.provider === "deepseek");
  if (deepseekKey) return deepseekKey;
  if (keys.length === 1) return keys[0];
  return keys[Math.floor(Math.random() * keys.length)];
}

/**
 * 把 Agent 的 wire 记忆按回合截断：保留前 k 个 user 消息开头的回合；末个保留
 * 回合若未闭合（末条 assistant 仍带 tool_calls，即中途停止/截断），整体丢弃
 * 该回合——悬空的 tool_calls 会让下一次模型请求报错。
 * @param {Array} thread wire 格式消息数组（user / assistant(+tool_calls) / tool）
 * @param {number} turns 保留的回合数
 * @returns {Array}
 */
export function truncateThread(thread, turns) {
  const kept = splitThreadSegments(thread).slice(0, turns);
  return dropDanglingTurn(kept).flat();
}

/**
 * 取 wire 记忆末尾的 k 个完整回合（悬空的 tool_calls 回合同样整段丢弃），
 * 供上下文压缩后保留「最近原文」。
 * @param {Array} thread wire 格式消息数组
 * @param {number} keepTurns 保留的末尾回合数
 * @returns {Array}
 */
export function tailThread(thread, keepTurns) {
  if (!(keepTurns > 0)) return [];
  const segments = splitThreadSegments(thread);
  return dropDanglingTurn(segments)
    .slice(-keepTurns)
    .flat();
}

// 把 wire 记忆切成「回合」段（每个 user 消息开头一段；开头散段防御性丢弃）
function splitThreadSegments(thread) {
  const segments = [];
  for (const m of thread || []) {
    if (m.role === "user") segments.push([]);
    if (!segments.length) continue;
    segments[segments.length - 1].push(m);
  }
  return segments;
}

// 末段若未闭合（末条 assistant 仍带 tool_calls，即中途停止/截断），整段丢弃——
// 悬空的 tool_calls 会让下一次模型请求报错
function dropDanglingTurn(segments) {
  const kept = [...segments];
  const last = kept[kept.length - 1];
  if (
    last &&
    last[last.length - 1]?.role === "assistant" &&
    last[last.length - 1].tool_calls?.length
  ) {
    kept.pop();
  }
  return kept;
}

/**
 * 读取会话当前的上下文占用（基于回合末条 AI 消息上挂的 usage）。
 * usage.context_tokens 由 Agent 用「末次模型调用的 prompt + completion」覆盖写入，
 * 即最接近当前对话真实上下文大小的估算值；总量（窗口大小）由页面 select 选定。
 * @param {Array} messages 会话消息数组（含历史消息）
 * @returns {{ used: number, model: string }}
 *          used 为 0 表示会话还没有任何模型调用记录
 */
export function contextInfo(messages) {
  let used = 0;
  let model = "";
  for (const m of messages || []) {
    if (m?.role === "assistant" && m.usage?.context_tokens > 0) {
      used = m.usage.context_tokens;
      model = m.model || model;
    }
  }
  return { used, model };
}

// 允许写入的文本文件扩展名（P2P 分享只支持 UTF-8 文本，二进制不可写入）
const TEXT_EXT = [
  ".html", ".js", ".mjs", ".css", ".json", ".md", ".txt", ".svg",
  ".csv", ".xml", ".map",
];

/**
 * 把用户/模型给出的应用名规范成合法目录名（/^[A-Za-z0-9_-]+$/）。
 * 中文等非法字符按拼音不可得的原则直接丢弃；全部非法时返回空串。
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeAppName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
}

/**
 * 校验 write_file 的相对路径：
 * - 禁止绝对路径与 `..` 逃逸
 * - 只允许白名单文本扩展名
 * @param {string} path 相对于 client/ 的路径，如 "pages/home.html"
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateRelPath(path) {
  const p = String(path || "").trim();
  if (!p) return { ok: false, reason: "路径为空" };
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p))
    return { ok: false, reason: "不允许绝对路径" };
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === ".."))
    return { ok: false, reason: "路径中包含非法片段（.. 或空段）" };
  if (!TEXT_EXT.some((ext) => p.toLowerCase().endsWith(ext)))
    return {
      ok: false,
      reason: `只支持文本文件（${TEXT_EXT.join(" ")}），二进制资源不可用`,
    };
  return { ok: true };
}

/**
 * 生成的应用的预览 URL（NoneOS 挂载路径，写入后即可直接访问）。
 * @param {string} name 规范化后的应用名
 * @returns {string}
 */
export function buildRunUrl(name) {
  return `/$${NAMESPACE}/${name}/client/index.html`;
}

/**
 * 构造「本地目录」渠道的应用记录（source: local，句柄随记录持久化）。
 * @param {{ name?: string, appName?: string, desc?: string, icon?: string, displayName?: string, handle: Object }} meta
 *        name / appName 二选一（仓库层回调传的是 appName）
 * @returns {Object}
 */
export function buildLocalAppRecord(meta) {
  const name = sanitizeAppName(meta.appName ?? meta.name);
  return {
    name,
    desc: String(meta.desc || meta.displayName || name),
    icon: meta.icon || "📦",
    source: "local",
    namespace: "",
    dirName: name,
    handle: meta.handle,
    createdAt: Date.now(),
    mazmot: { source: "ai-builder" },
  };
}

/**
 * 构造写入 mazmot 空间 apps[] 的应用记录（虚拟目录应用）。
 * @param {{ name?: string, appName?: string, desc?: string, icon?: string, displayName?: string }} meta
 *        name / appName 二选一（仓库层回调传的是 appName）
 * @returns {Object}
 */
export function buildAppRecord(meta) {
  const name = sanitizeAppName(meta.appName ?? meta.name);
  return {
    name,
    desc: String(meta.desc || meta.displayName || name),
    icon: meta.icon || "📦",
    source: "virtual",
    namespace: NAMESPACE,
    dirName: `${NAMESPACE}/${name}`,
    virtualDirName: name,
    handle: null,
    createdAt: Date.now(),
    mazmot: { source: "ai-builder" },
  };
}

/** 生成应用 app.json 的内容（作为 client/app.json 写入） */
export function buildAppJson({ name, displayName, description, icon }) {
  return JSON.stringify(
    {
      name,
      displayName: displayName || name,
      version: "0.1.0",
      description: description || "",
      author: "AI App Builder",
      icon: icon || "📦",
      entry: "./index.html",
      appConfig: "./app-config.js",
      permissions: [],
      capabilities: [],
      createdAt: Date.now(),
      mazmot: { source: "ai-builder" },
    },
    null,
    2,
  );
}

/**
 * 获取（或创建）生成应用根目录。
 * @param {Object} fs 注入的 /nos/fs/main.js 模块
 * @returns {Promise<Object>} DirHandle
 */
export async function ensureAppRoot(fs) {
  return await fs.init(NAMESPACE);
}

/**
 * 一次性迁移：把历史上被搬到共享命名空间 mazmot-apps/ 下的生成应用，
 * 按登记记录逐个迁回独立命名空间 ai-apps/，并同步更新 mazmot apps[]
 * 登记记录的 namespace / dirName 字段。mazmot-apps/ 是主系统共享命名空间，
 * 里面可能有用户自建应用，因此只按记录搬 AI 生成应用的子目录，不动根目录。
 * 无待迁移记录或源目录缺失时返回 false，无副作用。
 * @param {Object} fs 注入的 /nos/fs/main.js 模块
 * @param {Object} [mazmotStore] getStorage("mazmot") 实例
 * @returns {Promise<boolean>} 是否发生了迁移
 */
export async function migrateVfsNamespace(fs, mazmotStore) {
  if (!fs) return false;
  let records = [];
  if (mazmotStore) {
    try {
      records = ((await mazmotStore.getItem("apps")) || []).filter(
        (a) =>
          a.mazmot?.source === "ai-builder" &&
          a.namespace === LEGACY_NAMESPACE,
      );
    } catch {
      /* 读登记失败视为无记录 */
    }
  }
  if (!records.length) return false;

  let oldRoot = null;
  try {
    oldRoot = await fs.get(LEGACY_NAMESPACE);
  } catch {
    return false;
  }
  if (!oldRoot || oldRoot.kind !== "dir") return false;

  const newRoot = await fs.init(NAMESPACE);
  const copyDir = async (src, dest) => {
    for await (const item of src.values()) {
      if (item.kind === "dir") {
        await copyDir(item, await dest.get(item.name, { create: "dir" }));
      } else {
        const file = await dest.get(item.name, { create: "file" });
        await file.write(await item.text());
      }
    }
  };
  for (const rec of records) {
    try {
      const src = await oldRoot.get(rec.name);
      if (!src || src.kind !== "dir") continue;
      await copyDir(src, await newRoot.get(rec.name, { create: "dir" }));
      await src.remove();
    } catch (err) {
      console.warn(`迁移生成应用 ${rec.name} 失败：`, err);
    }
  }

  try {
    const apps = (await mazmotStore.getItem("apps")) || [];
    let changed = false;
    for (const rec of apps) {
      if (rec.namespace === LEGACY_NAMESPACE) {
        rec.namespace = NAMESPACE;
        if (rec.dirName === `${LEGACY_NAMESPACE}/${rec.name}`) {
          rec.dirName = `${NAMESPACE}/${rec.name}`;
        }
        changed = true;
      }
    }
    if (changed) await mazmotStore.setItem("apps", apps);
  } catch (err) {
    console.warn("迁移 mazmot 登记记录失败：", err);
  }
  return true;
}

// 写入落点解析：
// - 本地目录渠道（rootHandle = fs.open() 选定的目录）：应用文件统一写入
//   所选目录的 client/ 子目录（与虚拟渠道布局一致；预览走 getRunUrl 挂载 client/）
// - 虚拟系统渠道：ai-apps/<name>/client/
const resolveBaseDir = async (fs, appName, rootHandle) => {
  if (rootHandle) return { base: rootHandle, rel: "client/" };
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const rootDir = await ensureAppRoot(fs);
  return { base: rootDir, rel: `${clean}/client/` };
};

/**
 * 创建应用并写入 app.json；同时预写整套项目文档骨架（AGENTS.md / CONTEXT.md /
 * MEMORY.md / pitfalls/README.md，各自仅缺失时写——同名覆盖重建不清空，项目
 * 已定制的内容不丢）。文档由宿主保证存在：模型把文档放在工作流程末尾，生成
 * 中途被截停（工具步数上限 / 手动停止 / 报错）时整套文档会缺失，后续会话就
 * 没有项目记忆与规范可读。模板见 agents-template.js：AGENTS.md 是共享的通用
 * 规范（模型不重写，只在「硬性约定」末尾追加项目特有硬规则），其余三份是带
 * 占位标记的骨架（模型填充为真实内容）。
 * 同名应用视为覆盖重建（文件级覆盖，不先清空）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ name: string, displayName: string, dir: Object }>}
 */
export async function createAppDir(
  fs,
  { name, displayName, description, icon },
  rootHandle,
) {
  const clean = sanitizeAppName(name);
  if (!clean) throw new Error("应用名不合法（需包含英文字母或数字）");

  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const metaFile = await base.get(`${rel}app.json`, { create: "file" });
  await metaFile.write(
    buildAppJson({ name: clean, displayName, description, icon }),
  );
  const docs = [
    { path: "AGENTS.md", content: buildAgentsMd(displayName || clean) },
    ...buildProjectDocs(displayName || clean),
  ];
  for (const { path, content } of docs) {
    const existing = await base.get(`${rel}${path}`).catch(() => null);
    if (!existing || existing.kind !== "file") {
      const doc = await base.get(`${rel}${path}`, { create: "file" });
      await doc.write(content);
    }
  }
  // 初始安装清单（client/__app.json）：目录落成即与磁盘对齐
  await syncAppManifest(fs, clean, rootHandle);
  return { name: clean, displayName: displayName || clean, dir: base };
}

/**
 * 往应用写入一个文件（自动创建中间目录）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ path: string, bytes: number, name: string, initialized: boolean, created: boolean }>}
 *          created 表示本次写入的是新文件（此前不存在），供调用方给出
 *          「需 preview 推送后预览端才可访问」类提示
 */
/**
 * 确保目标应用已完成初始化（client/ 下存在 app.json）；缺失时自动补写一份
 * 最小 app.json。兜底场景：模型偶尔会跳过 create_app 直接 write_file，
 * 若不补初始化，应用永远不会登记、出预览卡片。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<boolean>} 是否发生了自动初始化
 */
export async function ensureAppInitialized(fs, appName, rootHandle) {
  const existing = await readAppFile(fs, appName, "app.json", rootHandle);
  if (existing !== null) return false;
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  await createAppDir(fs, { name: clean, displayName: clean }, rootHandle);
  return true;
}

export async function writeAppFile(fs, appName, relPath, content, rootHandle) {
  const check = validateRelPath(relPath);
  if (!check.ok) throw new Error(check.reason);

  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const text = String(content ?? "");
  const initialized = await ensureAppInitialized(fs, clean, rootHandle);
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const prev = await base.get(rel + relPath).catch(() => null);
  const created = !prev || prev.kind !== "file";
  // 改前内容（变更卡 diff 的旧侧；新文件为 null）
  const prevText = created ? null : await prev.text();
  const file = await base.get(rel + relPath, { create: "file" });
  await file.write(text);
  return {
    path: relPath,
    bytes: new Blob([text]).size,
    name: clean,
    initialized,
    created,
    prevText,
  };
}

/**
 * 差量编辑一个已有文件：edits 逐条应用（old_string → new_string 字面量替换）。
 * old_string 必须在文件中唯一命中（多处命中须 replace_all 或扩大上下文再试），
 * 找不到直接报错——模型须先 read_file 拿到真实内容，防止凭猜测改坏文件。
 * @param {Array<{old_string: string, new_string: string, replace_all?: boolean}>} edits
 * @returns {Promise<{ path, bytes, name, applied: number, prevText, nextText }>}
 */
export async function editAppFile(fs, appName, relPath, edits, rootHandle) {
  const check = validateRelPath(relPath);
  if (!check.ok) throw new Error(check.reason);
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("edits 必须是至少一条 { old_string, new_string } 的数组");
  }

  const prevText = await readAppFile(fs, clean, relPath, rootHandle);
  if (prevText === null) {
    throw new Error(`文件不存在：${relPath}（新建文件请用 write_file）`);
  }

  let next = prevText;
  for (let k = 0; k < edits.length; k++) {
    const e = edits[k] || {};
    const oldStr = String(e.old_string ?? "");
    const newStr = String(e.new_string ?? "");
    if (!oldStr) throw new Error(`edits[${k}].old_string 不能为空`);
    const hits = next.split(oldStr).length - 1;
    if (hits === 0) {
      throw new Error(
        `edits[${k}] 未命中：文件里找不到 old_string。请先 read_file 读取当前内容后按原文精确引用（注意空格与换行）`,
      );
    }
    if (hits > 1 && !e.replace_all) {
      throw new Error(
        `edits[${k}] 命中 ${hits} 处：请扩大 old_string 上下文使其唯一，或设 replace_all: true 全部替换`,
      );
    }
    next = e.replace_all
      ? next.split(oldStr).join(newStr)
      : next.replace(oldStr, newStr);
  }

  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const file = await base.get(rel + relPath, { create: "file" });
  await file.write(next);
  return {
    path: relPath,
    bytes: new Blob([next]).size,
    name: clean,
    applied: edits.length,
    prevText,
    nextText: next,
  };
}

/** 读取应用的一个文件，不存在返回 null */
export async function readAppFile(fs, appName, relPath, rootHandle) {
  const clean = sanitizeAppName(appName);
  try {
    const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
    const file = await base.get(rel + relPath);
    if (!file || file.kind !== "file") return null;
    return await file.text();
  } catch {
    return null;
  }
}

/** 递归收集应用全部文件相对路径（兼容无 flat() 的旧版 Core） */
export async function listAppFiles(fs, appName, rootHandle) {
  const clean = sanitizeAppName(appName);
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const prefix = rel ? rel : base.path ? base.path + "/" : "";
  // Core 的 flat()/path 可能带命名空间前缀（如 ai-apps/<app>/client/），
  // 统一剥成相对 client/ 的路径
  const toRel = (path) => {
    if (prefix && path.startsWith(prefix)) return path.slice(prefix.length);
    if (rel) {
      const idx = path.indexOf(rel);
      if (idx > -1) return path.slice(idx + rel.length);
    }
    return path;
  };
  const out = [];
  // 真实 Core 的 flat() 可能列出整个命名空间（其他应用 / backup/ 等子树外
  // 路径原样混入）——keys() 递归天然只走本应用子树，优先用它；
  // 子树外路径的特征是 toRel 剥不掉前缀（返回值含 "ai-apps/" 或原样带多层
  // 目录且不含本应用前缀），兜底分支里据此丢弃
  const isOutside = (raw, relPath) =>
    relPath.startsWith("/") ||
    relPath.includes("../") ||
    relPath.startsWith("ai-apps/") ||
    relPath.includes("/backup/") ||
    (raw !== relPath && relPath.includes("/client/"));
  if (typeof base.keys === "function") {
    const walk = async (dir) => {
      for await (const key of dir.keys()) {
        const item = await dir.get(key);
        if (!item) continue;
        if (item.kind === "dir") await walk(item);
        else {
          const r = toRel(item.path);
          if (!isOutside(item.path, r)) out.push(r);
        }
      }
    };
    await walk(base);
    return out.sort();
  }
  if (typeof base.flat === "function") {
    for (const f of await base.flat()) {
      const r = toRel(f.path);
      if (!isOutside(f.path, r)) out.push(r);
    }
    return out.sort();
  }
  const walk = async (dir) => {
    for await (const key of dir.keys()) {
      const item = await dir.get(key);
      if (!item) continue;
      if (item.kind === "dir") await walk(item);
      else out.push(toRel(item.path));
    }
  };
  await walk(base);
  return out.sort();
}

/**
 * 同步应用的 client/__app.json（安装清单）与磁盘实际文件，生成应用与官方
 * 应用同构（结构对齐 official-apps 下各应用的 __app.json）。宿主自动维护、
 * AI 无须感知（SYSTEM_PROMPT 已声明禁止模型增删改它）：
 *   - 清单已有条目且文件仍在磁盘 → 原样保留；
 *   - 磁盘新增文件 → 追加（排除 __app.json 自身 / dotfiles / node_modules /
 *     test 目录 / *.sb.html / __meta.json），app.json 固定居首；
 *   - 文件增删 → 自动把 app.json 的 version 末段 +1（对齐 npm run update:apps
 *     语义；首次生成不 bump，纯内容修改清单不变也不 bump）；
 *   - 元数据（name/icon/desc）始终取自 app.json（app.json 是应用的唯一配置源）。
 * 调用时机：createAppDir（初始生成）/ finishTurn（回合收尾，有文件写入时）/
 * restoreAppBackup（覆盖还原后）/ adoptNewApp 非迁移分支（另建的新应用）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{changed: boolean, added: string[], removed: string[], version?: string}>}
 *          version 为本次 bump 后的 app.json 版本（未 bump 时缺省）
 */
export async function syncAppManifest(fs, appName, rootHandle) {
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const include = (p) =>
    p !== "__app.json" &&
    p !== "__meta.json" &&
    !p.endsWith(".sb.html") &&
    !p
      .split("/")
      .some((seg) => seg.startsWith(".") || seg === "node_modules" || seg === "test");
  const disk = new Set(
    (await listAppFiles(fs, clean, rootHandle)).filter(include),
  );

  const prevRaw = await readAppFile(fs, clean, "__app.json", rootHandle);
  const isFirst = prevRaw === null;
  let prevFiles = [];
  try {
    const parsed = prevRaw ? JSON.parse(prevRaw) : null;
    if (Array.isArray(parsed?.files)) prevFiles = parsed.files;
  } catch {}

  const entryPath = (e) => (typeof e === "string" ? e : e?.path);
  const kept = [];
  const listed = new Set();
  const added = [];
  const removed = [];
  for (const e of prevFiles) {
    const p = entryPath(e);
    if (!p) continue;
    if (disk.has(p)) {
      listed.add(p);
      kept.push(e);
    } else {
      removed.push(p);
    }
  }
  for (const p of [...disk].filter((x) => !listed.has(x)).sort()) {
    kept.push(p);
    added.push(p);
  }
  kept.sort((a, b) => {
    const pa = entryPath(a);
    const pb = entryPath(b);
    if (pa === "app.json") return -1;
    if (pb === "app.json") return 1;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  // 首次生成不 bump：0.1.0 就是应用的初始版本，建目录不算「更新」
  const changed = !isFirst && (added.length > 0 || removed.length > 0);

  const appRaw = await readAppFile(fs, clean, "app.json", rootHandle);
  let meta = null;
  try {
    meta = appRaw ? JSON.parse(appRaw) : null;
  } catch {}
  let version;
  if (changed && meta && typeof meta.version === "string") {
    const next = bumpPatchVersion(meta.version);
    if (next) {
      meta.version = next;
      version = next;
      const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
      const f = await base.get(rel + "app.json");
      await f.write(JSON.stringify(meta, null, 2));
    }
  }

  const manifest = {
    name: meta?.displayName || meta?.name || clean,
    icon: meta?.icon || "📦",
    desc: meta?.description || "",
    files: kept,
  };
  const output = JSON.stringify(manifest, null, 2) + "\n";
  if (output !== (prevRaw ?? "")) {
    const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
    const f = await base.get(rel + "__app.json", { create: "file" });
    await f.write(output);
  }
  return { changed, added, removed, ...(version ? { version } : {}) };
}

/**
 * 校验应用是否具备可运行的最小文件集。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ ready: boolean, missing: string[], files: string[] }>}
 */
export async function validateApp(fs, appName, rootHandle) {  const files = await listAppFiles(fs, appName, rootHandle);
  const missing = REQUIRED_FILES.filter(
    (f) => !files.some((p) => p === f || p.endsWith("/" + f)),
  );
  return { ready: missing.length === 0, missing, files };
}

/**
 * 把生成应用登记进 mazmot 空间的 apps[]（按 name+namespace 去重更新），
 * 使其出现在主系统应用列表中。
 * @param {Object} storage getStorage("mazmot") 实例
 * @param {Object} record buildAppRecord 产物
 */
export async function registerAppRecord(storage, record) {
  const apps = (await storage.getItem("apps")) || [];
  const idx = apps.findIndex(
    (a) => a.name === record.name && a.namespace === record.namespace,
  );
  if (idx > -1) {
    apps[idx] = { ...apps[idx], ...record, createdAt: apps[idx].createdAt };
  } else {
    apps.push(record);
  }
  await storage.setItem("apps", apps);
}

/**
 * 列出已登记的 AI 生成应用（含虚拟系统渠道与本地目录渠道）。
 * @returns {Promise<Array>}
 */
export async function listRegisteredApps(storage) {
  const apps = (await storage.getItem("apps")) || [];
  return apps.filter(
    (a) => a.namespace === NAMESPACE || a.mazmot?.source === "ai-builder",
  );
}

/**
 * 从 mazmot 空间 apps[] 移除指定生成应用的登记记录。
 * @param {string} name 规范化应用名
 */
export async function unregisterAppRecord(storage, name) {
  const apps = (await storage.getItem("apps")) || [];
  const next = apps.filter(
    (a) =>
      !(
        a.mazmot?.source === "ai-builder" &&
        a.name === sanitizeAppName(name)
      ),
  );
  if (next.length !== apps.length) await storage.setItem("apps", next);
}

/**
 * 删除虚拟系统渠道应用的载体目录（ai-apps/<name>/，递归删除）。
 * 本地目录渠道不删盘上文件，只移除登记记录。
 */
export async function deleteVfsApp(fs, appName) {
  const clean = sanitizeAppName(appName);
  const rootDir = await ensureAppRoot(fs);
  const dir = await rootDir.get(clean);
  if (dir && dir.kind === "dir") await dir.remove();
}

/* ---------- 发布到首页应用列表 ----------
 * 「发布」= 把当前应用的 client/ **复制一份**到常规应用命名空间 mazmot-apps/
 * 下，并登记一条普通虚拟应用记录（mazmot.source = "conjure-publish"，不带
 * ai-builder 标记）——首页列表天然可见，点开走 NoneOS 挂载路径直接运行。
 * 发布副本与妙造的工作目录相互独立：删妙造项目不影响已发布副本，在首页删
 * 副本也不影响妙造项目；本地目录渠道（含跨机器不可用的句柄）同样以复制方
 * 式发布，副本不再依赖句柄。版本写在 app.json（首发用现值；内容有变化的
 * 再次发布 patch +1 并写回）；发布状态元数据记在妙造的源登记记录（ai-builder
 * 标记，首页始终隐藏）上，供发布按钮提示与备份列表挂版本徽标。
 */

// 发布副本落点的常规应用命名空间（与安装 / 分享应用共用）
export const PUBLISH_NAMESPACE = "mazmot-apps";

/**
 * 版本号 patch 段 +1（"0.1.0" → "0.1.1"；非法/缺失回退 "0.1.1"）。
 * @param {string} version
 * @returns {string}
 */
export function bumpPatchVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || "").trim());
  if (!m) return "0.1.1";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// 在发布命名空间里找一个未被登记记录与既有目录占用的名字（demo-app、
// demo-app-2、demo-app-3 …）；妙造源登记记录自己的名字让给副本（二者命名
// 空间不同、互不冲突），其余记录名占用时要避开
async function findFreePublishName(fs, apps, base, exceptRecord) {
  const root = await fs.init(PUBLISH_NAMESPACE);
  const taken = new Set(
    apps.filter((a) => a !== exceptRecord).map((a) => a.name),
  );
  let name = base;
  let i = 2;
  while (taken.has(name) || (await root.get(name))) {
    name = `${base}-${i++}`;
  }
  return name;
}

/**
 * 把当前应用发布到首页应用列表：client/ 全量复制到 mazmot-apps/<发布名>/client/，
 * 登记一条普通虚拟应用记录（mazmot.source = "conjure-publish"）。
 * 版本规则：
 * - 首次发布：app.json 版本原样发布（如 0.1.0）；
 * - 内容与上次发布一致且发布副本完好：幂等重发，不 bump、不拷贝；
 * - 内容有变化：app.json 的 version patch +1 写回后，全量重拷（清空旧 client/
 *   再写，避免上一版的残留文件）。
 * 妙造源登记记录（ai-builder 标记）记发布元数据：published / publishedVersion /
 * publishedAt / publishedHash（发布内容指纹，8 位 hex——含刚写回的 app.json
 * 版本号，发布后立刻打的备份与发布内容一致）/ publishedVersions:
 * { [hash8]: version }（备份列表据此给内容一致的备份挂「已发布 vX.Y.Z」徽标，
 * 备份 id 尾部即指纹）/ publishedName（发布副本目录名，重复发布沿用）。
 * 副本记录带 appId（options.userId 传入时 = `${发布名}-${userId}`，首页据此
 * 显示「我开发的」自建标记）与 autoShare: true（主系统列表加载时对 autoShare
 * 记录自动 P2P 发布分享，默认进入分享状态）。
 * @param {Object} fs 注入的 /nos/fs/main.js 模块
 * @param {Object} mazmotStore getStorage("mazmot") 实例
 * @param {string} appName 应用名
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @param {Object} [options]
 * @param {string} [options.userId] 当前用户 userId（生成副本 appId 用）
 * @returns {Promise<{ version: string, hash: string, bumped: boolean, publishName: string }>}
 */
export async function publishAppToHome(fs, mazmotStore, appName, rootHandle, options = {}) {
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  if (!mazmotStore) throw new Error("存储不可用，无法发布");
  // 复制清单用 currentAppFiles（与智能备份同源）：只收集 client/ 下的文本文件
  // 并返回 { path, text }。不能用 listAppFiles——本地渠道它按项目根 flat() 枚举，
  // backup/ 等非 client 文件的路径剥不掉 client/ 前缀会原样返回，逐个 readAppFile
  // 读不到返回 null，dest.write(null) 即报
  // 「Failed to execute 'write' ... not of type 'WriteParams'」（实测踩坑）
  const files = await currentAppFiles(fs, clean, rootHandle);
  if (!files.length) throw new Error("应用目录为空，请先生成应用文件");

  const apps = (await mazmotStore.getItem("apps")) || [];
  const sourceRecord = apps.find(
    (a) => a.mazmot?.source === "ai-builder" && a.name === clean,
  );
  const published =
    sourceRecord?.mazmot?.published && sourceRecord.mazmot.publishedName
      ? sourceRecord.mazmot
      : null;

  // 上次发布副本的记录与副本内 app.json（判定「副本仍然完好」用）
  let homeRecord = null;
  let destJson = null;
  if (published) {
    homeRecord =
      apps.find(
        (a) =>
          a.namespace === PUBLISH_NAMESPACE &&
          a.name === published.publishedName &&
          a.mazmot?.source === "conjure-publish",
      ) || null;
    try {
      const publishRoot = await fs.init(PUBLISH_NAMESPACE);
      const destJsonFile = await publishRoot.get(
        `${published.publishedName}/client/app.json`,
      );
      if (destJsonFile && destJsonFile.kind === "file") {
        destJson = JSON.parse(await destJsonFile.text());
      }
    } catch {
      destJson = null;
    }
  }

  let meta = {};
  try {
    meta = JSON.parse(files.find((f) => f.path === "app.json")?.text || "") || {};
  } catch {
    /* app.json 损坏按空对象处理，发布用默认值兜底 */
  }
  const hashBefore = await currentAppHash(fs, clean, rootHandle);
  const unchanged =
    !!published &&
    published.publishedHash === hashBefore &&
    !!homeRecord &&
    destJson?.version === published.publishedVersion;

  let version;
  if (unchanged) {
    version = published.publishedVersion;
  } else {
    version = published
      ? bumpPatchVersion(meta.version)
      : String(meta.version || "0.1.0");
    meta.version = version;
    await writeAppFile(
      fs,
      clean,
      "app.json",
      JSON.stringify(meta, null, 2),
      rootHandle,
    );
  }

  // 指纹取发布落盘后的源内容（含刚写回的 app.json 版本号）：发布后立刻打的
  // 备份与发布内容一致，备份列表的版本徽标能对上
  const hash = unchanged
    ? hashBefore
    : (await currentAppHash(fs, clean, rootHandle)) || hashBefore;

  // 复制副本：沿用上次发布名（首页记录与地址保持稳定），首次发布找空闲名；
  // 清空旧 client/ 再全量写入，避免上一版的残留文件
  const publishName =
    published?.publishedName ||
    (await findFreePublishName(fs, apps, clean, sourceRecord));
  if (!unchanged) {
    // 拷贝清单在版本写回之后重新收集（含刚写回的新版 app.json）——
    // 复用函数开头的 files 会把旧版本号拷进副本（实测踩坑）
    const copyFiles = await currentAppFiles(fs, clean, rootHandle);
    const publishRoot = await fs.init(PUBLISH_NAMESPACE);
    const destDir = await publishRoot.get(publishName, { create: "dir" });
    const oldClient = await destDir.get("client");
    if (oldClient && oldClient.kind === "dir") await oldClient.remove();
    for (const f of copyFiles) {
      const dest = await destDir.get(`client/${f.path}`, { create: "file" });
      await dest.write(f.text);
    }
  }

  // 源登记记录：记发布元数据（始终带 ai-builder 标记、首页隐藏）
  const base =
    sourceRecord ||
    buildAppRecord({
      appName: clean,
      displayName: meta.displayName,
      icon: meta.icon,
    });
  base.mazmot = {
    ...base.mazmot,
    source: "ai-builder",
    published: true,
    publishedVersion: version,
    publishedAt: unchanged ? published.publishedAt : Date.now(),
    publishedHash: hash,
    publishedVersions: {
      ...(base.mazmot?.publishedVersions || {}),
      [hash]: version,
    },
    publishedName: publishName,
  };
  await registerAppRecord(mazmotStore, base);

  // 发布副本记录：普通虚拟应用（无 ai-builder 标记，首页列表天然可见）
  const homeRec =
    homeRecord || {
      name: publishName,
      source: "virtual",
      namespace: PUBLISH_NAMESPACE,
      dirName: `${PUBLISH_NAMESPACE}/${publishName}`,
      virtualDirName: publishName,
      handle: null,
      createdAt: Date.now(),
    };
  homeRec.desc = String(
    meta.description || homeRec.desc || meta.displayName || publishName,
  );
  homeRec.icon = meta.icon || homeRec.icon || "📦";
  // 我开发的应用：appId 以当前用户 userId 结尾，首页列表据此显示自建标记
  if (options.userId) homeRec.appId = `${publishName}-${options.userId}`;
  // 默认进入应用分享状态：主系统列表加载时对 autoShare 记录自动 P2P 发布
  homeRec.autoShare = true;
  homeRec.mazmot = { source: "conjure-publish", project: clean };
  await registerAppRecord(mazmotStore, homeRec);

  return { version, hash, bumped: !unchanged, publishName };
}

/* ---------- 数据备份管理 ----------
 * 备份落点：client/ 同层的 backup/<id>/ 目录（id 形如 backup-20260908-153012），
 * 把当前 client/ 全部文本文件按原相对路径复制进去；node_modules 等目录整体忽略。
 */

// 打包备份时忽略的目录名（路径任一层级命中即整段跳过）
const BACKUP_IGNORE_DIRS = ["node_modules"];

const pad2 = (n) => String(n).padStart(2, "0");
const backupId = (hash8) => {
  const d = new Date();
  return `backup-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${hash8}`;
};
// 备份 id = 时间戳 + 内容 hash 前 8 位（内容相同 → hash 相同 → 判重跳过）
const isBackupId = (id) => /^backup-\d{8}-\d{6}-[0-9a-f]{8}$/.test(id);

// 扁平化文件清单（排序后 路径+内容 拼接）的 SHA-256 前 8 位 hex
const backupHash = async (files) => {
  const enc = new TextEncoder();
  const parts = [];
  for (const f of files) {
    parts.push(enc.encode(f.path + "\n"), enc.encode(f.text + "\n"));
  }
  const digest = await crypto.subtle.digest("SHA-256", concatBytes(parts));
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
const concatBytes = (list) => {
  const total = list.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of list) {
    out.set(b, off);
    off += b.length;
  }
  return out;
};

// 备份根目录定位：本地渠道为所选目录下的 backup/，虚拟渠道为 ai-apps/<name>/backup/
const resolveBackupBase = async (fs, appName, rootHandle) => {
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  if (rootHandle) return { base: rootHandle, prefix: "backup/" };
  const rootDir = await ensureAppRoot(fs);
  return { base: rootDir, prefix: `${clean}/backup/` };
};

// 递归收集 client/ 下全部文件（返回 { path: 相对 client/ 路径, item }），忽略 IGNORE 目录
const collectClientFiles = async (base, rel) => {
  const clientDir = await base.get(rel.replace(/\/+$/, "")).catch(() => null);
  if (!clientDir || clientDir.kind !== "dir") return [];
  const ignored = (p) =>
    p.split("/").some((seg) => BACKUP_IGNORE_DIRS.includes(seg));
  const out = [];
  const walk = async (dir, prefix) => {
    for await (const key of dir.keys()) {
      const item = await dir.get(key);
      if (!item) continue;
      const p = prefix ? `${prefix}/${key}` : key;
      if (ignored(p)) continue;
      if (item.kind === "dir") await walk(item, p);
      else out.push({ path: p, item });
    }
  };
  await walk(clientDir, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
};

/**
 * 计算当前 client/ 内容指纹（与备份 id 尾部 hash 同算法）；client/ 为空返回空串。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function currentAppHash(fs, appName, rootHandle) {
  const clean = sanitizeAppName(appName);
  if (!clean) return "";
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const collected = await collectClientFiles(base, rel);
  if (collected.length === 0) return "";
  const files = [];
  for (const f of collected) files.push({ path: f.path, text: await f.item.text() });
  return backupHash(files);
}

/**
 * 读取当前 client/ 全部文件（排序后的 { path, text } 清单），供智能备份做版本对比。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function currentAppFiles(fs, appName, rootHandle) {
  const clean = sanitizeAppName(appName);
  if (!clean) return [];
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const collected = await collectClientFiles(base, rel);
  const files = [];
  for (const f of collected) files.push({ path: f.path, text: await f.item.text() });
  return files;
}

/**
 * 读取一份备份目录内的全部文件（忽略 __meta.json，排序后的 { path, text } 清单）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function readBackupFiles(fs, appName, backupId, rootHandle) {
  if (!isBackupId(backupId)) throw new Error("备份 id 不合法");
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const { base, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const dir = await base.get(`${prefix}${backupId}`).catch(() => null);
  if (!dir || dir.kind !== "dir") throw new Error("备份不存在");
  const out = [];
  const walk = async (d, pfx) => {
    for await (const key of d.keys()) {
      const item = await d.get(key);
      if (!item) continue;
      const p = pfx ? `${pfx}/${key}` : key;
      if (item.kind === "dir") await walk(item, p);
      else if (key !== "__meta.json") out.push({ path: p, text: await item.text() });
    }
  };
  await walk(dir, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * 创建备份：把当前 client/ 打包复制到同层 backup/<id>/ 目录。
 * id 含内容 hash（对排序后的 路径+内容 清单算 SHA-256）；已存在相同内容
 * 的备份时跳过写入（幂等，无改动反复点备份不会产生重复备份）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ id: string, files: number, bytes: number, skipped: boolean }>}
 */
export async function createAppBackup(fs, appName, rootHandle, opts = {}) {
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  const collected = await collectClientFiles(base, rel);
  // 先读出内容参与 hash：路径 + 内容 扁平化排序后指纹
  const files = [];
  for (const f of collected) files.push({ path: f.path, text: await f.item.text() });
  const hash8 = await backupHash(files);
  const { base: bBase, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const existing = await listAppBackups(fs, clean, rootHandle);
  const hit = existing.find((b) => b.id.endsWith(`-${hash8}`));
  if (hit) return { id: hit.id, files: files.length, bytes: 0, skipped: true };

  const id = backupId(hash8);
  let bytes = 0;
  for (const f of files) {
    const dest = await bBase.get(`${prefix}${id}/${f.path}`, { create: "file" });
    await dest.write(f.text);
    bytes += new Blob([f.text]).size;
  }
  // 回合自动快照：__meta.json 标记 auto（备份列表展示「自动」徽标用；
  // 后续 rename / setNote 照常合并写入，标记保留）
  if (opts.auto) {
    const metaFile = await bBase.get(`${prefix}${id}/__meta.json`, { create: "file" });
    await metaFile.write(JSON.stringify({ auto: true }));
  }
  return { id, files: files.length, bytes, skipped: false };
}

// 读备份目录的 __meta.json（缺失/损坏返回空对象）
const readBackupMeta = async (dir) => {
  try {
    const meta = await dir.get("__meta.json");
    if (meta && meta.kind === "file") return JSON.parse(await meta.text()) || {};
  } catch {
    /* meta 缺失/损坏按空处理 */
  }
  return {};
};

/**
 * 列出已有备份（backup/ 下的目录，新的在前）。
 * 每项带 label（自定义名称）与 note（备注），均存目录内 __meta.json；
 * auto 标记回合自动快照（UI「自动」徽标）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ id: string, label: string, note: string, auto?: boolean }[]>}
 */
export async function listAppBackups(fs, appName, rootHandle) {
  const clean = sanitizeAppName(appName);
  if (!clean) return [];
  const { base, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const dir = await base.get(prefix.replace(/\/+$/, "")).catch(() => null);
  if (!dir || dir.kind !== "dir") return [];
  const out = [];
  for await (const key of dir.keys()) {
    const item = await dir.get(key);
    if (!item || item.kind !== "dir" || !isBackupId(key)) continue;
    const meta = await readBackupMeta(item);
    out.push({
      id: key,
      label: meta.label || "",
      note: meta.note || "",
      ...(meta.auto ? { auto: true } : {}),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

// 写备份 meta 的单个字段（保留其它字段）；校验备份 id 与存在性
const writeBackupMetaField = async (
  fs,
  appName,
  backupId,
  field,
  value,
  rootHandle,
) => {
  if (!isBackupId(backupId)) throw new Error("备份 id 不合法");
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const { base, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const dir = await base.get(`${prefix}${backupId}`).catch(() => null);
  if (!dir || dir.kind !== "dir") throw new Error("备份不存在");
  const meta = await readBackupMeta(dir);
  meta[field] = value;
  const file = await dir.get("__meta.json", { create: "file" });
  await file.write(JSON.stringify(meta));
};

/**
 * 给备份更名（写入备份目录内 __meta.json 的 label；目录名不变，
 * 内容寻址与去重逻辑不受影响）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function renameAppBackup(fs, appName, backupId, label, rootHandle) {
  const name = String(label ?? "").trim();
  if (!name) throw new Error("名称不能为空");
  if (name.length > 50) throw new Error("名称过长（最多 50 字）");
  await writeBackupMetaField(fs, appName, backupId, "label", name, rootHandle);
}

/**
 * 设置备份备注（写入 __meta.json 的 note；空串清除备注）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function setBackupNote(fs, appName, backupId, note, rootHandle) {
  const text = String(note ?? "").trim();
  if (text.length > 200) throw new Error("备注过长（最多 200 字）");
  await writeBackupMetaField(fs, appName, backupId, "note", text, rootHandle);
}

/**
 * 还原备份：把 backup/<id>/ 的内容写回 client/（先清空 client/，__meta.json 不参与还原）。
 * 当前 client/ 内容与该备份一致（hash 相同）时不做任何写入，返回 unchanged。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ restored: boolean, reason?: "unchanged", files: number, bytes?: number }>}
 */
export async function restoreAppBackup(fs, appName, backupId, rootHandle) {
  if (!isBackupId(backupId)) throw new Error("备份 id 不合法");
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const { base, rel } = await resolveBaseDir(fs, clean, rootHandle);
  // 无变动检测：当前内容指纹与备份 id 尾部的 hash 一致即无需还原
  const collected = await collectClientFiles(base, rel);
  const current = [];
  for (const f of collected) current.push({ path: f.path, text: await f.item.text() });
  const currentHash = await backupHash(current);
  if (backupId.endsWith(`-${currentHash}`)) {
    return { restored: false, reason: "unchanged", files: current.length };
  }

  const { base: bBase, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const bDir = await bBase.get(`${prefix}${backupId}`).catch(() => null);
  if (!bDir || bDir.kind !== "dir") throw new Error("备份不存在");

  // 覆盖还原：清空 client/ 后按备份目录结构写回
  const clientDir = await base.get(rel.replace(/\/+$/, "")).catch(() => null);
  if (clientDir && clientDir.kind === "dir") await clientDir.remove();
  let files = 0;
  let bytes = 0;
  const walk = async (dir, pfx) => {
    for await (const key of dir.keys()) {
      const item = await dir.get(key);
      if (!item) continue;
      const p = pfx ? `${pfx}/${key}` : key;
      if (item.kind === "dir") {
        await walk(item, p);
      } else if (key !== "__meta.json") {
        const text = await item.text();
        const dest = await base.get(`${rel}${p}`, { create: "file" });
        await dest.write(text);
        files++;
        bytes += new Blob([text]).size;
      }
    }
  };
  await walk(bDir, "");
  // 覆盖还原后文件集可能变化（旧备份无 __app.json / 文件集不同步）：
  // 重新对齐安装清单（version 增删即 bump，与回合收尾同语义）
  try {
    await syncAppManifest(fs, clean, rootHandle);
  } catch (err) {
    console.warn("[builder] 还原后同步 __app.json 失败：", err);
  }
  return { restored: true, files, bytes };
}

/**
 * 删除一份备份（递归删除 backup/<id>/ 目录）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 */
export async function deleteAppBackup(fs, appName, backupId, rootHandle) {
  if (!isBackupId(backupId)) throw new Error("备份 id 不合法");
  const clean = sanitizeAppName(appName);
  if (!clean) throw new Error("应用名不合法");
  const { base, prefix } = await resolveBackupBase(fs, clean, rootHandle);
  const dir = await base.get(`${prefix}${backupId}`).catch(() => null);
  if (dir && dir.kind === "dir") await dir.remove();
}

/* ---------- 本地项目导入与对话快照 ----------
 * 本地目录渠道的项目根目录（client/ 同层）放一份 conjure-chats.json，
 * 每次对话回合结束写入全量快照（会话列表 + 各会话消息 + Agent 记忆），
 * 下次选择该目录时据此走「导入项目」流程恢复对话数据。
 */

export const PROJECT_CHAT_FILE = "conjure-chats.json";

/** 对话快照目录（新版布局：index.json 会话列表 + 每会话一个 <sid>.json） */
export const PROJECT_CHAT_DIR = "conjure-chats";

/** sid → 快照文件名（sid 中的非法字符过滤掉） */
const chatSidFile = (sid) => {
  const safe = String(sid || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return safe ? `${safe}.json` : null;
};

/** 探测目录是否为既有项目：存在 client/app.json 即是，返回其元数据（否则 null） */
export async function detectLocalProject(rootHandle) {
  try {
    const f = await rootHandle.get("client/app.json");
    if (!f || f.kind !== "file") return null;
    const meta = JSON.parse(await f.text());
    return meta && meta.name ? meta : null;
  } catch {
    return null;
  }
}

/**
 * 把对话快照写入项目目录（client/ 同层的 conjure-chats/，目录化布局）：
 *   conjure-chats/index.json     会话列表元数据（不含消息，体量恒定）
 *   conjure-chats/<sid>.json     每会话一个文件（messages + thread）
 * data.onlySid 提供时只重写该会话的文件（回合收尾的增量场景，其余会话
 * 文件不动、也不做孤儿清理——它们不在本次写入集合内）；缺省为全量模式，
 * 会按 index 的会话列表清理已删除会话的孤儿文件。
 */
export async function saveProjectChats(rootHandle, data) {
  const dir = await rootHandle.get(PROJECT_CHAT_DIR, { create: "dir" });
  const index = {
    version: 2,
    app: data.app,
    sessionOrder: data.sessionOrder ?? null,
    sessions: data.sessions || [],
    savedAt: Date.now(),
  };
  const idxFile = await dir.get("index.json", { create: "file" });
  await idxFile.write(JSON.stringify(index, null, 2));

  const onlySid = data.onlySid || null;
  const targets = onlySid
    ? (data.sessions || []).filter((s) => s.id === onlySid)
    : data.sessions || [];
  const alive = new Set();
  for (const s of targets) {
    const fname = chatSidFile(s.id);
    if (!fname) continue;
    alive.add(fname);
    const payload = {
      id: s.id,
      messages: data.messages?.[s.id] || [],
      thread: data.threads?.[s.id] || [],
    };
    const f = await dir.get(fname, { create: "file" });
    await f.write(JSON.stringify(payload, null, 2));
  }
  if (!onlySid) {
    // 全量模式：按会话列表清理已删除会话的孤儿文件
    const keys = [];
    for await (const key of dir.keys()) keys.push(key);
    for (const key of keys) {
      if (key === "index.json" || alive.has(key)) continue;
      const f = await dir.get(key).catch(() => null);
      if (f && f.kind === "file") await f.remove();
    }
  }
}

/**
 * 读取项目目录的对话快照，缺失 / 损坏返回 null。
 * 目录格式优先；index.json 不存在时回退旧版单文件 conjure-chats.json
 * （存量项目只读兼容——导入后首次回合收尾即写入新目录，旧文件可手动删除）。
 * 返回聚合结构 { sessions, messages, threads, sessionOrder, app, savedAt }，
 * 与旧版单文件结构同形，调用方无感。
 */
export async function loadProjectChats(rootHandle) {
  try {
    const dir = await rootHandle.get(PROJECT_CHAT_DIR);
    if (dir && dir.kind === "dir") {
      const idxFile = await dir.get("index.json");
      if (idxFile && idxFile.kind === "file") {
        const index = JSON.parse(await idxFile.text());
        const sessions = index.sessions || [];
        const messages = {};
        const threads = {};
        for (const s of sessions) {
          const fname = chatSidFile(s.id);
          if (!fname) continue;
          try {
            const f = await dir.get(fname);
            if (f && f.kind === "file") {
              const one = JSON.parse(await f.text());
              messages[s.id] = Array.isArray(one.messages) ? one.messages : [];
              threads[s.id] = Array.isArray(one.thread) ? one.thread : [];
            }
          } catch {}
        }
        return {
          version: 2,
          app: index.app,
          sessionOrder: index.sessionOrder ?? null,
          sessions,
          messages,
          threads,
          savedAt: index.savedAt,
        };
      }
    }
  } catch {}
  try {
    const f = await rootHandle.get(PROJECT_CHAT_FILE);
    if (!f || f.kind !== "file") return null;
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

/**
 * 系统提示词：教模型 Mazmot/ofa.js 应用结构与平台约束。
 */
export const SYSTEM_PROMPT = `你运行在 Mazmot 虚拟系统的「妙造」（conjure）应用里：用户正在妙造的对话界面中与你交流，你通过对话为用户生成可直接运行的 ofa.js 网页应用。生成出的应用也运行在 Mazmot 系统内（Mazmot 基于 NoneOS Core 开发），因此应用既能使用 Mazmot 平台 API（/mz/*），也能使用 NoneOS Core 系统 API（/nos/*），详见「平台能力」一节。你可调用的工具（write_file / edit_file / read_file / list_files / create_app / preview / show_form / read_skill / web_fetch / web_search）均由妙造提供；其中 preview 工具把应用推送到隔离预览窗口实际运行，是你实测调试的唯一通道。应用文件写入虚拟文件系统或用户所选本地目录的 client/ 子目录。

## 工作流程
1. 先计划再动手：新项目写第一个文件之前，先用几行文字向用户给出实现计划（功能点、拟建的文件清单、推进顺序），让用户在动手前就能纠正方向；已有应用的小改动不必单独计划，开头说清楚要改什么即可。需求含糊且影响方向时（比如只说「做个工具」没说功能范围）先简短澄清再动手。
2. 依次用 write_file 写入下列文件（路径相对 client/ 目录，本地目录渠道与虚拟渠道一致）：
   - index.html —— 入口 HTML
   - app-config.js —— 导出 home 等页面路由
   - pages/home.html —— 首页页面模块
   - client/ 下的 __app.json 由宿主自动维护（应用元数据与文件清单，版本随文件增删自动递增）——**禁止创建、修改或删除它**，list_files/read_file 看到它时跳过即可。
3. 开发调试闭环（必须，不能只凭代码推断「应该没问题」）：
   - 尽早首跑：写完入口骨架（index.html / app-config.js / 首个页面）就先用 preview 工具（action=app，appName 必填）跑一次，确认应用能打开、骨架无报错，再继续写功能——不要全部写完才第一次运行，越早看到真实运行越早暴露问题；
   - 每完成一层功能（一个页面 / 一块交互 / 一组数据逻辑）都 write_file 后用 preview action=app 刷新实际运行验证，小步推进；
   - 发现问题先取证再改，禁止不看证据凭猜测连环改代码：控制台报错 → action=console 读日志；渲染不对 → action=dom / text 看真实 DOM；交互失灵 → action=click / type 复现用户操作；
   - 预览页内容渲染在 \`o-app\`/\`o-page\` 的 shadow DOM 里：action=text 读不到页面文本，用 action=dom 或 eval 查 \`shadowRoot\`；白屏或报「加载页面模块 … 失败」时，真实错误栈在 \`document.querySelector('o-app > o-page').shadowRoot.textContent\` 里（该报错不带原因、status 的 errors 计数也不含它），先 eval 取证再改；
   - 修复 → preview action=app 刷新 → 复查（记住 action=console 返回的 latestTs，修复后传 args.since 增量对比新日志），直到控制台无错误、核心交互实测可用为止；
   - 用户反馈界面/运行问题时：先用 preview 的 action=status 看预览窗口是否已开着——已开着就直接在现场排查（action=console 查错误日志、action=dom / text 看实际渲染、action=click / type 复现用户操作），**不要先 action=app**：刷新会清空控制台缓冲，丢失用户报的错误现场；预览没开才 action=app 拉起再排查；
   - 预览返回「预览窗口被浏览器拦截」时：浏览器默认禁止页面自动开新窗口，首次预览很容易撞上，调试在放行前无法继续——按工具返回的指引告诉用户怎么放行（点地址栏的弹窗拦截图标 → 「始终允许」本站弹窗），然后**停下来等用户回复确认**，确认后用 check-popup 验证放行成功再 action=app 重推；放行前禁止反复重试或继续其他调试动作。
   - 预览窗口是用户的真实环境：不要故意输入垃圾数据、不要触发破坏性操作（删除全部数据之类）。
4. 卡住就求助：同一个问题连续 2 次修复尝试仍然失败（改了 A 坏 B、多种写法都不对、开始怀疑是框架/平台的 bug）时，**停止盲目试错**——把「期望什么 / 实际什么 / 已试过哪些方案与各自结果 / 当前怀疑」整理成一段话直接向用户求助，或用 show_form 给出候选方案让用户拍板，不要无限循环消耗回合。
5. 调试通过后，把项目文档体系填充为真实内容（系统创建项目时已在 client/ 预写了 AGENTS.md / CONTEXT.md / MEMORY.md / pitfalls/README.md 四份骨架，write_file 整文件覆盖填充即可；内容基于你实际写的代码，不要写空话——这套文档是后续会话的记忆载体，宿主会把 AGENTS.md 自动注入每次对话）：
   - **CONTEXT.md** —— 按骨架小节填充：一句话定位、使用指南、目录结构树、数据模型、关键流程、**「踩坑索引」表**（编号 / 标题 / 文件路径三列，供后续按标题按需精读；本次没踩坑就保留空表头）；
   - **MEMORY.md** —— 把本次生成与验证结论记为第一条（日期 / 改了什么 / 为什么 / 验证结论）；之后每回合改动按 AGENTS.md「记忆体规则」追加；
   - **pitfalls/** —— 开发过程踩的每个坑一坑一文件（\`NNN-英文短横线-slug.md\`，格式见 \`pitfalls/README.md\`），并同步登记进 CONTEXT.md 踩坑索引；本次没踩坑就不建文件；
   - **AGENTS.md** —— 已预写通用规范，**不要重写**；本项目沉淀出特有的硬性规则时追加在其「硬性约定」节末尾，通用条款不动；
   - 骨架里的 \`<!-- skeleton\` 首行注释标记与「待填」「暂无记录」占位必须全部被真实内容替换，不能留着占位交差。
6. 完成标准（全部满足才算完成，不要提前宣布完成）：① preview 实际运行且控制台无错误；② 核心交互在预览窗口实测过（action=click / type 真实操作过），不是只看渲染；③ 文档体系已填充为与实际代码一致的真实内容（CONTEXT.md / MEMORY.md / 踩坑索引，不留骨架占位；修改已有应用时已同步更新，AGENTS.md 有新硬规则已追加）。全部满足后，用一段简短的话告诉用户：做了什么、功能与用法、验证过的结论。

## 生成的应用必须遵守的技术规范（ofa.js 框架，无构建步骤）
### index.html 模板（必须一致）
\`\`\`html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>应用名</title>
    <script src="/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug" type="module"></script>
    <script src="/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs" type="module"></script>
    <script src="/gh/ofajs/senti-ui@latest/packages/boot/st-boot.js"></script>
    <style>html,body{height:100%;margin:0}</style>
  </head>
  <body>
    <o-router fix-body>
      <o-app src="./app-config.js"></o-app>
    </o-router>
  </body>
</html>
\`\`\`

### app-config.js
\`\`\`js
export const home = "./pages/home.html";
\`\`\`

### 页面模块（pages/*.html）
- 结构：\`<template page>\` 内放 \`<style>\`、模板内容、\`<script>\`（script 必须在 template 内部），export default async ({ load }) => ({ data, proto, ready ... })。
- 文本插值 \`{{expr}}\` 只能用在元素文本内容里，属性一律用 attr: / :prop / class: / :style. 指令；布尔属性（disabled 等）必须用 attr: 而非 :prop。
- 列表用 \`<o-fill :value="list" fill-key="id">\`，项内用 $data / $host；条件用 \`<o-if :value="...">\`。
- 计算属性用 proto 里的 getter；方法放 proto；事件 on:click="方法名"。
- 模板引用的每个变量必须先在 data 声明安全默认值；proto/data 不能叫 back/goto/replace/src。
- o-fill 的 {{}} 表达式里不要写 &&（会编译失败），抽成 $host 方法。

### 平台能力（Mazmot 与 NoneOS Core 双层 API）
生成的应用运行在 Mazmot 系统内（Mazmot 基于 NoneOS Core 开发），可用两套系统 API：
- NoneOS Core（/nos/*）：/nos/storage/main.js 键值存储（见「数据持久化」）、/nos/fs/main.js 文件系统、/nos/user/main.js 用户等；
- Mazmot 平台（/mz/*）：/mz/net/main.js 联网抓取与搜索（见下一节）、/mz/ai/main.js 多供应商 AI 对话、/mz/share-mgr.js 应用分享等。
加载约束与 /nos/* 相同：页面模块顶层禁止 import，必须用页面工厂参数注入的 load 按需加载。API 用法不确定时先 read_skill 查知识库（Mazmot 平台 → mazmot-api，NoneOS Core → noneos-core-docs）。

### 联网请求必须用平台 fetch（原生 fetch 跨域必失败）
浏览器原生 fetch 请求任何非同源地址都会被 CORS 拦截（绝大多数第三方接口 / 网页不开放跨域），生成的应用代码里凡是要访问外部 http(s) 接口或网页，必须用 Mazmot 平台的 /mz/net/main.js——它经服务端中转，没有跨域限制，平台已配好通道，应用零配置可用：
\`\`\`js
export default async ({ load }) => {
  const net = await load("/mz/net/main.js");
  // net.fetch 与原生 fetch 同形：把 fetch 换成 net.fetch 即可读跨域资源（仅支持 GET）
  const res = await net.fetch("https://api.example.com/data");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  // 抓网页正文用便捷层：自动提取正文（去 HTML 标签）+ 截断 + 会话缓存
  const page = await net.fetchText("https://example.com/article");
  // 联网搜索：const sr = await net.searchWeb("关键词"); sr.results → [{ title, url, content }]
  return { data: {} };
};
\`\`\`
- 仅 GET 语义（POST 等写请求不经中转，需要第三方写接口时如实告知用户该平台限制，不要假装已调用成功）；上游 4xx/5xx 不抛错，用 res.ok / res.status 判断。
- 应用自身同源资源（./ 相对路径、/gh/、/nos/、/mz/ 等）不涉及跨域，仍用原生 fetch。

### 视觉与组件
- 配色只用 Material Design 3 语义色 CSS 变量：var(--md-sys-color-primary)、surface、on-surface、surface-variant、primary-container、error-container 等，不得写死十六进制色。
- 需要弹窗/提示时可用 senti-ui 的 st-dialog / toast（先 \`<l-m src="/gh/ofajs/senti-ui@latest/packages/dialog/st-dialog.html"></l-m>\` 声明）。

### 数据持久化（如应用需要保存数据）
- 统一用 /nos/storage/main.js，禁止 localStorage。页面模块顶层禁止 import /nos/*，必须运行时用**页面工厂参数注入的 load** 加载（**禁止 \`lm(import.meta)\`**——页面脚本被编译成 \`data:\` URL 模块执行，import.meta 不能作 URL base，解析任何路径都抛 Invalid URL，整页加载失败且报错不带原因）：
\`\`\`js
export default async ({ load }) => {
  const { getStorage } = await load("/nos/storage/main.js");
  const store = getStorage("<app-独立空间>");
  await store.setItem("key", value);
  return { data: { /* 声明模板用到的 data 安全默认值 */ } };
};
\`\`\`

## 硬性约束
- 只写 UTF-8 文本文件（html/js/css/json/md/txt/svg 等），绝不生成图片/字体等二进制资源；需要图标用 emoji。
- 单个文件尽量小于 300 行，功能聚焦，一次对话先交付可运行的最小版本。
- 修改已有应用：先用 read_file / list_files 查看，改动局部内容**优先用 edit_file 差量编辑**（old_string 按原文精确引用，省 token 且不碰未提及部分；未命中时重新 read_file 对照原文），新建文件或整体重写才用 write_file；改完重新用 preview 工具（action=app）验证无回归（增量更新很快）再收尾；改动后按项目 AGENTS.md 的「文档同步规则」同步文档——CONTEXT.md 对应小节 + MEMORY.md 登记，踩了新坑沉淀到 pitfalls/ 并登记索引（沉淀出新硬规则则追加进 AGENTS.md）。
- **写 ofa.js 模板 / 用到底部「可用知识库」清单内的技术前禁止凭记忆编写**：先调用 read_skill 读对应知识库校对语法与 API（至少每次会话首次编写前读一次；拿不准的语法查 references）。
- **联网查阅用 web_search + web_fetch**：时效性问题、不知道确切网址、需要多来源对比时先用 web_search（结果含标题/链接/摘要）；需要某个页面的完整内容时用 web_fetch 抓取（返回正文已去 HTML 标签且超长截断）。典型组合：search 找到相关 URL → fetch 读全文。抓不到（反爬/需登录/私网地址）时如实告知用户，不要对同一目标反复重试，更不要抓取猜测拼凑的地址。
- **生成应用代码里的联网请求必须用 /mz/net/main.js**：原生 fetch 请求第三方地址会 CORS 失败，一律用 net.fetch / fetchText / searchWeb（见「联网请求」节）；用户让应用「联网查数据 / 抓取页面」时优先想到它，不要写原生 fetch 然后跨域报错。
- 回复用户时使用中文，简洁说明写了哪些文件、如何使用。`;

/**
 * 上下文压缩摘要的系统提示词：把对话记录压成一份短摘要，作为后续对话
 * 的记忆主体。保留工作必需的骨架信息，丢弃可随时用 read_file 找回的细节。
 */
export const COMPACTION_PROMPT = `你是对话压缩器。把提供的 AI 应用开发对话记录压缩成一份简明摘要，这份摘要将作为后续对话的唯一上下文。要求：
1. 必须保留：用户的应用需求与目标；已创建的应用名与文件清单（路径级别）；重要决策与用户偏好；当前进行中的任务与未完成事项；出现过的错误与教训。
2. 可以丢弃：文件内容的代码细节、工具返回的原始输出、寒暄与重复内容（需要细节时 Agent 可用 read_file / list_files 自行找回）。
3. 用中文条目化输出，总长度控制在 800 字以内。直接输出摘要正文，不要任何前后缀或评论。`;

/**
 * 项目规则（AGENTS.md 自动注入）的截断上限（字符）：个别项目的规则文档可能
 * 超长，超限掐头留尾并提示用 read_file 读全文，防止系统提示词被撑爆。
 */
const RULES_CLIP = 6000;

/**
 * 按当前上下文构建系统提示词：在基础规范上注入「正在开发哪个应用」，
 * 并强制回答项目相关问题前先读文件（防模型凭空猜测项目内容）。
 * @param {{ appName?: string, displayName?: string, mode?: "vfs"|"local",
 *          skills?: Array<{id:string,name:string,description:string}>,
 *          freshProject?: boolean, projectRules?: string }} [ctx]
 *        appName 为空表示「新应用」草稿阶段；skills 为可用技能知识库清单；
 *        projectRules 为项目 AGENTS.md 的内容（宿主在会话开始时自动读取注入，
 *        harness 常规机制——项目规则随会话自动生效，不依赖模型自觉去读）
 */
export function buildSystemPrompt(ctx = {}) {
  let prompt = SYSTEM_PROMPT;
  if (ctx.appName && ctx.freshProject) {
    // 全新项目：系统已在用户发送首条消息时建好目录与占位 app.json，
    // 模型跳过 create_app 直接生成（宿主同时会把 create_app 从工具清单移除）
    const where =
      ctx.mode === "local"
        ? `用户本地磁盘所选目录的 client/ 子目录（路径相对 client/，多级路径会自动建目录）`
        : `虚拟文件系统 /$${NAMESPACE}/${ctx.appName}/client/`;
    prompt += `

## 当前上下文（重要）
项目「${ctx.displayName || ctx.appName}」（应用名 ${ctx.appName}，文件在 ${where}）是**系统刚为你创建的空项目**，目录里只有一个占位 app.json（displayName / icon 都是占位值）和预写的文档骨架（AGENTS.md / CONTEXT.md / MEMORY.md / pitfalls/README.md）。
- **不要调用 create_app**，从 write_file 直接开始；项目当前没有代码，也无需先 read_file 查看。
- 第一个文件就写 app.json：覆盖为正确的 displayName / icon / description（icon 用一个贴切的 emoji，name 保持 ${ctx.appName} 不变）。
- 之后按上方工作流程第 2 步起照常执行（index.html / app-config.js / pages/... → preview 实测调试 → 按第 5 步填充文档体系）；client/ 下已预写好整套文档骨架（AGENTS.md / CONTEXT.md / MEMORY.md / pitfalls/README.md）——AGENTS.md 不要重写，其余三份按第 5 步填充为真实内容。`;
  } else if (ctx.appName) {
    const where =
      ctx.mode === "local"
        ? `用户本地磁盘所选目录的 client/ 子目录（路径相对 client/，多级路径会自动建目录）`
        : `虚拟文件系统 /$${NAMESPACE}/${ctx.appName}/client/`;
    prompt += `

## 当前上下文（重要）
用户正在开发一个**已存在的应用**「${ctx.displayName || ctx.appName}」（应用名 ${ctx.appName}，文件在 ${where}）。
- **会话开始按项目 AGENTS.md 头部的读取顺序执行**：先 \`read_file\` 读 CONTEXT.md（项目事实 + 「踩坑索引」——按索引标题挑出与本回合任务相关的坑，先精读对应 \`pitfalls/NNN-*.md\` 再动手），再读 MEMORY.md 恢复记忆，然后按需 list_files / read_file 目标文件（含 app.json）。只依据真实文件内容回答，禁止凭猜测或通用模板描述项目。
- 读到的文档若仍是骨架占位（首行 \`<!-- skeleton\` 注释标记，或「待填」「暂无记录」字样）或缺失（较早期生成的项目没有这些文件），说明上次会话未完成收尾：先按项目 AGENTS.md 的体系规则把占位 / 缺失的文档基于实际代码补齐（AGENTS.md 缺失时按下方对应章节补建），再继续本回合任务。
- 修改严格遵守项目 AGENTS.md 的硬性约定与各节规则（其内容已在下方「项目规则」自动加载）；改动完成后用 preview 工具实际运行验证无回归（action=app 推送刷新，console / dom / click 检查），回合收尾按其「文档同步规则」与「完成标准」执行（CONTEXT.md 同步、MEMORY.md 登记、踩坑沉淀）。
- 不要再调用 create_app 重建同名应用，除非用户明确要求推倒重来。`;
    // 自动加载项目 AGENTS.md：有则整节注入（超长截断）；无则内嵌通用模板让
    // 模型一次性补建（较早期生成的项目没有这份文件）
    const rules = String(ctx.projectRules || "").trim();
    if (rules) {
      const clipped =
        rules.length > RULES_CLIP
          ? `${rules.slice(0, RULES_CLIP)}\n…（AGENTS.md 过长已截断，需要完整内容时用 read_file 读取）`
          : rules;
      prompt += `

## 项目规则（AGENTS.md，已自动加载，必须遵守）
${clipped}`;
    } else {
      prompt += `

## AGENTS.md 创建（项目尚未有此文件）
本项目还没有 AGENTS.md（较早期生成的项目）。请在本回合顺手用 write_file 创建：把下方通用模板**原样**写入 AGENTS.md（标题中的 <项目名> 换成「${ctx.displayName || ctx.appName}」），不要增删通用条款；本项目特有的硬性规则（如有）追加在「硬性约定」节末尾。

\`\`\`markdown
${AGENTS_MD_TEMPLATE}
\`\`\``;
    }
  }
  if (Array.isArray(ctx.skills) && ctx.skills.length) {
    const lines = ctx.skills
      .map((s) => `- ${s.id}（${s.name}）：${s.description}`)
      .join("\n");
    prompt += `

## 可用知识库（read_skill 工具）
${lines}

用法：read_skill(skill, path?)，skill 只能用上面列出的 id，默认读该技能的 SKILL.md，再按文中引用的 references/xxx.md 精读。`;
  } else if (Array.isArray(ctx.skills)) {
    prompt += `

## 可用知识库（read_skill 工具）
当前没有已安装的知识库（同步可能失败或仍在进行），不要调用 read_skill，直接按下方技术规范编写。`;
  }
  // 宿主自动检测的预览运行错误（上回合结束后推送预览、读 console 收集）：
  // 注入本回合提示词——修复它们是默认优先项（除非用户本回合另有明确指示）
  const autoErrs = Array.isArray(ctx.autoErrors) ? ctx.autoErrors.filter(Boolean) : [];
  if (autoErrs.length) {
    const clippedErrs = autoErrs.slice(0, 6).join("\n");
    prompt += `

## 预览自动检测报告（宿主）
宿主在上一回合结束后自动推送了最新代码并检查了预览窗口的控制台，发现 ${autoErrs.length} 条运行错误（用户已看到同样信息）：
${clippedErrs}

除非用户本条消息另有明确指示，修复这些错误是本回合的最高优先级：先用 read_file 查看相关文件定位原因，edit_file 修复后用 preview（action=app 推送，再 console 确认错误消失）验证。`;
  }
  // 回滚通知（宿主注入，一次性）：rollback.sentiment 区分中性还原与负反馈。
  // 事实 + 约束，不下指令——用户下一轮想改方向或在旧方案上修都自由
  const rb = ctx.rollback;
  if (rb && rb.appName === ctx.appName) {
    prompt +=
      rb.sentiment === "dissatisfied"
        ? `

## 回滚通知（宿主）
用户已把应用文件回滚到某一回合开始前的快照，并对该回合的改动**表示不满意**（该回合的用户请求是「${String(rb.requestText || "").slice(0, 120) || "（未记录）"}」）。当前磁盘内容是用户认可的现状：不要把之前生成的方案原样重写回来，也不要默认在旧方案上继续；先 read_file 确认相关文件的当前状态，再按用户本回合的新指示行动。若这次失败有值得沉淀的教训，回合收尾时按项目规范登记到 pitfalls/。`
        : `

## 回滚通知（宿主）
用户已把应用文件回滚到某一回合开始前的快照（中性操作，不含不满含义）。当前磁盘内容可能与本会话的对话记忆不一致：一律以 read_file 的真实结果为准，不要凭记忆把已撤销的内容写回；按用户本回合的指示行动。`;
  }
  return prompt;
}
