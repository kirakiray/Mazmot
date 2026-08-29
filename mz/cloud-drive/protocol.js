// mz/cloud-drive/protocol —— 云盘套件共享协议常量与纯工具函数
//
// 服务器端与客户端共同遵守的消息协议。业务 payload 统一为
//   请求：{ t: <MSG 类型>, reqId, ...参数 }
//   响应：{ t: "<类型>-res", reqId, ok: true, ...结果 } | { ..., ok: false, error }

// NoneOS 服务 appId（双方 registerService / sendToService 使用）
export const APP_SERVICE_ID = "cloud-drive-v1";

// getUser 命名空间：客户端与服务器同属一个身份体系
export const USER_NAMESPACE = "cloud-drive";

// 文件分块大小（base64 后约 64KB，信封整体远小于中继 256KB 硬限制）
export const CHUNK_SIZE = 48 * 1024;

// 超过该大小的上传/下载走断点续传流程（分块进度持久化，刷新可恢复）
export const RESUME_MIN_SIZE = 256 * 1024;

// 消息类型（payload.t）
export const MSG = {
  PING: "ping",
  SPACE_LIST: "space-list",
  LOGIN: "login",
  LOGOUT: "logout",
  RESUME: "resume", // 刷新后凭持久化会话恢复登录（服务器记审计）
  LIST: "list",
  MKDIR: "mkdir",
  REMOVE: "remove",
  RENAME: "rename",
  UPLOAD_INIT: "up-init",
  UPLOAD_CHUNK: "up-chunk",
  UPLOAD_COMPLETE: "up-complete",
  UPLOAD_CANCEL: "up-cancel",
  DOWNLOAD_INIT: "down-init",
  DOWNLOAD_CHUNK: "down-chunk",
};

/** Uint8Array -> base64（大数组分块编码避免 apply 栈溢出） */
export function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** base64 -> Uint8Array */
export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 字节数格式化（1024 进制） */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n;
  let unit = "B";
  for (const u of units) {
    if (val < 1024) break;
    val /= 1024;
    unit = u;
  }
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${unit}`;
}

/** 时间格式化 */
export function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

let idSeq = 0;
/** 生成短唯一 id */
export function newId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${(++idSeq).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** SHA-256 摘要（hex），用于密码散列 */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 按分块大小切分数组 */
export function chunkIndexes(total, chunkSize = CHUNK_SIZE) {
  const count = Math.ceil(total / chunkSize);
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(i);
  return arr;
}

/** 文件图标（按扩展名粗略分类） */
export function fileIcon(name, isDir) {
  if (isDir) return "mdi:folder";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext))
    return "mdi:file-image";
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext))
    return "mdi:file-video";
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return "mdi:file-music";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return "mdi:zip-box";
  if (["pdf"].includes(ext)) return "mdi:file-pdf-box";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext))
    return "mdi:file-word-box";
  if (["txt", "md", "json", "js", "css", "html", "log"].includes(ext))
    return "mdi:file-document-outline";
  return "mdi:file-outline";
}
