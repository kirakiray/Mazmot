// 应用分享工具模块
// 基于 noneos-core DataPublisher 做 P2P 分发。
// 短链接方案：URL 只带 publisherUserId + payloadHash 两个字段，
// 展示元数据放在通过 publisher.publish 发布的一个"分享清单 JSON"里，
// 由 core 的 manifest 签名 + chunk SHA-256 保证内容完整与身份归属。

import { getUser } from "/nos/user/main.js";
import { DataPublisher } from "/nos/publish/data-publisher.js";
import { getHash } from "/nos/util/hash/main.js";
import { readAppFiles } from "./app-runner.js";

export const PACKAGE_VERSION = "1.0.0";
export const SHARE_NAMESPACE = "mazmot";
export const SHARE_PAYLOAD_VERSION = "1.0.0";

let _userCache = null;
let _publisherCache = null;

/**
 * 获取当前用户实例（LocalUser）。同一 namespace 下 userId 稳定，
 * 可用于生成应用 ID 或读取身份信息，不会启动 P2P 网络。
 */
export async function ensureUser() {
  if (_userCache) return _userCache;
  _userCache = await getUser(SHARE_NAMESPACE);
  return _userCache;
}

/**
 * 确保当前用户的 DataPublisher 已初始化并启动。返回 { user, publisher } 单例。
 * `user.ready()` 会自动连接默认信令服务器。
 */
export async function ensurePublisher() {
  if (_publisherCache) return _publisherCache;
  const user = await ensureUser();
  const publisher = new DataPublisher(user);
  publisher.start();
  _publisherCache = { user, publisher };
  return _publisherCache;
}

/**
 * 生成应用 ID：`${应用名}-${当前用户 userId}`。
 * @param {string} appName
 */
export async function generateAppId(appName) {
  const user = await ensureUser();
  return `${appName}-${user.userId}`;
}

/**
 * 将应用文件列表 + 元数据封装为一个 JSON File 对象。
 * @param {Array<{path:string, content:string}>} files
 * @param {Object} meta
 * @returns {File}
 */
export function buildPackageFile(files, meta) {
  const pkg = {
    mazmotPackage: PACKAGE_VERSION,
    meta,
    files,
  };
  const json = JSON.stringify(pkg);
  const blob = new Blob([json], { type: "application/json" });
  const fileName = `${meta.recordName || "mazmot"}.mazmot.json`;
  return new File([blob], fileName, { type: "application/json" });
}

/**
 * 把"分享清单 payload"打包成 File，供 DataPublisher.publish 发布。
 * publish 完成后 manifest.fileHash 就是短链接里携带的 `h`。
 * @param {Object} payload
 * @returns {File}
 */
export function buildSharePayloadFile(payload) {
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: "application/json" });
  const fileName = `${payload.appId || "mazmot"}.share.json`;
  return new File([blob], fileName, { type: "application/json" });
}

/**
 * 构造"自动安装并跳转到应用"的一键分享链接。
 * @param {string} origin - 当前域名（location.origin）
 * @param {string} publisherUserId - 发布者 userId（公钥哈希）
 * @param {string} payloadHash - publish 分享清单后得到的 manifest.fileHash
 * @returns {string}
 */
export function buildRunUrl(origin, publisherUserId, payloadHash) {
  return `${origin}/apps/run-app/?u=${encodeURIComponent(
    publisherUserId,
  )}&h=${encodeURIComponent(payloadHash)}`;
}

/**
 * 从 URL search 解析短链接参数；返回 null 表示参数缺失/非法。
 * @param {string} search - location.search（带或不带 "?" 均可）
 * @returns {{ userId: string, payloadHash: string } | null}
 */
export function parseShareUrl(search) {
  if (!search) return null;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const u = params.get("u");
  const h = params.get("h");
  if (!u || !h) return null;
  return { userId: u, payloadHash: h };
}

/**
 * 校验一个 core manifest.publicKey 是否与目标 userId 一致
 * （userId = sha256_hex(publicKeyString)，与 noneos-core BaseUser 内部实现一致）。
 * @param {string} publicKey
 * @param {string} expectedUserId
 * @returns {Promise<boolean>}
 */
export async function isPublicKeyOfUser(publicKey, expectedUserId) {
  if (!publicKey || !expectedUserId) return false;
  const hash = await getHash(publicKey);
  return hash === expectedUserId;
}

/**
 * 将一个应用完整发布到 P2P 网络，返回可分享的短链接。
 * 内部会依次：读取文件 → 打包 → publish 内容 → publish 分享清单 → 拼 URL。
 * @param {Object} app - 应用记录（需要 _handle / _recordName / name / version / desc / icon 等字段）
 * @param {Object} [options]
 * @param {string} [options.appId] - 可提前生成的 appId，若未传则自动生成
 * @param {string} [options.origin] - 拼接 URL 用的 origin，默认 window.location.origin
 * @param {(step: {phase: string, progress: number, text: string}) => void} [options.onProgress]
 * @returns {Promise<{ shareUrl: string, appId: string, payloadHash: string }>}
 */
export async function publishApp(app, options = {}) {
  const { onProgress } = options;
  const report = (phase, progress, text) => {
    if (onProgress) {
      try {
        onProgress({ phase, progress, text });
      } catch (_) {}
    }
  };

  if (!app || !app._handle) {
    throw new Error("缺少应用句柄，无法发布");
  }

  report("prepare", 5, "正在准备分享...");
  const appId = options.appId || app.appId || (await generateAppId(app._recordName || app.name));

  report("read", 15, "读取应用文件...");
  const files = await readAppFiles(app._handle);
  if (!files.length) {
    throw new Error("应用目录为空，无法分享");
  }

  report("connect", 30, "连接分享网络...");
  const { user, publisher } = await ensurePublisher();

  const meta = {
    appId,
    recordName: app._recordName || app.name,
    displayName: app.name,
    version: app.version || "0.1.0",
    description: app.desc || "",
    icon: app.icon || "📦",
  };

  report("publish", 55, "分块签名并发布到网络...");
  const packageFile = buildPackageFile(files, meta);
  const manifest = await publisher.publish(packageFile);

  report("payload", 85, "发布分享清单...");
  const payloadData = {
    v: SHARE_PAYLOAD_VERSION,
    appId,
    recordName: meta.recordName,
    displayName: meta.displayName,
    version: meta.version,
    description: meta.description,
    icon: meta.icon,
    publisherUserId: user.userId,
    fileHash: manifest.fileHash,
  };
  const payloadFile = buildSharePayloadFile(payloadData);
  const payloadManifest = await publisher.publish(payloadFile);
  const origin = options.origin || window.location.origin;
  const shareUrl = buildRunUrl(origin, user.userId, payloadManifest.fileHash);

  report("done", 100, "");
  return { shareUrl, appId, payloadHash: payloadManifest.fileHash };
}
