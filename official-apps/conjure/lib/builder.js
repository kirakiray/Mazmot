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
 * @param {{ name: string, desc?: string, icon?: string, displayName?: string, handle: Object }} meta
 * @returns {Object}
 */
export function buildLocalAppRecord(meta) {
  const name = sanitizeAppName(meta.name);
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
 * @param {{ name: string, desc?: string, icon?: string, displayName?: string }} meta
 * @returns {Object}
 */
export function buildAppRecord(meta) {
  const name = sanitizeAppName(meta.name);
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
// - 本地目录渠道（rootHandle = fs.open() 选定的目录）：该目录即项目根，
//   文件直接写在根上，不建 <name>/client/ 子目录（预览走 getRunUrl 的本地回退：挂载根目录）
// - 虚拟系统渠道：ai-apps/<name>/client/
const resolveBaseDir = async (fs, appName, rootHandle) => {
  if (rootHandle) return { base: rootHandle, rel: "" };
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
  const out = [];
  const walk = async (dir) => {
    if (typeof dir.flat === "function") {
      for (const f of await dir.flat()) {
        out.push(prefix && f.path.startsWith(prefix)
          ? f.path.slice(prefix.length)
          : f.path);
      }
      return;
    }
    for await (const key of dir.keys()) {
      const item = await dir.get(key);
      if (!item) continue;
      if (item.kind === "dir") await walk(item);
      else
        out.push(prefix && item.path.startsWith(prefix)
          ? item.path.slice(prefix.length)
          : item.path);
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

/**
 * 系统提示词：教模型 Mazmot/ofa.js 应用结构与平台约束。
 */
export const SYSTEM_PROMPT = `你是 Mazmot 虚拟系统里的 妙造，通过对话为用户生成可直接运行的 ofa.js 网页应用，并把文件写入虚拟文件系统。

## 工作流程
1. 理解用户需求，必要时先简短澄清；然后调用 create_app（name 用小写英文短横线，如 todo-app；displayName 可用中文）。
2. 依次用 write_file 写入下列文件（路径相对项目根目录）：
   - index.html —— 入口 HTML
   - app-config.js —— 导出 home 等页面路由
   - pages/home.html —— 首页页面模块
3. 功能文件完成后，再补两份项目文档（内容基于你实际写的代码，不要写空话）：
   - AGENTS.md —— 给 AI 代理的开发规范：技术栈（ofa.js + senti-ui + /nos/storage）、硬性规则（改模板前先读 ofa.js 文档、页面模块禁止顶层 import /nos/*、禁止 localStorage、M3 颜色变量）、修改代码后须同步更新 CONTEXT.md
   - CONTEXT.md —— 项目说明：功能概述、目录结构、数据模型（存储空间与键）、关键文件职责、页面要点
4. 全部文件写完后，用一段简短的话告诉用户可以点「预览」了，并说明应用功能与用法。

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
- 修改已有应用：先用 read_file / list_files 查看，再 write_file 覆盖对应文件；改动后同步更新 AGENTS.md / CONTEXT.md 里受影响的描述。
- **写 ofa.js 模板 / 用到底部「可用知识库」清单内的技术前禁止凭记忆编写**：先调用 read_skill 读对应知识库校对语法与 API（至少每次会话首次编写前读一次；拿不准的语法查 references）。
- 回复用户时使用中文，简洁说明写了哪些文件、如何使用。`;

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
        ? `用户本地磁盘的项目根目录（用户选定的目录即项目根，文件直接在其中，没有子目录嵌套）`
        : `虚拟文件系统 /$${NAMESPACE}/${ctx.appName}/client/`;
    prompt += `

## 当前上下文（重要）
用户正在开发一个**已存在的应用**「${ctx.displayName || ctx.appName}」（应用名 ${ctx.appName}，文件在 ${where}）。
- 回答任何关于这个项目的问题（它是什么、有什么功能、有哪些文件、某段代码怎么写的）之前，**必须先调用 list_files 查看文件清单，再调用 read_file 读取相关文件（至少读 app.json 和 pages/home.html）**，只依据真实文件内容回答；禁止凭猜测或通用模板描述项目。
- 用户要求修改时同样先读后写（read_file → write_file 覆盖）。
- 不要再调用 create_app 重建同名应用，除非用户明确要求推倒重来。`;
  }
  if (Array.isArray(ctx.skills) && ctx.skills.length) {
    const lines = ctx.skills
      .map((s) => `- ${s.id}（${s.name}）：${s.description}`)
      .join("\n");
    prompt += `

## 可用知识库（read_skill 工具）
${lines}

用法：read_skill(skill, path?)，默认读该技能的 SKILL.md，再按文中引用的 references/xxx.md 精读。`;
  }
  return prompt;
}
