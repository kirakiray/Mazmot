// 妙造核心库
// 职责：存放系统提示词、应用名/路径校验、VFS 写入编排、apps[] 记录登记。
// 本模块不静态 import /nos/* 与 /mz/*（受 Core 加载时机约束），
// fs / storage / tool 均由页面模块通过 load() 加载后注入。

// 生成应用在虚拟文件系统中的根命名空间：init("ai-apps") 在 VFS 根创建该目录，
// 每个生成的应用再在其下建 <name>/client/ 作为应用载体目录。
// 独立命名空间、不与主系统的 mazmot-apps/ 混用；生成应用也不进主系统应用列表。
export const NAMESPACE = "ai-apps";

// 旧版命名空间（历史生成的应用被迁到共享的 mazmot-apps/ 下，启动时迁回 ai-apps/）
export const LEGACY_NAMESPACE = "mazmot-apps";

// 一个可运行应用在 client/ 下必须存在的文件
export const REQUIRED_FILES = ["app.json", "index.html", "app-config.js"];

// 各供应商可用的对话模型（与 mz/ai/supplier 里支持的模型清单保持一致）；
// 模型可选项依赖当前选中的 API Key 所属供应商
export const MODEL_OPTIONS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  glm: ["glm-5.3-flash", "glm-5.3"],
  "glm-coding": ["glm-5.3-flash", "glm-5.3"],
  kimi: ["kimi-k3", "kimi-k2.7-code"],
};

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
 * 创建应用并写入 app.json。
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
  return { name: clean, displayName: displayName || clean, dir: base };
}

/**
 * 往应用写入一个文件（自动创建中间目录）。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ path: string, bytes: number }>}
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
  const file = await base.get(rel + relPath, { create: "file" });
  await file.write(text);
  return { path: relPath, bytes: new Blob([text]).size, name: clean, initialized };
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
  const walk = async (dir) => {
    if (typeof dir.flat === "function") {
      for (const f of await dir.flat()) {
        out.push(toRel(f.path));
      }
      return;
    }
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
 * 校验应用是否具备可运行的最小文件集。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ ready: boolean, missing: string[], files: string[] }>}
 */
