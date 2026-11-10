// Mazmot Desktop Runtime (Electron) — 主进程
//
// 与 projectR（Tauri 2）对等的桌面壳：把 Mazmot 静态站点封装成原生多窗口
// 应用运行时。核心设计同样是「内置回环 HTTP 静态服务器 + 真实 http://localhost
// 源」——Electron 默认的 file:// 或自定义协议下 Service Worker 无法注册，而
// NoneOS Core 依赖 SW。
//
//   BrowserWindow(origin = http://localhost:30031|30032)
//     ├─ 站点静态文件（index.html → NoneOS Core SW 接管 /nos/* /gh/* /$xxx/*）
//     └─ preload.js → shim.js：window.open → runtime_* IPC
//                              ▲ ipcRenderer.on("mazmot:closed")
//   主进程：静态服务器（IPv4+IPv6 双栈）/ 窗口管理 / 导航分流 / 单实例退出策略

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
} = require("electron");

const {
  StaticServer,
  MAIN_PORTS,
  BRIDGE_PORT,
} = require("./static-server");

app.setName("Mazmot");

// 调试/受限环境覆盖 userData（默认 ~/Library/Application Support/Mazmot）。
// 某些沙箱环境禁止写用户目录，Chromium 会在 app ready 前直接 SIGTRAP，
// 这种时候用 MAZMOT_USER_DATA 指到可写目录即可正常启动。
if (process.env.MAZMOT_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.MAZMOT_USER_DATA));
}

/** 回环主机名（站点 origin 判定，与 shim 保持一致） */
const INTERNAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const INTERNAL_PORT_MIN = 30031;
const INTERNAL_PORT_MAX = 30036;

/** label -> BrowserWindow（含主窗口） */
const windows = new Map();
let mainWindow = null;
let mainPort = null;
let bridgePort = null;
let windowSeq = 0;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox("Mazmot 启动失败", String(err && err.stack ? err.stack : err));
    app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });
}

/** 解析静态站点根目录：MAZMOT_WEB_ROOT > 打包 resources/site > 仓库根（dev） */
function resolveWebRoot() {
  const fromEnv = process.env.MAZMOT_WEB_ROOT;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (!fs.existsSync(path.join(resolved, "index.html"))) {
      throw new Error(`MAZMOT_WEB_ROOT 下没有 index.html：${resolved}`);
    }
    return resolved;
  }
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, "site");
    if (!fs.existsSync(path.join(packaged, "index.html"))) {
      throw new Error(`站点资源缺失：${packaged} 下没有 index.html`);
    }
    return packaged;
  }
  // __dirname = <repo>/client/projectE/src → 仓库根
  return path.resolve(__dirname, "../../..");
}

function isInternalHttpUrl(u) {
  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  return (
    u.protocol === "http:" &&
    INTERNAL_HOSTS.has(u.hostname) &&
    port >= INTERNAL_PORT_MIN &&
    port <= INTERNAL_PORT_MAX
  );
}

/** 导航分流：内部站点放行；其余 http(s) 转系统默认浏览器并拦截页内跳转 */
function handleNavigation(event, target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return;
  }
  if (u.protocol === "http:" || u.protocol === "https:") {
    if (isInternalHttpUrl(u)) return;
    event.preventDefault();
    shell.openExternal(u.href).catch((err) => {
      console.error("[mazmot-runtime] 打开外部链接失败", u.href, err);
    });
    return;
  }
  // about: / blob: / data: / javascript: 等页内协议放行；其余一律拦截
  if (
    ["about:", "blob:", "data:", "javascript:", "chrome-error:", "devtools:"].includes(
      u.protocol,
    )
  ) {
    return;
  }
  event.preventDefault();
}

