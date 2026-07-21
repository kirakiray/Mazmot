// run-app 安装流程逻辑。
// 抽出为独立模块，让 run-app.html 只负责 UI / 状态编排。
// 所有依赖（publisher, storage, init 等）都通过参数注入，方便单测。

import { requestChunkWithRetry } from "./connection.js";

/**
 * 拉取并组装「分享清单 payload」。
 *
 * 流程：requestManifest → 验证签发者 → 逐块下载 → assembleFile → JSON.parse
 *
 * @param {object} args
 * @param {object} args.publisher
 * @param {object} args.remoteUser
 * @param {string} args.payloadHash
 * @param {string} args.publisherUserId - 短链接里携带的期望签发者 userId
 * @param {(publicKey:string, expectedUserId:string) => Promise<boolean>} args.isPublicKeyOfUser
 * @param {(evt:{type:string, [k:string]:any}) => void} [args.onEvent] -
 *   过程事件回调：
 *     - { type:"manifest", chunks, fileSize }
 *     - { type:"chunk-retry", label, attempt, err }
 * @returns {Promise<object>} payload 对象（含 publisherUserId）
 */
export async function fetchSharePayload({
  publisher,
  remoteUser,
  payloadHash,
  publisherUserId,
  isPublicKeyOfUser,
  onEvent,
}) {
  const pmf = await publisher.requestManifest(remoteUser, payloadHash);
  if (onEvent) {
    onEvent({
      type: "manifest",
      chunks: pmf.chunkHashes ? pmf.chunkHashes.length : 0,
      fileSize: pmf.fileSize,
    });
  }

  const isOwner = await isPublicKeyOfUser(pmf.publicKey, publisherUserId);
  if (!isOwner) {
    const err = new Error("分享清单的签名者与链接中的 userId 不一致。");
    err.code = "PAYLOAD_SIGNER_MISMATCH";
    throw err;
  }

  const total = pmf.chunkHashes.length;
  for (let i = 0; i < total; i++) {
    await requestChunkWithRetry(publisher, remoteUser, pmf.chunkHashes[i], {
      onAttemptFail: ({ attempt, err }) => {
        onEvent &&
          onEvent({
            type: "chunk-retry",
            label: `payload chunk ${i + 1}/${total}`,
            attempt,
            err,
          });
      },
    });
  }

  const { blob } = await publisher.assembleFile(payloadHash);
  const payload = JSON.parse(await blob.text());
  payload.publisherUserId = publisherUserId;
  return payload;
}

/**
 * 查找本地已安装应用（按 appId 匹配，兼容按 name 匹配的老数据），
 * 并读取已装 app.json 里的版本号。
 *
 * @param {object} payload
 * @param {object} args
 * @param {{apps: Promise<Array>}} args.storage
 * @param {(namespace:string) => Promise<any>} args.init - noneos-core fs.init
 * @param {(apps:Array, payload:object) => object|null} args.findAppRecord
 * @returns {Promise<{record:object, installedVersion:string} | null>}
 */
export async function findInstalled(payload, { storage, init, findAppRecord }) {
  const apps = (await storage.apps) || [];
  const existing = findAppRecord(apps, payload);
  if (!existing) return null;
  let installedVersion = "";
  try {
    if (existing.source === "virtual") {
      const namespace = existing.namespace || "mazmot-apps";
      const rootDir = await init(namespace);
      const appDir = await rootDir.get(existing.name, { create: "dir" });
      let jsonFile = null;
      try {
        const clientDir = await appDir.get("client");
        jsonFile = await clientDir.get("app.json");
      } catch (e) {
        jsonFile = await appDir.get("app.json");
      }
      if (jsonFile) {
        const manifest = await jsonFile.json();
        installedVersion = (manifest && manifest.version) || "";
      }
    }
  } catch (err) {
    console.warn("读取已安装应用版本失败：", err);
  }
  return { record: existing, installedVersion };
}

