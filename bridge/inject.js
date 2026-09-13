// Conjure 隔离预览 —— 应用页常驻代理
//
// 由 receiver.js 在写入 index.html 时注入（<script src="/bridge/inject.js"
// data-conjure-id="...">，见 injectAgent）。本脚本运行在 30032 隔离域的
// 预览应用页面内，注册 conjure-agent 服务：
//   - 页面加载即 connectUser(conjure) 并上报 agent-online；
//   - 后续妙造再次点「预览应用」时与本代理直连：sync-check 增量比对 →
//     只接收差异文件（经 receiver 写入本域 VFS）→ app-end 后回报 done 并
//     location.reload() 应用新代码，无需重开 bridge 引导页；
//   - 页面内常驻可拖拽的「调试预览」气泡（见 createBubble），标识本应用
//     经隔离预览（debug）模式运行，并联动代理状态。
//
// 以 ES module 加载；依赖的同源静态模块（proto/receiver）与 /nos/*（页面
// 由 Core SW 伺服，必定受控）均可直接 import。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_AGENT,
  USER_NAMESPACE,
  createReliableLink,
} from "/bridge/proto.js";
import { createPreviewReceiver, waitUrlReady } from "/bridge/receiver.js";
import { getUser } from "/nos/user/main.js";

// 注入标签里的 conjure 侧 userId（module script 无 document.currentScript，
// 从 DOM 上的标签取）
const scriptTag = document.querySelector(
  `script[src="${import.meta.url.replace(location.origin, "")}"]`,
) || document.querySelector('script[src*="/bridge/inject.js"]');
const conjureId = scriptTag ? scriptTag.dataset.conjureId || "" : "";

const log = (...args) => console.info("[conjure-agent]", ...args);

/* ---------- 调试预览气泡（可拖拽） ---------- */

const BUBBLE_ID = "conjure-preview-bubble";
const BUBBLE_POS_KEY = "conjure-agent-bubble-pos";

/**
 * 创建常驻气泡：标识「本应用经隔离预览（debug）运行」，可拖拽，
 * 位置记忆在 sessionStorage（同标签页 reload 后保留）。
 * 挂在 documentElement（html）下而非 body——AI 生成的应用常在脚本里
 * 重写 body（innerHTML / replaceChildren），挂 body 会被一并清掉；
 * 另配 MutationObserver：节点被应用移除时自动回挂。
 * 导出供测试；返回 { set(text, tone) }，tone: "idle"|"busy"|"ok"|"offline"。
 */