function buildWindowOptions({ label, width, height, x, y, resizable, minWidth, minHeight }) {
  const options = {
    title: "Mazmot",
    width,
    height,
    minWidth,
    minHeight,
    resizable,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // 站点是壳自己伺服的可信本地内容：preload 必须与页面同 world 才能
      // 接管 window.open（对齐 Tauri initialization_script 的注入模型）。
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      additionalArguments: [`--mazmot-window-label=${label}`],
    },
  };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    options.x = Math.round(x);
    options.y = Math.round(y);
  }
  if (process.platform === "darwin") {
    // 与 projectR 的 TitleBarStyle::Overlay + hidden_title 对齐：无系统标题栏，
    // 红绿灯浮在左上，顶部由 shim 注入透明拖拽热区。
    options.titleBarStyle = "hiddenInset";
    options.trafficLightPosition = { x: 16, y: 18 };
  }
  return options;
}

function createShellWindow({ label, url, name, opener, ...geometry }) {
  const win = new BrowserWindow(
    buildWindowOptions({
      label,
      width: geometry.width || 1180,
      height: geometry.height || 820,
      x: geometry.x,
      y: geometry.y,
      resizable: geometry.resizable !== false,
      minWidth: geometry.minWidth || 420,
      minHeight: geometry.minHeight || 320,
    }),
  );

  windows.set(label, win);

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    windows.delete(label);
    const meta = { name: name || null, opener: opener || null };
    notifyOpenerClosed(meta);
    if (label === "main") {
      mainWindow = null;
      if (!isQuitting) {
        isQuitting = true;
        app.quit();
      }
    }
  });

  // 兜底：shim 未能加载时也不让 Chromium 自建未受管的窗口
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    let u;
    try {
      u = new URL(target);
    } catch {
      return { action: "deny" };
    }
    if (isInternalHttpUrl(u)) {
      console.warn("[mazmot-runtime] 未接管的 window.open，已拦截", target);
    } else if (u.protocol === "http:" || u.protocol === "https:") {
      shell.openExternal(u.href).catch(() => {});
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, target) =>
    handleNavigation(event, target),
  );
  win.webContents.on("will-redirect", (event, target) =>
    handleNavigation(event, target),
  );
  win.webContents.on("did-fail-load", (_event, code, desc, failedUrl) => {
    if (code === -3) return; // ERR_ABORTED：页面主动导航，正常
    console.error(
      `[mazmot-runtime] 加载失败 ${failedUrl}（${code} ${desc}）`,
    );
  });

  win.loadURL(url).catch((err) => {
    console.error(`[mazmot-runtime] 窗口 ${label} 加载失败`, url, err);
  });

  if (process.env.MAZMOT_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
  return win;
}

/** 原生窗口被用户直接关掉时，通知 opener 页面的 shim 把假窗口 closed 置真 */
function notifyOpenerClosed({ name, opener }) {
  if (!name || !opener) return;
  const openerWin = windows.get(opener);
  if (!openerWin || openerWin.isDestroyed()) return;
  openerWin.webContents.send("mazmot:closed", name);
}

/** 校验 IPC 调用方：只接受壳自己的回环源（等价 Tauri ACL 的远端源限制） */
function assertTrustedSender(event) {
  let frameUrl = "";
  try {
    frameUrl = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
  } catch {
    /* ignore */
  }
  // 壳自建的空白窗口（conjure 的 window.open("", name) 路径）：由 runtime_open_window
  // 以 about:blank 创建，导航目标随后仍受 parseInternalUrl 限制，放行其 IPC。
  if (frameUrl === "about:blank") return;
  let u;
  try {
    u = new URL(frameUrl);
  } catch {
    throw new Error("blocked: 无法识别的调用方");
  }
  if (!isInternalHttpUrl(u)) {
    throw new Error(`blocked: 非回环站点源 ${u.origin}`);
  }
}

function parseInternalUrl(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    throw new Error(`无效 URL：${target}`);
  }
  if (!isInternalHttpUrl(u)) {
    throw new Error(`只允许回环站点 URL：${target}`);
  }
  return u.href;
}

