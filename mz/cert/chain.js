// 链查询（纯逻辑，不依赖 DOM）：
// 从某证书出发，扫描其自定义字段中的 [chain_key:...] 引用，本地解析后递归，
// 输出扁平节点列表（depth 表层级），带环检测与深度上限。
import { parseRef, normalizeChainKey } from "./ref.js";

export const CHAIN_MAX_DEPTH = 32;

// rootCert：完整证书记录（含自定义字段与 signature，用于指纹）
// resolveCert：async (id) => 完整证书记录 | null（本地凭证库解析）
// fingerprint：async (cert) => string（内容指纹，可传 null 跳过）
// 返回 [{ depth, id, role, issuer, subject, status, fingerprint, viaField }]
//   status: "ok"（本地持有且未过期） | "expired"（本地持有已过期） | "missing"（本地缺失）
export const buildChain = async (
  rootCert,
  resolveCert,
  fingerprint = null,
  now = Date.now(),
) => {
  const nodes = [];
  const visited = new Set();

  const walk = async (cert, depth, viaField) => {
    const expired = !!cert.expire && cert.expire < now;
    nodes.push({
      depth,
      id: cert.id || "",
      role: cert.role || "",
      issuer: cert.issuer || "",
      subject: cert.subject || "",
      status: expired ? "expired" : "ok",
      fingerprint: fingerprint ? await fingerprint(cert) : "",
      viaField: viaField || "",
    });
    visited.add(cert.id);

    if (depth >= CHAIN_MAX_DEPTH) return;

    // 收集该证书自定义字段上的全部 chain_key 引用
    for (const [field, value] of Object.entries(cert)) {
      if (
        ["id", "role", "issuer", "subject", "signTime", "expire", "signature", "publicKey"]
          .includes(field)
      ) {
        continue;
      }
      const ref = parseRef(typeof value === "object" ? JSON.stringify(value) : String(value));
      if (!ref || ref.type !== "chain_key") continue;

      const key = normalizeChainKey(ref.payload);
      const refId = key
        ? `${key.role}-${key.issuer}-${key.subject}`
        : ref.payload;
      if (visited.has(refId)) continue; // 环检测：已访问的引用不再展开
      visited.add(refId);

      const next = await resolveCert(refId);
      if (next) {
        await walk(next, depth + 1, field);
      } else {
        nodes.push({
          depth: depth + 1,
          id: refId,
          role: key ? key.role : ref.payload.slice(0, 24),
          issuer: key ? key.issuer : "",
          subject: key ? key.subject : "",
          status: "missing",
          fingerprint: "",
          viaField: field,
        });
      }
    }
  };

  await walk(rootCert, 0, "");
  return nodes;
};

const BUILTIN_KEYS = [
  "id", "role", "issuer", "subject", "signTime",
  "expire", "signature", "publicKey",
];

// 单张证书的字段整理（纯逻辑）：普通自定义字段 + 每个链式字段展开好的节点列表。
// 链式字段引用的证书本地缺失时，该链返回单个 missing 根节点（不再深入）。
// 返回 { plain: [{key, value}], chains: [{field, nodes}] }，nodes 同 buildChain。
export const collectChainFields = async (
  cert,
  resolveCert,
  fingerprint = null,
) => {
  const plain = [];
  const chains = [];
  for (const [field, value] of Object.entries(cert)) {
    if (BUILTIN_KEYS.includes(field)) continue;
    const raw =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    const ref = parseRef(raw);
    if (!ref) {
      plain.push({ key: field, value: raw });
      continue;
    }
    const key = normalizeChainKey(ref.payload);
    const refId = key
      ? `${key.role}-${key.issuer}-${key.subject}`
      : ref.payload;
    const root = await resolveCert(refId);
    if (root) {
      chains.push({
        field,
        nodes: await buildChain(root, resolveCert, fingerprint),
      });
    } else {
      chains.push({
        field,
        nodes: [
          {
            depth: 0,
            id: refId,
            role: key ? key.role : ref.payload.slice(0, 24),
            issuer: key ? key.issuer : "",
            subject: key ? key.subject : "",
            status: "missing",
            fingerprint: "",
            viaField: field,
          },
        ],
      });
    }
  }
  return { plain, chains };
};
