// bridge 引导页的域名白名单守卫（canonical 实现）
//
// 为什么需要：引导页会安装 NoneOS Core、创建本地用户，并按 URL ?u=<userId>
// 指定的对端接收应用文件 + 注入常驻代理（dbg 指令含任意 JS eval，信任根就是
// ?u= 的 userId）。整个静态站（含 /bridge/）会与主站部署在同一批域名下——若
// 主站域名上的 /bridge/ 也能跑，恶意页面即可 window.open 主站域名的引导页并
// 带上攻击者自己的 userId，把任意代码注入受害者浏览器中主站 origin 的存储，
// 击穿「AI 代码不接触主域数据」的隔离前提。因此引导页只允许在专用预览域运行：
//   - *.dev.mazmot.noneos.com（线上预览域，如 c1.dev.mazmot.noneos.com；
//     注意 endsWith 匹配不含 apex dev.mazmot.noneos.com 本身）
//   - 本地开发（localhost / 127.0.0.1 / [::1]，端口不限）
//
// 消费方（两道锁，须同时保留）：
//   1. bridge/index.html 入口的内联经典脚本（解析期立即执行，先于一切模块 /
//      主题脚本；内联副本须与本文件同步修改）
//   2. bridge/bridge.html 页面模块（防其它 o-app 入口绕过 index.html）

export const BRIDGE_HOST_SUFFIX = ".dev.mazmot.noneos.com";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** 当前（或指定）hostname 是否允许运行 bridge 引导页 */
export function isBridgeHostAllowed(hostname = location.hostname) {
  const h = String(hostname || "").toLowerCase();
  if (LOCAL_HOSTS.includes(h)) return true;
  return h.endsWith(BRIDGE_HOST_SUFFIX) && h.length > BRIDGE_HOST_SUFFIX.length;
}

/** 阻断渲染：停止加载、整页替换为错误说明，并抛错终止当前脚本 */
export function blockBridgeHost(hostname = location.hostname) {
  const h = String(hostname || "");
  try {
    window.stop(); // 终止解析与后续资源加载（ofa / 主题脚本不再执行）
  } catch (_) {}
  window.__BRIDGE_HOST_BLOCKED = true;
  document.title = "预览容器不可用";
  document.documentElement.innerHTML =
    "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>预览容器不可用</title>" +
    "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fef7ff;color:#1d1b20;padding:24px;box-sizing:border-box}" +
    "@media (prefers-color-scheme:dark){body{background:#141218;color:#e6e0e9}}" +
    "main{max-width:520px}h1{font-size:20px;margin:0 0 8px}p{margin:6px 0;opacity:.85;word-break:break-all}code{background:rgba(127,127,127,.16);padding:1px 6px;border-radius:6px}</style></head>" +
    "<body><main><h1>⛔ 预览容器不可用</h1>" +
    "<p>隔离预览引导页仅允许在 <code>*.dev.mazmot.noneos.com</code>（本地开发为 <code>localhost</code>）运行。</p>" +
    "<p>当前域名：<code>" + h + "</code></p></main></body>";
  throw new Error(`[bridge] host not allowed: ${h}`);
}
