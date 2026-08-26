// 内容指纹：sha256(signature) 的 hex，同一版证书在签发方/持有方之间一致，
// 作为这“一版”数据的稳定 ID（区别于存储主键 id = role-issuer-subject）
export const certFingerprint = async (signature) => {
  if (!signature) return "";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signature),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