export function createBubble() {
  if (document.getElementById(BUBBLE_ID)) {
    return { set: () => {} };
  }
  const el = document.createElement("div");
  el.id = BUBBLE_ID;
  // 全内联样式：注入目标页的 CSS 变量 / 规则不可依赖（AI 生成的应用任意写）
  Object.assign(el.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 14px",
    borderRadius: "999px",
    font: "12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft Yahei', sans-serif",
    color: "#fff",
    background: "rgba(32, 36, 44, 0.82)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
    backdropFilter: "blur(8px)",
    webkitBackdropFilter: "blur(8px)",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
    whiteSpace: "nowrap",
  });
  // 关键属性带 !important：应用的 !important CSS 试图隐藏 / 改定位时保持压制
  //（position 必须 fixed，否则 z-index 失效、气泡被挤进文档流）
  for (const [prop, val] of [
    ["position", "fixed"],
    ["z-index", "2147483647"],
    ["left", "16px"],
    ["top", "auto"],
    ["right", "auto"],
    ["bottom", "16px"],
    ["display", "flex"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["pointer-events", "auto"],
  ]) {
    el.style.setProperty(prop, val, "important");
  }

  const dot = document.createElement("span");
  Object.assign(dot.style, {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#9aa0a6",
    flex: "none",
  });
  const label = document.createElement("span");
  label.textContent = "🛰 隔离预览";

  el.append(dot, label);
  const host = document.documentElement;
  host.appendChild(el);

  // 守护：应用重写 DOM 把气泡移除时自动回挂（观察整个文档子树）
  const guard = new MutationObserver(() => {
    if (!document.getElementById(BUBBLE_ID)) {
      try {
        host.appendChild(el);
      } catch (_) {}
    }
  });
  guard.observe(host, { childList: true, subtree: true });

  const TONE_COLOR = {
    idle: "#9aa0a6",
    busy: "#fbbf24",
    ok: "#22c55e",
    offline: "#ef4444",
  };
  const api = {
    set(text, tone = "idle") {
      if (text) label.textContent = text;
      dot.style.background = TONE_COLOR[tone] || TONE_COLOR.idle;
    },
  };

  // 恢复上次拖放位置（同标签页有效，reload 不丢）
  try {
    const saved = JSON.parse(sessionStorage.getItem(BUBBLE_POS_KEY) || "null");
    if (
      saved &&
      Number.isFinite(saved.x) &&
      Number.isFinite(saved.y)
    ) {
      place(saved.x, saved.y);
    }
  } catch (_) {}

  function clamp(x, y) {
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 32;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
    };
  }

  function place(x, y) {
    const p = clamp(x, y);
    el.style.setProperty("left", `${p.x}px`, "important");
    el.style.setProperty("top", `${p.y}px`, "important");
    // 清掉初始锚定的 bottom/right：固定定位下 top 与 bottom 同时生效会把
    // 高度 auto 的气泡拉伸到两端之间（底边钉死在视口底部）
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("right", "auto", "important");
  }

  // Pointer Events 拖拽（mouse / touch 通用）
  let dragging = null;
  el.addEventListener("pointerdown", (e) => {
    dragging = {
      px: e.clientX,
      py: e.clientY,
      ox: el.offsetLeft,
      oy: el.offsetTop,
    };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    place(
      dragging.ox + e.clientX - dragging.px,
      dragging.oy + e.clientY - dragging.py,
    );
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    el.style.cursor = "grab";
    try {
      sessionStorage.setItem(
        BUBBLE_POS_KEY,
        JSON.stringify({ x: el.offsetLeft, y: el.offsetTop }),
      );
    } catch (_) {}
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  return api;
}

/* ---------- 代理主流程 ---------- */

async function ensureServerConnected(user, timeout = 5000) {
  const urls = () =>
    Array.isArray(user.server?.connectedUrls) ? user.server.connectedUrls : [];
  let servers = [];
  try {
    servers = (await user.server.getServers()) || [];
  } catch (_) {
    return;
  }
  await Promise.all(
    servers.map((s) => user.server.connect(s).catch(() => {})),
  );
  const deadline = Date.now() + timeout;
  while (urls().length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  const bubble = createBubble();
  bubble.set("🛰 隔离预览", "idle");

  if (!conjureId) {
    bubble.set("🛰 隔离预览（未连妙造）", "offline");
    log("缺少 data-conjure-id，代理不启动");
    return;
  }
  try {
    const user = await getUser(USER_NAMESPACE);
    let remote = null;
    const link = createReliableLink({
      sendTo: (env) =>
        remote
          ? remote.sendToService(SERVICE_ID_CONJURE, env, {
              waitForService: 3000,
            })
          : Promise.resolve([{ status: "error" }]),
    });

    // 接收端：复用 receiver（含 index.html 代理脚本注入与增量比对），
    // 应用名取本页路径 /$conjure-apps/<name>/client/index.html 的 <name>
    const appName = decodeURIComponent(
      location.pathname.split("/")[2] || "",
    );
    const receiver = createPreviewReceiver({
      conjureId,
      onProgress: (total, done, path) => {
        if (path == null) {
          bubble.set(`⬇️ 接收更新 0/${total}`, "busy");
          return;
        }
        bubble.set(`⬇️ 接收更新 ${done}/${total}`, "busy");
      },
    });

    user.registerService(SERVICE_ID_AGENT, {
      onMessage: (data, ctx) => {
        const payload = link.receive(data, (env) => {
          // ACK 定向回复到 conjure 监听的服务
          ctx.remoteUser
            .sendToService(SERVICE_ID_CONJURE, env, {
              sessionId: ctx.fromSessionId,
            })
            .catch(() => {});
        });
        if (!payload) return;
        receiver
          .handle(payload)
          .then((result) => {
            if (payload.type === "sync-check" && result && result.reply) {
              link.send(result.reply).catch(() => {});
              // 零差异：直接回报 done（无需刷新，conjure 侧收尾）
              if (!result.reply.missing.length) {
                link
                  .send({
                    type: "done",
                    appName: result.appName,
                    url: result.url,
                  })
                  .catch(() => {});
                bubble.set("🛰 隔离预览 · 已是最新", "ok");
              }
              return;
            }
            if (payload.type === "app-end" && result && result.url) {
              bubble.set("🔄 更新完成，刷新中...", "ok");
              // 文件已全部落盘：回报 done 后刷新本页应用新代码
              link
                .send({ type: "done", appName: result.appName, url: result.url })
                .catch(() => {});
              waitUrlReady(result.url, 10000).then(() => location.reload());
            }
          })
          .catch((err) => log("处理消息失败：", err));
      },
    });

    await ensureServerConnected(user);
    remote = await user.connectUser(conjureId);
    // 上报就绪（尽力投递；conjure 不在线时静默失败，不影响应用本身运行）
    await link.send({ type: "agent-online", userId: user.userId });
    bubble.set("🛰 隔离预览 · 已连接妙造", "ok");
    log(`代理就绪（app=${appName}）`);
  } catch (err) {
    // 代理失败不影响应用页面本身
    bubble.set("🛰 隔离预览 · 连接失败", "offline");
    log("启动失败（忽略）：", err);
  }
}

main();
