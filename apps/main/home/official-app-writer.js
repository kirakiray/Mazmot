// 官方应用市场 - 应用加载与安装
// 官方应用位于同目录下的 `official-apps/<id>/`，通过各应用下的 `__app.json`
// 描述应用元数据（name/icon/desc）与文件清单。
// 安装时根据 __app.json 中的 replacements 清单替换变量（如 CREATED_AT），
// 然后写入虚拟目录的 client/ 子目录。

const OFFICIAL_APPS_ROOT = new URL("./official-apps/", import.meta.url);

/**
 * 加载官方应用列表。
 * manifest.json 只存放应用 id 列表，每个应用的 name/icon/desc
 * 从对应目录下的 __app.json 读取。
 * @returns {Promise<Array<{ id: string, name: string, icon?: string, desc?: string }>>}
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
    const appRoot = new URL(`${id}/`, OFFICIAL_APPS_ROOT);
    try {
      const metaRes = await fetch(new URL("__app.json", appRoot));
      if (!metaRes.ok) {
        console.warn(`官方应用 ${id} 缺少 __app.json`);
        continue;
      }
      const meta = await metaRes.json();
      apps.push({
        id,
        name: meta.name || id,
        icon: meta.icon || "📦",
        desc: meta.desc || "",
      });
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

  return {
    name: meta.name || appId,
    desc: meta.desc || "",
    icon: meta.icon || "📦",
    files,
  };
}
