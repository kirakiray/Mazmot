// 应用运行辅助模块
// 容器模式已废弃：应用直接在主域通过 NoneOS 挂载路径运行。

import { mount } from "/nos/fs/main.js";

const CLIENT_DIR = "client";
const ENTRY_FILE = "index.html";

/**
 * 读取目录中的所有文件（递归扁平化，优先读取 client/ 子目录）
 * @param {Object} handle - 目录句柄（noneos-core DirHandle）
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function readAppFiles(handle) {
  if (!handle) return [];

  // 尝试获取 client 目录句柄，如果不存在则回退到根目录
  let targetHandle = handle;
  try {
    const clientDir = await handle.get(CLIENT_DIR);
    if (clientDir && clientDir.kind === "dir") {
      targetHandle = clientDir;
    }
  } catch (err) {
    console.warn("未发现 client 目录，将从根目录读取文件");
  }

  const allFiles = await targetHandle.flat();
  const rootPrefix = targetHandle.path ? targetHandle.path + "/" : "";
  const files = await Promise.all(
    allFiles.map(async (f) => {
      let p = f.path;
      if (rootPrefix && p.startsWith(rootPrefix)) {
        p = p.slice(rootPrefix.length);
      }
      return { path: p, content: await f.text() };
    }),
  );
  return files;
}

/**
 * 获取应用的运行 URL。
 * - 虚拟目录应用：直接通过 /$mazmot-apps/{name}/client/index.html 访问
 * - 本地目录应用：把 client/ 子目录 mount() 到主域，返回 /{mounted.path}/index.html
 * @param {Object} app - 应用记录（来自 ever-cache 或安装流程）
 * @param {Object} [app._handle] - 本地目录的 noneos DirHandle
 * @param {string} [app.source] - "local" | "virtual"
 * @param {string} [app.namespace] - 虚拟目录命名空间
 * @param {string} [app.name] - 应用唯一名称（recordName）
 * @returns {Promise<string>}
 */
export async function getRunUrl(app) {
  if (!app) {
    throw new Error("缺少应用信息");
  }

  if (app.source === "virtual" && app.namespace) {
    return `/$${app.namespace}/${app.name}/${CLIENT_DIR}/${ENTRY_FILE}`;
  }

  // 本地目录：mount client 子目录
  const handle = app._handle;
  if (!handle) {
    throw new Error("本地应用缺少目录句柄");
  }

  let clientHandle;
  try {
    clientHandle = await handle.get(CLIENT_DIR);
    if (!clientHandle || clientHandle.kind !== "dir") {
      throw new Error("client 目录不存在");
    }
  } catch (err) {
    // 兼容没有 client 子目录的旧数据：直接挂载根目录
    clientHandle = handle;
  }

  const mounted = await mount(clientHandle);
  return `/${mounted.path}/${ENTRY_FILE}`;
}
