// bridge 接收端核心逻辑：把 conjure 推送的应用文件写入本域 VFS
//
// 从 bridge.html 页面模块中抽出，便于单元 / 集成测试（bridge/test/preview-flow.sb.html
// 在单页内用两个真实 LocalUser 跑通全链路）。页面只负责 UI 与跳转。

import {
  BRIDGE_NAMESPACE,
  sanitizeAppName,
  validateRelPath,
  createFileAssembler,
} from "./proto.js";

/**
 * 创建接收器。
 * @param {Object} opts
 * @param {Function} opts.init fs.init（注入以便测试；缺省用 /nos/fs/main.js 的 init）
 * @param {(appName: string) => void} [opts.onProgress] 进度回调 (fileCount)
 * @returns {{ handle: (payload: Object) => Promise<{ appName: string, url: string } | null> }}
 *          handle 处理一条业务消息；app-end 收齐时返回 { appName, url }，其余返回 null
 */
export function createPreviewReceiver({ init, onProgress = () => {} } = {}) {
  let clientDir = null; // 当前应用的 client/ 目录句柄
  let assembler = null;
  let fileTotal = 0;
  let fileDone = 0;

  const process = async (payload) => {
    if (!payload || typeof payload !== "object") return null;
    if (payload.type === "app-begin") {
      const name = sanitizeAppName(payload.appName);
      if (!name) throw new Error("应用名不合法");
      const initFn =
        init ||
        (await import("/nos/fs/main.js")).init;
      const rootDir = await initFn(BRIDGE_NAMESPACE);
      // 覆盖语义：清掉旧版本再重建（remove 为递归删除）
      const old = await rootDir.get(name);
      if (old && old.kind === "dir") await old.remove();
      const appDir = await rootDir.get(name, { create: "dir" });
      clientDir = await appDir.get("client", { create: "dir" });
      assembler = createFileAssembler();
      fileTotal = Math.max(1, payload.fileCount || 1);
      fileDone = 0;
      onProgress(fileTotal);
      return null;
    }
    if (payload.type === "file") {
      if (!assembler || !clientDir) return null; // app-begin 未就绪，忽略
      const done = assembler.push(payload);
      if (!done) return null;
      const check = validateRelPath(done.path);
      if (!check.ok) throw new Error(`${done.path}：${check.reason}`);
      const file = await clientDir.get(done.path, { create: "file" });
      await file.write(done.text);
      fileDone++;
      onProgress(fileTotal, fileDone, done.path);
      return null;
    }
    if (payload.type === "app-end") {
      const name = sanitizeAppName(payload.appName);
      if (!name) throw new Error("应用名不合法");
      return {
        appName: name,
        url: `/$${BRIDGE_NAMESPACE}/${name}/client/index.html`,
      };
    }
    return null;
  };

  // 消息处理串行化：app-begin 的目录准备是异步的，必须等它完成才能处理
  // 后续 file 消息（否则 clientDir 尚未就绪，文件会被静默丢弃）
  let chain = Promise.resolve();
  const handle = (payload) => {
    const next = chain.then(() => process(payload));
    chain = next.catch(() => {});
    return next;
  };

  return { handle };
}

/**
 * 等待虚拟挂载 URL 可访问（SW 已接管）。首次安装 Core 后 SW 激活存在窗口期，
 * 立即跳转 /$namespace/... 会漏到静态服务器返回 404，跳转前先轮询确认。
 * @param {string} url
 * @param {number} [timeout=15000]
 * @returns {Promise<boolean>} URL 是否已就绪
 */
export async function waitUrlReady(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return true;
    } catch (_) {
      /* SW 未接管时 fetch 走网络，继续等 */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
