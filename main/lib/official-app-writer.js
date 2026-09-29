// 官方应用市场 - 应用加载与安装
// 官方应用位于仓库根目录下的 `official-apps/<id>/`，通过各应用下的 `__app.json`
// 描述应用元数据（name/icon/desc）与文件清单。
// name/desc 基准值为英文，可选 i18n 字段按语言覆盖：
//   "i18n": { "cn": { "name": "...", "desc": "..." } }
// 展示时按当前语言解析，回退链：目标语言 → 基准英文。
// 安装时根据 __app.json 中的 replacements 清单替换变量（如 CREATED_AT），
// 然后写入虚拟目录的 client/ 子目录。

// getLang 按需懒加载，且直连在线 Core（core.noneos.com）而非 "/nos/" 前缀：
// 本模块被 run-app 在 Core SW 注册前使用（官方应用安装链路），此时 /nos/ 不可用。
let _getLangPromise = null;
const getLang = () => {
  if (!_getLangPromise) {
    _getLangPromise = import(
      "https://core.noneos.com/nos/locale-text/get-locale-text.js"
    )
      .then((m) => m.getLang())
      .catch(() => "cn"); // 拉取失败回退中文基准
  }
  return _getLangPromise;
};

const OFFICIAL_APPS_ROOT = new URL("/official-apps/", location.origin);

/**
 * 按当前语言解析 __app.json 的 name/desc。
 * 回退链：i18n[当前语言] → 基准英文（meta.name / meta.desc）。
 * @param {Object} meta __app.json 解析结果
 * @returns {Promise<{ name: string, desc: string }>}
 */
async function resolveLocalizedMeta(meta) {
  const langMap = (meta && meta.i18n) || {};
  const langEntry = langMap[(await getLang())] || {};
  return {
    name: langEntry.name || meta.name || "",
    desc: langEntry.desc || meta.desc || "",
  };
}

/**
 * 读取单个官方应用的元数据（含版本号）。
 * name/icon/desc 来自 __app.json（name/desc 已按当前语言解析），version 来自应用自身的 app.json。
 * @param {string} id 官方应用 ID
 * @returns {Promise<{ id: string, name: string, icon: string, desc: string, version: string } | null>}
 */
export async function loadOfficialAppMeta(id) {
  const appRoot = new URL(`${id}/`, OFFICIAL_APPS_ROOT);
  const metaRes = await fetch(new URL("__app.json", appRoot));
  if (!metaRes.ok) {
    return null;
  }
  const meta = await metaRes.json();

  // 版本号来源于应用自身的 app.json
  let version = "";
  try {
    const appJsonRes = await fetch(new URL("app.json", appRoot));
    if (appJsonRes.ok) {
      const appJson = await appJsonRes.json();
      version = appJson.version || "";
    }
  } catch (err) {
    console.warn(`读取官方应用 ${id} 版本号失败：`, err);
  }

  const { name, desc } = await resolveLocalizedMeta(meta);
  return {
    id,
    name: name || id,
    icon: meta.icon || "📦",
    desc,
    version,
  };
}

/**
 * 比较两个版本号（形如 1.2.3），a > b 返回 1，a < b 返回 -1，相等返回 0。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = String(a || "").split(".");
  const pb = String(b || "").split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i], 10) || 0;
    const nb = parseInt(pb[i], 10) || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * 加载官方应用列表。
 * manifest.json 只存放应用 id 列表，每个应用的 name/icon/desc
 * 从对应目录下的 __app.json 读取，version 从应用自身的 app.json 读取。
 * @returns {Promise<Array<{ id: string, name: string, icon?: string, desc?: string, version: string }>>}
 */
export async function loadOfficialApps() {
  const url = new URL("manifest.json", OFFICIAL_APPS_ROOT);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`加载官方应用清单失败：${res.status}`);
  }
  const data = await res.json();
  const ids = Array.isArray(data.apps) ? data.apps : [];

  const apps = [];
  for (const id of ids) {
    try {
      const meta = await loadOfficialAppMeta(id);
      if (!meta) {
        console.warn(`官方应用 ${id} 缺少 __app.json`);
        continue;
      }
      apps.push(meta);
    } catch (err) {
      console.warn(`加载官方应用 ${id} 元数据失败：`, err);
    }
  }
  return apps;
}

function applyReplacements(content, replacements, ctx) {
  for (const { from, to } of replacements) {
    let value;
    if (to === "CREATED_AT") {
      value = String(ctx.createdAt);
    } else {
      value = to;
    }
    content = content.split(from).join(value);
  }
  return content;
}

/**
 * 将官方应用写入目标目录（虚拟目录），通过回调上报进度。
 * @param {Object} options
 * @param {Object} options.dirHandle 目标目录句柄（noneos-core DirHandle）
 * @param {string} options.appId 官方应用 ID
 * @param {(payload: { index: number, total: number, path: string, status: 'writing'|'done', progress: number }) => void} [options.onProgress]
 * @param {number} [options.stepDelay=120] 每个文件之间的等待时长（用于 UI 平滑，单位 ms）
 * @returns {Promise<{ name: string, desc: string, files: Array<{ path: string, content: string }> }>}
 */
export async function installOfficialApp({
  dirHandle,
  appId,
  onProgress,
  stepDelay = 120,
}) {
  if (!dirHandle) {
    throw new Error("缺少目标目录句柄");
  }

  const appRoot = new URL(`${appId}/`, OFFICIAL_APPS_ROOT);
  const metaRes = await fetch(new URL("__app.json", appRoot));
  if (!metaRes.ok) {
    throw new Error(`加载官方应用 ${appId} 失败：${metaRes.status}`);
  }
  const meta = await metaRes.json();
  const fileEntries = Array.isArray(meta.files) ? meta.files : [];

  const ctx = {
    createdAt: Date.now(),
  };

  // 读取并处理所有文件
  const files = [];
  for (const entry of fileEntries) {
    const relPath = typeof entry === "string" ? entry : entry.path;
    const replacements =
      typeof entry === "object" && Array.isArray(entry.replacements)
        ? entry.replacements
        : [];

    const res = await fetch(new URL(relPath, appRoot));
    if (!res.ok) {
      throw new Error(`读取应用文件 ${relPath} 失败：${res.status}`);
    }
    const raw = await res.text();
    files.push({
      path: relPath,
      content: applyReplacements(raw, replacements, ctx),
    });
  }

  const total = files.length;

  // 写入 client 目录
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

  const { name, desc } = await resolveLocalizedMeta(meta);
  return {
    name: name || appId,
    desc,
    icon: meta.icon || "📦",
    files,
  };
}
