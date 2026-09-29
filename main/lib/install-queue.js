// 欢迎引导 - 选定官方应用的后台安装队列
// - enqueueOfficialInstalls(ids)：合并去重写入待装清单（mazmot 空间
//   pending-official-installs 键，跨刷新可恢复）后启动串行安装；
//   已安装（apps 记录同名或同 officialId）的 id 自动跳过
// - 安装状态暴露在 installQueue.items（stanz 数组，列表页直接渲染为
//   「安装中」虚拟条目）：{ officialId, name, icon, desc, progress, state, statusText }
// - 单项成功：写入 apps 记录（与市场安装一致，official 不带 appId）
//   → 移出待装清单 → 移出 items → 通知 onInstallSettled（列表页刷新）
// - 单项失败：item.state = "error"，待装清单保留，下次进入列表页自动重试；
//   retryInstall(id) 供列表页手动重试
// - /nos/* 一律函数内动态 import：本模块可能被早于 Core 就绪的调用方引用

const NAMESPACE = "mazmot-apps";
const PENDING_KEY = "pending-official-installs";

export const installQueue = $.stanz({
  items: [],
});

const _settledListeners = new Set();

/**
 * 订阅安装结算事件（单项成功或失败后触发）。
 * @param {() => void} callback
 * @returns {() => void} 取消订阅
 */
export function onInstallSettled(callback) {
  _settledListeners.add(callback);
  return () => _settledListeners.delete(callback);
}

function _notifySettled() {
  _settledListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("install-queue settled listener error:", e);
    }
  });
}

let _deps = null;
async function _loadDeps() {
  if (_deps) return _deps;
  const [{ init }, { getStorage }, { getLocaleText }, writer] =
    await Promise.all([
      import("/nos/fs/main.js"),
      import("/nos/storage/main.js"),
      import("/nos/locale-text/get-locale-text.js"),
      import("./official-app-writer.js"),
    ]);
  _deps = {
    init,
    storage: getStorage("mazmot"),
    getLocaleText,
    ...writer,
  };
  return _deps;
}

async function _readPending() {
  const { storage } = await _loadDeps();
  const list = await storage.getItem(PENDING_KEY);
  return Array.isArray(list)
    ? list.filter((id) => typeof id === "string" && id)
    : [];
}

/**
 * 把引导选定的官方应用加入待装清单并启动安装（幂等，可传空数组仅恢复队列）。
 * @param {string[]} ids 官方应用 id 列表
 */
export async function enqueueOfficialInstalls(ids = []) {
  const { storage } = await _loadDeps();
  const apps = (await storage.getItem("apps")) || [];
  const pending = await _readPending();
  let dirty = false;
  for (const id of ids) {
    const installed = apps.some(
      (a) => a.name === id || a.officialId === id,
    );
    if (installed || pending.includes(id)) continue;
    pending.push(id);
    dirty = true;
  }
  if (dirty) {
    await storage.setItem(PENDING_KEY, pending);
  }
  _drain();
}

/**
 * 手动重试某个失败的官方应用安装。
 * @param {string} officialId
 */
export async function retryInstall(officialId) {
  const { storage } = await _loadDeps();
  const pending = await _readPending();
  if (!pending.includes(officialId)) {
    pending.push(officialId);
    await storage.setItem(PENDING_KEY, pending);
  }
  const item = installQueue.items.find((i) => i.officialId === officialId);
  if (item) {
    item.state = "installing";
    item.statusText = "";
  }
  _drain();
}

let _draining = false;

async function _drain() {
  if (_draining) return;
  _draining = true;
  try {
    const deps = await _loadDeps();
    let pending = await _readPending();
    while (pending.length > 0) {
      const id = pending[0];
      try {
        await _installOne(deps, id);
      } catch (err) {
        console.error(`官方应用 ${id} 安装失败：`, err);
        _markError(deps, id, err);
        break; // 失败即停，保留待装清单等待下次进入列表页 / 手动重试
      }
      pending = await _readPending();
    }
  } finally {
    _draining = false;
  }
}

async function _installOne(deps, id) {
  const { storage, init, installOfficialApp, loadOfficialAppMeta } = deps;

  // 先补一个虚拟条目（列表页立即出现「安装中」项），再取包装后的 stanz
  // 引用做后续更新，保证进度变化能触发视图刷新
  let item = installQueue.items.find((i) => i.officialId === id);
  if (!item) {
    const meta = await loadOfficialAppMeta(id).catch(() => null);
    installQueue.items.push({
      officialId: id,
      name: (meta && meta.name) || id,
      icon: (meta && meta.icon) || "📦",
      desc: (meta && meta.desc) || "",
      progress: 0,
      state: "installing",
      statusText: "",
    });
    item = installQueue.items.find((i) => i.officialId === id);
  }

  item.state = "installing";
  item.progress = 0;
  item.statusText = deps.getLocaleText({
    cn: "准备安装...",
    en: "Preparing to install...",
  });

  const rootDir = await init(NAMESPACE);
  const vHandle = await rootDir.get(id, { create: "dir" });

  await installOfficialApp({
    dirHandle: vHandle,
    appId: id,
    onProgress: ({ progress, path, status }) => {
      item.progress = progress || 0;
      item.statusText = deps.getLocaleText(
        status === "writing"
          ? { cn: "正在写入 {path} ...", en: "Writing {path} ..." }
          : { cn: "已写入 {path}", en: "Written {path}" },
        { path },
      );
    },
  });

  // 登记 apps 记录（与市场安装一致：官方应用不带 appId，以 officialId 标识来源）
  const apps = (await storage.getItem("apps")) || [];
  if (!apps.some((a) => a.name === id)) {
    apps.push({
      name: id,
      desc: item.desc,
      handle: null,
      dirName: `${NAMESPACE}/${id}`,
      source: "official",
      namespace: NAMESPACE,
      officialId: id,
      createdAt: Date.now(),
    });
    await storage.setItem("apps", apps);
  }

  // 移出待装清单与虚拟条目，通知列表页刷新
  const pending = await _readPending();
  await storage.setItem(
    PENDING_KEY,
    pending.filter((x) => x !== id),
  );
  // 原地 splice（而非整体重赋值）：列表页持有 items 的同一引用，
  // 重赋值会让外部引用与队列脱节
  const doneIdx = installQueue.items.findIndex((i) => i.officialId === id);
  if (doneIdx > -1) {
    installQueue.items.splice(doneIdx, 1);
  }
  _notifySettled();
}

async function _markError(deps, id, err) {
  const { getLocaleText } = deps;
  const item = installQueue.items.find((i) => i.officialId === id);
  if (item) {
    item.state = "error";
    item.statusText = getLocaleText(
      { cn: "安装失败：{msg}", en: "Install failed: {msg}" },
      { msg: (err && err.message) || String(err) },
    );
  }
  _notifySettled();
}
