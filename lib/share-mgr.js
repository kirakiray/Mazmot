// 应用分享工具模块
// 基于 noneos-core DataPublisher 做 P2P 分发。
// 短链接方案：URL 只带 publisherUserId + payloadHash 两个字段，
// 展示元数据放在通过 publisher.publish 发布的一个"分享清单 JSON"里，
// 由 core 的 manifest 签名 + chunk SHA-256 保证内容完整与身份归属。

import { getUser } from "/nos/user/main.js";
import { DataPublisher } from "/nos/publish/data-publisher.js";
import { getHash } from "/nos/util/hash/main.js";
import { deleteManifest } from "/nos/publish/db.js";
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
 * run-app 内部保留使用的 query 参数名；应用层不会被这些参数名干扰。
 * 凡是不在这个列表里的 query 参数，都属于"应用业务参数"。
 */
export const RESERVED_SHARE_KEYS = ["u", "h"];

/**
 * 构造"自动安装并跳转到应用"的一键分享链接。
 *
 * 除 run-app 自身使用的 u/h 两个保留参数外，可通过 `appParams` 携带任意
 * 应用业务参数。这些业务参数会原样追加到链接上，run-app 在跳转最终应用入口时
 * 会把它们透传给应用（u/h 不会带给应用）。
 *
 * @param {string} origin - 当前域名（location.origin）
 * @param {string} publisherUserId - 发布者 userId（公钥哈希）
 * @param {string} payloadHash - publish 分享清单后得到的 manifest.fileHash
 * @param {Object<string,string|number>} [appParams] - 应用业务参数（可选）
 * @returns {string}
 */
export function buildRunUrl(origin, publisherUserId, payloadHash, appParams) {
  let url = `${origin}/apps/run-app/?u=${encodeURIComponent(
    publisherUserId,
  )}&h=${encodeURIComponent(payloadHash)}`;
  if (appParams && typeof appParams === "object") {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(appParams)) {
      // 过滤 undefined / null，避免出现 "key=undefined"
      if (value !== undefined && value !== null) {
        sp.append(key, String(value));
      }
    }
    const extra = sp.toString();
    if (extra) url += "&" + extra;
  }
  return url;
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
 * 把 URL search 拆分为「run-app 保留参数」与「应用业务参数」两部分。
 *
 * u/h 属于 run-app 自身使用（判定发布者身份 / 拉取分享清单），不会透传给应用；
 * 其余所有 query 参数都被视为应用业务参数，由 run-app 在跳转应用入口时原样带给应用。
 *
 * 与 `parseShareUrl` 的区别：parseShareUrl 只关心 u/h 且缺失时返回 null；
 * splitShareQuery 永远返回完整结构，方便 run-app 端统一处理。
 *
 * @param {string} search - location.search（带或不带 "?" 均可，空串也安全）
 * @returns {{ userId: string, payloadHash: string, appParams: Object<string,string> }}
 */
export function splitShareQuery(search) {
  if (!search) return { userId: "", payloadHash: "", appParams: {} };
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const appParams = {};
  for (const [key, value] of params.entries()) {
    if (!RESERVED_SHARE_KEYS.includes(key)) {
      appParams[key] = value;
    }
  }
  return {
    userId: params.get("u") || "",
    payloadHash: params.get("h") || "",
    appParams,
  };
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
 * @param {Object<string,string|number>} [options.appParams] - 附加到分享链接上的应用业务参数
 * @param {(step: {phase: string, progress: number, text: string}) => void} [options.onProgress]
 * @returns {Promise<{ shareUrl: string, appId: string, payloadHash: string, fileHash: string }>}
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
  const shareUrl = buildRunUrl(origin, user.userId, payloadManifest.fileHash, options.appParams);

  report("done", 100, "");
  return { shareUrl, appId, payloadHash: payloadManifest.fileHash, fileHash: manifest.fileHash };
}

/**
 * 撤销一次已发布的应用分享（方案 1：只删两级 manifest，不动 chunks）。
 *
 * 之所以不删 chunks：`file_chunks` 是按内容寻址（同一 128KB 内容全库只存一份），
 * 多个应用的分享很可能共用相同 chunk（模板文件、未改动增量等）。
 * 若删掉可能"通用"的 chunk，其他仍开启分享的应用在被拉取时会因缺块而组装失败。
 *
 * 只删 manifest 已足以让链接失效：接收端 `requestManifest` 拉不到 manifest 就无法进入下一步。
 * 保留的 chunks 属于本地冗余，用户再次开启分享同一应用时 `saveChunk` 幂等复用、几乎瞬时完成。
 *
 * @param {Object} target - 应用记录，至少提供 `payloadHash`；若同时提供 `fileHash`
 *   则一并删除应用包 manifest（更彻底）。老数据没有 `fileHash` 也没关系：payload
 *   manifest 一旦删掉，接收端在第一步 `requestManifest(payloadHash)` 就会失败，
 *   根本走不到应用包 manifest 的下载。
 * @returns {Promise<{ payloadDeleted: boolean, fileDeleted: boolean }>}
 */
export async function unpublishApp(target) {
  const result = { payloadDeleted: false, fileDeleted: false };
  const payloadHash = target && target.payloadHash;
  if (!payloadHash) return result;

  // deleteManifest 需要 namespace（数据库按 namespace 隔离），
  // 我们的分享全部在 SHARE_NAMESPACE 下发布，直接复用即可。
  try {
    await deleteManifest(SHARE_NAMESPACE, payloadHash);
    result.payloadDeleted = true;
  } catch (err) {
    console.warn("删除分享清单 manifest 失败：", err);
  }

  const fileHash = target && target.fileHash;
  if (fileHash) {
    try {
      await deleteManifest(SHARE_NAMESPACE, fileHash);
      result.fileDeleted = true;
    } catch (err) {
      console.warn("删除应用包 manifest 失败：", err);
    }
  }

  return result;
}