function sanitizeLabelPart(name) {
  return (
    String(name || "")
      .replace(/[^A-Za-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "") || "win"
  );
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampDimension(value, fallback, min, max) {
  const n = toFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const COMMANDS = {
  runtime_probe() {
    return {
      version: app.getVersion(),
      os: process.platform,
      // macOS 为 hiddenInset 自绘顶栏（shim 据此注入顶栏与内容下移）
      titlebar: process.platform === "darwin" ? "overlay" : "native",
      mainPort,
      bridgePort,
    };
  },

  runtime_log({ message }) {
    console.error(`[mazmot-runtime][web] ${message}`);
  },

  runtime_open_window(args, event) {
    const target = String(args.url || "about:blank");
    const url =
      target === "about:blank"
        ? "about:blank"
        : parseInternalUrl(target);
    const safe = sanitizeLabelPart(args.name);
    const label = `mazmot-${safe}-${windowSeq++}`;
    const opener = String(args.opener || "main");

    createShellWindow({
      label,
      url,
      name: String(args.name || ""),
      opener,
      width: clampDimension(args.width, 1180, 200, 10000),
      height: clampDimension(args.height, 820, 200, 10000),
      x: toFiniteNumber(args.x),
      y: toFiniteNumber(args.y),
      resizable: args.resizable !== false,
    });
    console.error(`[mazmot-runtime] 打开窗口 ${label}（${url} ← ${opener}）`);
    return label;
  },

  runtime_navigate_window({ label, url }) {
    const win = windows.get(String(label));
    if (!win || win.isDestroyed()) throw new Error(`窗口不存在：${label}`);
    return win.loadURL(parseInternalUrl(url));
  },

  runtime_focus_window({ label }) {
    const win = windows.get(String(label));
    if (!win || win.isDestroyed()) throw new Error(`窗口不存在：${label}`);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  },

  runtime_close_window({ label }) {
    const win = windows.get(String(label));
    if (!win || win.isDestroyed()) throw new Error(`窗口不存在：${label}`);
    win.close();
  },

  runtime_set_window_title({ title }, event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setTitle(String(title || "").slice(0, 200));
    }
  },

  runtime_open_external({ url }) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      throw new Error(`无效 URL：${url}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`不允许打开非 http(s) 链接：${u.href}`);
    }
    return shell.openExternal(u.href);
  },
};

ipcMain.handle("runtime:invoke", async (event, command, args) => {
  assertTrustedSender(event);
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`未知命令：${command}`);
  return handler(args || {}, event);
});

async function boot() {
  const webRoot = resolveWebRoot();
  console.error(`[mazmot-runtime] 站点根 ${webRoot}`);

  let mainServer = null;
  for (const port of MAIN_PORTS) {
    const server = new StaticServer({
      root: webRoot,
      version: app.getVersion(),
      label: `main:${port}`,
    });
    const bound = await server.start(port);
    if (bound) {
      mainServer = server;
      mainPort = bound.port;
      break;
    }
    await server.stop();
  }
  if (!mainServer) {
    throw new Error("无法绑定主站端口（30031/30033-30036 均被占用）");
  }

  // 隔离域（conjure bridge 预览）：固定 30032，失败只降级预览功能
  const bridgeServer = new StaticServer({
    root: webRoot,
    version: app.getVersion(),
    label: "bridge",
  });
  const bridgeBound = await bridgeServer.start(BRIDGE_PORT);
  bridgePort = bridgeBound ? bridgeBound.port : null;
  if (!bridgePort) {
    console.error(
      `[mazmot-runtime] 端口 ${BRIDGE_PORT} 被占用，conjure 隔离预览不可用`,
    );
  }

  mainWindow = createShellWindow({
    label: "main",
    url: `http://localhost:${mainPort}/`,
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    resizable: true,
  });

  app.on("will-quit", () => {
    Promise.all([mainServer.stop(), bridgeServer.stop()]).catch(() => {});
  });

  // 默认菜单提供 Cmd+Q / 复制粘贴 / 开发者工具；应用名已由 app.setName 设为 Mazmot
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }

  console.error(
    `[mazmot-runtime] 主窗口就绪 http://localhost:${mainPort}（bridge: ${bridgePort}）`,
  );
}
