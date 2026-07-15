// ofa.js 应用模板加载与写入
// 模板文件位于同目录下的 `templates/<id>/`，通过各模板下的 `__files.json`
// 描述文件清单。模板源文件使用符合自身文件格式的正常字符串作为默认值，
// 可直接通过静态服务器运行调试；写入时根据 `__files.json` 中的 replacements
// 清单，把指定字符串替换为实际的应用信息。
//
// __files.json 中 replacements 的 `to` 支持以下模板变量：
//   APP_NAME       - 应用名（原样）
//   APP_NAMESPACE  - 应用命名空间（原样，通常同 APP_NAME）
//   APP_DESC       - 应用描述（原样）
//   APP_DESC_HTML  - 应用描述（HTML 转义）
//   APP_DESC_JSON  - 应用描述（不带外层引号的 JSON 字符串片段，可安全嵌入 "..." 中）
//   CREATED_AT     - 创建时间（毫秒时间戳）

const TEMPLATES_ROOT = new URL("./templates/", import.meta.url);

/**
 * 加载模板列表清单。
 * @returns {Promise<Array<{ id: string, name: string, desc?: string }>>}
 */
export async function loadTemplates() {
  const url = new URL("manifest.json", TEMPLATES_ROOT);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`加载模板清单失败：${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data.templates) ? data.templates : [];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toJsonFragment(str) {
  // JSON.stringify 会返回带外层引号的字符串，切掉外层引号得到可直接嵌入
  // "..." 中的转义片段。
  const s = JSON.stringify(String(str));
  return s.slice(1, -1);
}

function resolveVar(name, ctx) {
  switch (name) {
    case "APP_NAME":
      return ctx.name;
    case "APP_NAMESPACE":
      return ctx.name;
    case "APP_DESC":
      return ctx.desc;
    case "APP_DESC_HTML":
      return escapeHtml(ctx.desc);
    case "APP_DESC_JSON":
      return toJsonFragment(ctx.desc);
    case "CREATED_AT":
      return String(ctx.createdAt);
    default:
      throw new Error(`未知的模板变量：${name}`);
  }
}

function applyReplacements(content, replacements, ctx) {
  for (const { from, to } of replacements) {
    const value = resolveVar(to, ctx);
    content = content.split(from).join(value);
  }
  return content;
}

/**
 * 根据模板 ID 与应用信息生成待写入的文件列表。
 * @param {Object} options
 * @param {string} options.name 应用名
 * @param {string} [options.desc] 应用描述
 * @param {string} [options.templateId="base"] 模板 ID
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function buildTemplateFiles({ name, desc, templateId = "base" }) {
  const templateRoot = new URL(`${templateId}/`, TEMPLATES_ROOT);
  const filesRes = await fetch(new URL("__files.json", templateRoot));
  if (!filesRes.ok) {
    throw new Error(`加载模板 ${templateId} 失败：${filesRes.status}`);
  }
  const filesJson = await filesRes.json();
  const fileEntries = Array.isArray(filesJson.files) ? filesJson.files : [];

  const ctx = {
    name: String(name || ""),
    desc: String(desc || "Welcome to your new ofa.js application."),
    createdAt: Date.now(),
  };

  const files = [];
  for (const entry of fileEntries) {
    const relPath = typeof entry === "string" ? entry : entry.path;
    const replacements =
      typeof entry === "object" && Array.isArray(entry.replacements)
        ? entry.replacements
        : [];

    const res = await fetch(new URL(relPath, templateRoot));
    if (!res.ok) {
      throw new Error(`读取模板文件 ${relPath} 失败：${res.status}`);
    }
    const raw = await res.text();
    files.push({
      path: relPath,
      content: applyReplacements(raw, replacements, ctx),
    });
  }
  return files;
}

/**
 * 将模板文件写入目标目录，通过回调上报进度。
 * @param {Object} options
 * @param {Object} options.dirHandle 目标目录句柄（noneos-core DirHandle）
 * @param {string} options.name 应用名称
 * @param {string} [options.desc] 应用描述
 * @param {string} [options.templateId="base"] 模板 ID
 * @param {(payload: { index: number, total: number, path: string, status: 'writing'|'done', progress: number }) => void} [options.onProgress]
 * @param {number} [options.stepDelay=120] 每个文件之间的等待时长（用于 UI 平滑，单位 ms）
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function writeTemplateFiles({
  dirHandle,
  name,
  desc,
  templateId = "base",
  onProgress,
  stepDelay = 120,
}) {
  if (!dirHandle) {
    throw new Error("缺少目标目录句柄");
  }

  const files = await buildTemplateFiles({ name, desc, templateId });
  const total = files.length;

  // 获取或创建 client 目录，将所有静态文件写入其中
  const clientDir = await dirHandle.get("client", { create: "dir" });

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    if (onProgress) {
      onProgress({
        index: i,
        total,
        path: f.path,
        status: "writing",
        progress: Math.round((i / total) * 100),
      });
    }

    const fileHandle = await clientDir.get(f.path, { create: "file" });
    await fileHandle.write(f.content);

    if (onProgress) {
      onProgress({
        index: i,
        total,
        path: f.path,
        status: "done",
        progress: Math.round(((i + 1) / total) * 100),
      });
    }

    if (stepDelay > 0 && i < files.length - 1) {
      await new Promise((r) => setTimeout(r, stepDelay));
    }
  }

  return files;
}
