// Conjure 隔离预览 —— 应用页常驻代理
//
// 由 receiver.js 在写入 index.html 时注入（<script src="/bridge/inject.js"
// data-conjure-id="...">，见 injectAgent）。本脚本运行在 30032 隔离域的
// 预览应用页面内，注册 conjure-agent 服务：
//   - 页面加载即 connectUser(conjure) 并上报 agent-online；
//   - 后续妙造再次点「预览应用」时与本代理直连：sync-check 增量比对 →
//     只接收差异文件（经 receiver 写入本域 VFS）→ app-end 后回报 done 并
//     location.reload() 应用新代码，无需重开 bridge 引导页。
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
  if (!conjureId) {
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
    const receiver = createPreviewReceiver({ conjureId });

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
              }
              return;
            }
            if (payload.type === "app-end" && result && result.url) {
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
    log(`代理就绪（app=${appName}）`);
  } catch (err) {
    // 代理失败不影响应用页面本身
    log("启动失败（忽略）：", err);
  }
}

main();