export async function validateApp(fs, appName, rootHandle) {
  const files = await listAppFiles(fs, appName, rootHandle);
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
export async function createAppBackup(fs, appName, rootHandle) {
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
 * 每项带 label（自定义名称）与 note（备注），均存目录内 __meta.json。
 * @param {Object} [rootHandle] 本地目录渠道的项目根目录句柄（可选）
 * @returns {Promise<{ id: string, label: string, note: string }[]>}
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
    out.push({ id: key, label: meta.label || "", note: meta.note || "" });
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

/** 把对话快照写入项目目录（JSON 文本，放 client/ 同层） */
export async function saveProjectChats(rootHandle, data) {
  const f = await rootHandle.get(PROJECT_CHAT_FILE, { create: "file" });
  await f.write(JSON.stringify(data, null, 2));
}

/** 读取项目目录的对话快照，缺失 / 损坏返回 null */
export async function loadProjectChats(rootHandle) {
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
export const SYSTEM_PROMPT = `你是 Mazmot 虚拟系统里的 妙造，通过对话为用户生成可直接运行的 ofa.js 网页应用，并把文件写入虚拟文件系统。

## 工作流程
1. 理解用户需求，必要时先简短澄清；然后调用 create_app（name 用小写英文短横线，如 todo-app；displayName 可用中文）。
2. 依次用 write_file 写入下列文件（路径相对 client/ 目录，本地目录渠道与虚拟渠道一致）：
   - index.html —— 入口 HTML
   - app-config.js —— 导出 home 等页面路由
   - pages/home.html —— 首页页面模块
3. 功能文件完成后，实际运行调试（必须，不能只凭代码推断「应该没问题」）：
   - 新功能写完：用 preview 工具（action=app，appName 必填）把应用推送到隔离预览窗口实际运行（返回时已在跑最新代码）；
   - 用户反馈界面/运行问题时：先用 preview 的 action=status 看预览窗口是否已开着——已开着就直接在现场排查（action=console 查错误日志、action=dom / text 看实际渲染、action=click / type 复现用户操作），**不要先 action=app**：刷新会清空控制台缓冲，丢失用户报的错误现场；预览没开才 action=app 拉起再排查；
   - 发现问题（报错、渲染不对、交互失灵）→ write_file 修复 → preview action=app 刷新 → 复查（记住 action=console 返回的 latestTs，修复后传 args.since 增量对比新日志），直到控制台无错误、核心交互可用为止；
   - 预览窗口是用户的真实环境：不要故意输入垃圾数据、不要触发破坏性操作（删除全部数据之类）。
4. 调试通过后，再补两份项目文档（内容基于你实际写的代码，不要写空话）：
   - AGENTS.md —— 给 AI 代理的开发规范：这个项目继续开发时需要遵守的约定（围绕你实际用到的技术栈与结构，规则具体、可执行）
   - CONTEXT.md —— 项目说明：后续开发 AI 接手时需要了解的项目事实（架构、数据、流程，以实际代码为准）
5. 全部完成后，用一段简短的话告诉用户应用已在预览窗口运行、功能与用法，以及调试验证过的结论。

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

### 视觉与组件
- 配色只用 Material Design 3 语义色 CSS 变量：var(--md-sys-color-primary)、surface、on-surface、surface-variant、primary-container、error-container 等，不得写死十六进制色。
- 需要弹窗/提示时可用 senti-ui 的 st-dialog / toast（先 \`<l-m src="/gh/ofajs/senti-ui@latest/packages/dialog/st-dialog.html"></l-m>\` 声明）。

### 数据持久化（如应用需要保存数据）
- 统一用 /nos/storage/main.js，禁止 localStorage：
\`\`\`js
// 页面模块顶层禁止 import /nos/*，必须运行时加载：
const load = lm(import.meta);
const { getStorage } = await load("/nos/storage/main.js");
const store = getStorage("<app-独立空间>");
await store.setItem("key", value);
\`\`\`

## 硬性约束
- 只写 UTF-8 文本文件（html/js/css/json/md/txt/svg 等），绝不生成图片/字体等二进制资源；需要图标用 emoji。
- 单个文件尽量小于 300 行，功能聚焦，一次对话先交付可运行的最小版本。
- 修改已有应用：先用 read_file / list_files 查看，再 write_file 覆盖对应文件；改完重新用 preview 工具（action=app）验证无回归（增量更新很快）再收尾；改动后同步更新 AGENTS.md / CONTEXT.md 里受影响的描述。
- **写 ofa.js 模板 / 用到底部「可用知识库」清单内的技术前禁止凭记忆编写**：先调用 read_skill 读对应知识库校对语法与 API（至少每次会话首次编写前读一次；拿不准的语法查 references）。
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
 * 按当前上下文构建系统提示词：在基础规范上注入「正在开发哪个应用」，
 * 并强制回答项目相关问题前先读文件（防模型凭空猜测项目内容）。
 * @param {{ appName?: string, displayName?: string, mode?: "vfs"|"local", skills?: Array<{id:string,name:string,description:string}> }} [ctx]
 *        appName 为空表示「新应用」草稿阶段；skills 为可用技能知识库清单
 */
export function buildSystemPrompt(ctx = {}) {
  let prompt = SYSTEM_PROMPT;
  if (ctx.appName) {
    const where =
      ctx.mode === "local"
        ? `用户本地磁盘所选目录的 client/ 子目录（路径相对 client/，多级路径会自动建目录）`
        : `虚拟文件系统 /$${NAMESPACE}/${ctx.appName}/client/`;
    prompt += `

## 当前上下文（重要）
用户正在开发一个**已存在的应用**「${ctx.displayName || ctx.appName}」（应用名 ${ctx.appName}，文件在 ${where}）。
- 回答任何关于这个项目的问题（它是什么、有什么功能、有哪些文件、某段代码怎么写的）之前，**必须先调用 list_files 查看文件清单，再调用 read_file 读取相关文件（至少读 AGENTS.md、CONTEXT.md 和 app.json）**，只依据真实文件内容回答；禁止凭猜测或通用模板描述项目。
- 用户要求修改时同样先读后写（read_file → write_file 覆盖），且**必须先读项目内的 AGENTS.md 与 CONTEXT.md，修改代码严格遵守其中约定**；改动完成后用 preview 工具实际运行验证无回归（action=app 推送刷新，console / dom / click 检查），再同步更新 CONTEXT.md（及 AGENTS.md 中失实的规则）。
- 不要再调用 create_app 重建同名应用，除非用户明确要求推倒重来。`;
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
  return prompt;
}
