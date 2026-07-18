// 应用分享工具模块
// 基于 noneos-core DataPublisher 做 P2P 分发，链接携带签名 payload 防篡改。

import { getUser } from "/nos/user/main.js";
import { DataPublisher } from "/nos/publish/data-publisher.js";
import { verifyData } from "/nos/crypto/crypto-verify.js";

export const PACKAGE_VERSION = "1.0.0";
export const SHARE_NAMESPACE = "mazmot";

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
 * 首次调用后自动 memoize，重复调用直接返回缓存。
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
 * userId 是 LocalUser 公钥哈希（跨设备、跨 tab 稳定），配合应用名可以唯一标识一个应用。
 * @param {string} appName - 应用名（不含空格，用于目录/展示都对得上）
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
 * 用发布者身份对 payload 数据进行签名，返回带 signature/publicKey/signTime 的扁平对象。
 * 直接使用 user._sign（noneos-core 内部规范化 + ECDSA）。
 * @param {LocalUser} user
 * @param {Object} data
 */
export async function signSharePayload(user, data) {
  // user.sign 会将字段按字母序序列化后 ECDSA 签名
  return user.sign(data);
}

/**
 * 用 verifyData 校验签名 payload，返回 boolean。
 * ⚠️ 必须传入原始 JSON.parse 结果，不要重建对象（会打乱字段顺序导致验签失败）。
 * @param {Object} payload
 */
export async function verifySharePayload(payload) {
  if (!payload || !payload.signature || !payload.publicKey) return false;
  try {
    return await verifyData(payload);
  } catch (err) {
    console.warn("[share-mgr] verifyData 抛异常：", err);
    return false;
  }
}

/**
 * URL-safe Base64 编码（对字符串编码，兼容 unicode）
 * @param {string} str
 */
export function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL-safe Base64 解码为字符串
 * @param {string} b64url
 */
export function base64UrlDecode(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  b64 += "=".repeat(padLen);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 构造分享链接
 * @param {string} origin - 当前域名（location.origin）
 * @param {Object} signedPayload - user._sign 的返回值
 * @returns {string}
 */
export function buildShareUrl(origin, signedPayload) {
  const encoded = base64UrlEncode(JSON.stringify(signedPayload));
  return `${origin}/apps/install-app/?p=${encoded}`;
}

/**
 * 构造「自动安装并跳转到应用」的一键分享链接。
 * 接收端为 /apps/run-app/，将静默完成 Core 校验、验签、自动安装/更新后
 * 用 location.replace 跳转到应用运行地址。
 * @param {string} origin - 当前域名（location.origin）
 * @param {Object} signedPayload - user._sign 的返回值
 * @returns {string}
 */
export function buildRunUrl(origin, signedPayload) {
  const encoded = base64UrlEncode(JSON.stringify(signedPayload));
  return `${origin}/apps/run-app/?p=${encoded}`;
}

/**
 * 从 URL search 解析签名 payload；返回 null 表示参数缺失/非法。
 * 保留 JSON 字段原顺序，供后续 verifyData 使用。
 * @param {string} search - location.search（带或不带 "?" 均可）
 */
export function parseShareUrl(search) {
  if (!search) return null;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const p = params.get("p");
  if (!p) return null;
  try {
    const json = base64UrlDecode(p);
    return JSON.parse(json);
  } catch (err) {
    console.warn("[share-mgr] parseShareUrl 解析失败：", err);
    return null;
  }
}