/**
 * 拉取应用清单 → 下载所有 chunk → 组装 → 校验 → 写入虚拟文件系统 →
 * 更新 storage.apps。返回本地记录名（recordName）。
 *
 * @param {object} args
 * @param {object} args.publisher
 * @param {object} args.remoteUser
 * @param {object} args.payload - 分享清单
 * @param {string} [args.payloadHash] - URL 里的 h（分享清单内容哈希），存入记录用于"无改动秒跳"
 * @param {object|null} args.existingRecord - 已安装记录，null 表示全新安装
 * @param {{apps: Promise<Array>, setItem:(k:string,v:any)=>Promise<void>}} args.storage
 * @param {(namespace:string) => Promise<any>} args.init
 * @param {string} args.PACKAGE_VERSION
 * @param {(evt:{type:string, [k:string]:any}) => void} [args.onEvent] -
 *   过程事件回调：
 *     - { type:"app-manifest", chunks, fileSize }
 *     - { type:"chunk-progress", index, total }
 *     - { type:"chunk-retry", label, attempt, err }
 *     - { type:"assemble" }
 *     - { type:"write", isUpdate }
 *     - { type:"record" }
 * @returns {Promise<string>} recordName
 */
export async function installAppPackage({
  publisher,
  remoteUser,
  payload,
  payloadHash,
  existingRecord,
  storage,
  init,
  PACKAGE_VERSION,
  onEvent,
}) {
  if (!publisher || !remoteUser) {
    throw new Error("发布者连接尚未建立");
  }

  const manifest = await publisher.requestManifest(remoteUser, payload.fileHash);
  if (!manifest || !Array.isArray(manifest.chunkHashes)) {
    throw new Error("无法获取应用清单");
  }
  onEvent &&
    onEvent({
      type: "app-manifest",
      chunks: manifest.chunkHashes.length,
      fileSize: manifest.fileSize,
    });

  const total = manifest.chunkHashes.length;
  for (let i = 0; i < total; i++) {
    onEvent && onEvent({ type: "chunk-progress", index: i + 1, total });
    await requestChunkWithRetry(publisher, remoteUser, manifest.chunkHashes[i], {
      onAttemptFail: ({ attempt, err }) => {
        onEvent &&
          onEvent({
            type: "chunk-retry",
            label: `app chunk ${i + 1}/${total}`,
            attempt,
            err,
          });
      },
    });
  }

  onEvent && onEvent({ type: "assemble" });
  const result = await publisher.assembleFile(payload.fileHash);
  const pkg = JSON.parse(await result.blob.text());

  if (!pkg || pkg.mazmotPackage !== PACKAGE_VERSION) {
    throw new Error(
      `应用包格式不匹配（版本 ${pkg && pkg.mazmotPackage}）`,
    );
  }
  if (!pkg.meta || pkg.meta.appId !== payload.appId) {
    throw new Error("应用包内容与分享链接不一致");
  }
  if (!Array.isArray(pkg.files) || !pkg.files.length) {
    throw new Error("应用包为空");
  }

  const isUpdate = !!existingRecord;
  const recordName = isUpdate ? existingRecord.name : payload.appId;

  onEvent && onEvent({ type: "write", isUpdate });
  const rootDir = await init("mazmot-apps");
  const targetDir = await rootDir.get(recordName, { create: "dir" });
  if (isUpdate) {
    try {
      const oldClient = await targetDir.get("client");
      if (oldClient) await oldClient.remove();
    } catch (e) {
      // 旧目录不存在时忽略
    }
  }
  const clientDir = await targetDir.get("client", { create: "dir" });
  for (const file of pkg.files) {
    const fh = await clientDir.get(file.path, { create: "file" });
    await fh.write(file.content);
  }

  onEvent && onEvent({ type: "record" });
  const apps = (await storage.apps) || [];
  if (isUpdate) {
    const target = apps.find(
      (a) =>
        (a.appId && a.appId === payload.appId) ||
        (a.name && a.name === existingRecord.name),
    );
    if (target) {
      target.desc = pkg.meta.description || target.desc || "";
      if (!target.appId) target.appId = payload.appId;
      // 记录本次安装内容对应的分享清单哈希，供"无改动秒跳"比对
      target.fileHash = payload.fileHash || target.fileHash || "";
      if (payloadHash) target.payloadHash = payloadHash;
      await storage.setItem("apps", apps);
    }
  } else {
    apps.push({
      name: recordName,
      desc: pkg.meta.description || "",
      handle: null,
      dirName: `mazmot-apps/${recordName}`,
      source: "virtual",
      namespace: "mazmot-apps",
      appId: pkg.meta.appId,
      fileHash: payload.fileHash || "",
      payloadHash: payloadHash || "",
      createdAt: Date.now(),
    });
    await storage.setItem("apps", apps);
  }

  return recordName;
}
