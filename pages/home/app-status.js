// Mazmot 应用存活状态管理（主页面侧）
// 负责与子应用之间的 BroadcastChannel 通信，以及使用 localStorage
// 持久化"已打开"应用路径集合，用于跨主页面刷新恢复 UI 状态。

const BROADCAST_NAME = "mazmot-app-status";
const LS_OPENED_KEY = "mazmot-opened-apps";

// 记录当前页面打开的应用窗口引用：key = app.path
export const openedWindows = new Map();
// 通过 BroadcastChannel 探测到的存活应用路径集合
export const openedNames = new Set();

let broadcastChannel = null;
export function getBroadcast() {
  if (broadcastChannel) return broadcastChannel;
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_NAME);
  } catch (err) {
    console.warn("当前浏览器不支持 BroadcastChannel", err);
    broadcastChannel = null;
  }
  return broadcastChannel;
}

// ---- localStorage 持久化 ----
export function readOpenedFromLS() {
  try {
    const raw = localStorage.getItem(LS_OPENED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

export function writeOpenedToLS(paths) {
  try {
    localStorage.setItem(LS_OPENED_KEY, JSON.stringify(paths));
  } catch (err) {}
}

export function addOpenedPath(path) {
  const list = readOpenedFromLS();
  if (!list.includes(path)) {
    list.push(path);
    writeOpenedToLS(list);
  }
}

export function removeOpenedPath(path) {
  const list = readOpenedFromLS().filter((p) => p !== path);
  writeOpenedToLS(list);
}

// ---- 状态查询 ----
export function isWindowAlive(path) {
  // 优先看本页面维护的窗口引用
  const win = openedWindows.get(path);
  if (win) {
    try {
      if (!win.closed) return true;
      openedWindows.delete(path);
    } catch (err) {
      // 跨源窗口，无法判断，交给 openedNames 兜底
    }
  }
  // 若通过 BroadcastChannel 收到过应答，则认为仍存活
  return openedNames.has(path);
}

/**
 * 启动广播监听与定时探测
 * @param {Object} handlers
 * @param {(path: string) => void} handlers.onAlive 收到 alive/pong 时的处理
 * @param {(path: string) => void} handlers.onBye 收到 bye 时的处理
 * @param {(alivePaths: Set<string>) => void} handlers.onTick 每次探测后回调（用于同步 UI）
 * @param {number} [handlers.interval=2000] 探测间隔（ms）
 * @param {number} [handlers.waitAnswer=500] 每次 ping 后等待应答的时间（ms）
 * @returns {() => void} 停止函数
 */
export function startAppStatusWatcher({
  onAlive,
  onBye,
  onTick,
  interval = 2000,
  waitAnswer = 500,
} = {}) {
  const bc = getBroadcast();

  const handler = (event) => {
    const msg = event && event.data;
    if (!msg || !msg.type || !msg.path) return;
    if (msg.type === "alive" || msg.type === "pong") {
      openedNames.add(msg.path);
      addOpenedPath(msg.path);
      onAlive?.(msg.path);
    } else if (msg.type === "bye") {
      openedNames.delete(msg.path);
      removeOpenedPath(msg.path);
      onBye?.(msg.path);
    }
  };

  if (bc) {
    bc.addEventListener("message", handler);
    // 初次探测：清空后广播 ping
    openedNames.clear();
    try {
      bc.postMessage({ type: "ping" });
    } catch (e) {}
  }

  const timer = setInterval(() => {
    // 每次探测前清空快照，收到 pong/alive 会重新填入
    openedNames.clear();
    try {
      if (bc) bc.postMessage({ type: "ping" });
    } catch (e) {}

    // 给子应用一小段时间应答，然后同步 UI 状态 + LS
    setTimeout(() => {
      const alivePaths = new Set(openedNames);
      openedWindows.forEach((win, path) => {
        try {
          if (!win.closed) alivePaths.add(path);
        } catch (err) {}
      });
      writeOpenedToLS(Array.from(alivePaths));
      onTick?.(alivePaths);
    }, waitAnswer);

    // 顺带清理已关闭的窗口引用
    openedWindows.forEach((win, path) => {
      try {
        if (win.closed) openedWindows.delete(path);
      } catch (err) {}
    });
  }, interval);

  return function stop() {
    clearInterval(timer);
    if (bc) bc.removeEventListener("message", handler);
  };
}

/**
 * 标记一个应用为已打开：写入窗口引用、写入 LS。
 */
export function markOpened(path, win) {
  if (win) openedWindows.set(path, win);
  addOpenedPath(path);
}

/**
 * 清理一个应用的打开状态（用于删除等场景）
 */
export function clearOpened(path) {
  const win = openedWindows.get(path);
  if (win) {
    try {
      if (!win.closed) win.close();
    } catch (e) {}
    openedWindows.delete(path);
  }
  openedNames.delete(path);
  removeOpenedPath(path);
}

/**
 * 尝试聚焦已打开的窗口，若成功返回 true
 */
export function focusIfOpened(path) {
  const win = openedWindows.get(path);
  if (win) {
    try {
      if (!win.closed) {
        win.focus();
        return true;
      }
      openedWindows.delete(path);
    } catch (err) {
      openedWindows.delete(path);
    }
  }
  return false;
}
