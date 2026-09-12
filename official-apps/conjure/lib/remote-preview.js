// 妙造隔离预览 —— conjure 侧编排
//
// 把生成的应用文件经 noneos-core 应用间通信（remoteUser + registerService）
// 推送到隔离域（bridge，默认 http://localhost:30032），由 bridge 写入其
// 本域 VFS 后跳转运行。主域（本域）不执行 AI 生成的代码，达到数据隔离目的。
//
// 通信协议与可靠投递实现见 /bridge/proto.js（双端共享）。

import {
  SERVICE_ID_CONJURE,
  SERVICE_ID_BRIDGE,
  USER_NAMESPACE,
  buildFileMessages,
  buildManifest,
  createReliableLink,
} from "/bridge/proto.js";

// 隔离域 origin（npm run static 同时伺服 30031-30036，30032 即第二实例）
export const BRIDGE_ORIGIN = "http://localhost:30032";

// 等待 bridge hello / done 的兜底超时（bridge 首次访问需安装 Core，给足时间）
const HELLO_TIMEOUT = 120_000;
const DONE_TIMEOUT = 120_000;
// 差异比对是纯本地计算，超时说明 bridge 侧异常（旧版本协议等），直接回退全量
const DIFF_TIMEOUT = 30_000;

// 等待本地用户连上至少一台信令服务器（connectUser 的前置条件）
async function ensureServerConnected(user) {
  if (!user || !user.server) return;
  const connectedUrls = () =>
    Array.isArray(user.server.connectedUrls) ? user.server.connectedUrls : [];
  if (connectedUrls().length > 0) return;
  let servers = [];
  try {
    servers = (await user.server.getServers()) || [];
  } catch (_) {
    return; // 取列表失败时仍尝试连接（可能已在连接中）
  }
  await Promise.all(
    servers.map((url) => user.server.connect(url).catch(() => {})),
  );
  const deadline = Date.now() + 5000;
  while (connectedUrls().length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (connectedUrls().length === 0) {
    throw new Error("无法连接到任何信令服务器，请检查网络后重试");
  }
}

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);

/**
 * 打开隔离预览：新标签打开 bridge 页并推送应用文件。
 *
 * @param {Object} opts
 * @param {Function} opts.load 页面模块注入的 load 函数（按需加载 /nos/*）
 * @param {string} opts.appName 已规范化的应用名
 * @param {Array<{path: string, text: string}>} opts.files 应用全部文件
 * @param {(text: string) => void} [opts.onStatus] 状态回调（推送中/完成/失败前的过程提示）
 */
export async function openRemotePreview({
  load,
  appName,
  files,
  onStatus = () => {},
  bridgeOrigin = BRIDGE_ORIGIN,
}) {
  const status = (text) => {
    try {
      onStatus(text);
    } catch (_) {}
  };

  status("创建本地用户...");
  const userMod = await load("/nos/user/main.js");
  const user = await userMod.getUser(USER_NAMESPACE);

  // bridge hello / sync-diff / done 的等待器（服务 handler 里 resolve）
  let helloResolve;
  let diffResolve;
  let doneResolve;
  const helloPromise = new Promise((r) => {
    helloResolve = r;
  });
  const diffPromise = new Promise((r) => {
    diffResolve = r;
  });
  const donePromise = new Promise((r) => {
    doneResolve = r;
  });
  let remote = null;
  let bridgeUserId = "";

  // 唯一可靠链路：必须在收到 hello 之前创建（hello 的 ACK 依赖 receive）；
  // sendTo 惰性取 remote——send 只在 hello 之后才会被调用
  const link = createReliableLink({
    sendTo: (env) =>
      remote
        ? remote.sendToService(SERVICE_ID_BRIDGE, env, { waitForService: 3000 })
        : Promise.resolve([{ status: "error" }]),
  });

  // 接收侧：回 ACK（定向到 bridge 监听的 conjure-bridge 服务）+ 分发 hello / done
  user.registerService(SERVICE_ID_CONJURE, {
    onMessage: (data, ctx) => {
      const payload = link.receive(data, (env) => {
        ctx.remoteUser
          .sendToService(SERVICE_ID_BRIDGE, env, {
            sessionId: ctx.fromSessionId,
          })
          .catch(() => {});
      });
      if (!payload) return;
      if (payload.type === "hello" && payload.userId) {
        helloResolve();
        bridgeUserId = payload.userId;
      } else if (payload.type === "sync-diff") {
        diffResolve(payload);
      } else if (payload.type === "done") {
        doneResolve(payload);
      }
    },
  });

  status("连接信令服务器...");
  await ensureServerConnected(user);

  status("打开隔离预览标签...");
  const url = `${bridgeOrigin}/bridge/?u=${encodeURIComponent(user.userId)}`;
  window.open(url, "mazmot-bridge-preview");

  status("等待 bridge 就绪（首次访问需安装 NoneOS Core）...");
  await withTimeout(
    helloPromise,
    HELLO_TIMEOUT,
    "等待 bridge 就绪超时：请确认 bridge 标签页已打开且网络可用",
  );

  status("连接 bridge...");
  remote = await user.connectUser(bridgeUserId);

  // 增量同步：先发「路径 + sha256」清单，bridge 比对本域 VFS，只回报需要（重）传的文件；
  // 比对超时 / 异常时回退全量推送
  let toSend = files;
  let wipe = true;
  try {
    status("对比文件差异...");
    const manifest = await buildManifest(files);
    await link.send({ type: "sync-check", appName, manifest });
    const diff = await withTimeout(
      diffPromise,
      DIFF_TIMEOUT,
      "等待差异比对超时",
    );
    const missing = new Set(
      Array.isArray(diff.missing) ? diff.missing : [],
    );
    toSend = files.filter((f) => missing.has(f.path));
    // 部分命中走增量覆盖（不清目录）；一个都没命中视为全量（清目录重建）
    wipe = toSend.length === files.length;
    if (!toSend.length) {
      status("内容无变化，bridge 已是最新");
    }
  } catch (err) {
    console.warn("[remote-preview] 增量比对失败，回退全量推送：", err);
    toSend = files;
    wipe = true;
  }

  if (toSend.length) {
    status(`推送应用文件（${toSend.length}/${files.length} 个有差异）...`);
    await link.send({
      type: "app-begin",
      appName,
      fileCount: toSend.length,
      wipe,
    });
    let sent = 0;
    for (const file of toSend) {
      for (const msg of buildFileMessages(appName, file.path, file.text)) {
        await link.send(msg);
      }
      sent++;
      status(`推送文件 ${sent}/${toSend.length}：${file.path}`);
    }
    await link.send({ type: "app-end", appName });
  }

  const done = await withTimeout(
    donePromise,
    DONE_TIMEOUT,
    "等待 bridge 写入完成超时",
  );
  link.dispose();
  status(`隔离预览就绪：${done.url}`);
  return done;
}
