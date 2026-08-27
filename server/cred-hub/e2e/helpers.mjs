// 公共工具：按 NoneOS 签名方案在本地生成密钥并签发 cred 数据
import { webcrypto as crypto } from "node:crypto";

export const b64 = (buf) => Buffer.from(buf).toString("base64");

export async function generateUser(name = "u") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { name, publicKey: b64(spki), privateKey: pair.privateKey };
}

/// 与 Rust 端 to_canonical_json 一致：递归按 key 字母序、紧凑序列化
export function sortedStringify(obj) {
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(",")}]`;
  if (obj && typeof obj === "object") {
    const items = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`);
    return `{${items.join(",")}}`;
  }
  return JSON.stringify(obj);
}

const subjectOf = (user) => (user.name === "alice" ? "bob" : "alice");

export async function issueCert(user, fields) {
  const subject = fields.subject ?? subjectOf(user);
  const issuer = fields.issuer ?? user.name;
  const data = {
    expire: null,
    issuer,
    publicKey: user.publicKey,
    signTime: Date.now(),
    subject,
    ...fields,
    id: `${fields.role}-${issuer}-${subject}`,
  };
  data.signature = await signWith(user.privateKey, data);
  return data;
}

/** 修改 cert 字段后重新签名（自动剥离旧 signature 再签） */
export async function resign(cert, user) {
  const data = { ...cert };
  delete data.signature;
  data.signature = await signWith(user.privateKey, data);
  return data;
}

/** 对任意对象签名（profile 卡片等无 id 的签名载荷形态） */
export async function signObject(user, data) {
  return { ...data, signature: await signWith(user.privateKey, data) };
}

async function signWith(privateKey, data) {
  return b64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        Buffer.from(sortedStringify(data))
      )
    )
  );
}
