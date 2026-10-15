/* ---------- 数据备份与回合快照（client/ 同层 backup/ 与 snaps/ 目录） ----------
 * 备份清单（只含发布与用户主动备份）、智能备份（AI 生成标题/备注）、发布到
 * 首页应用列表（含 P2P 分享）、变更卡的回合 diff 与一键回滚（回滚通知经
 * res.pendingRollback 注入下回合提示词）。
 */

import {
  sweepLegacyAutoBackups,
  listAppBackups,
  currentAppHash,
  currentAppFiles,
  readBackupFiles,
  createAppBackup,
  deleteAppBackup,
  renameAppBackup,
  setBackupNote,
  restoreAppBackup,
  publishAppToHome,
  PUBLISH_NAMESPACE,
  readAppFile,
} from "../builder.js";
import { diffLines, compactHunks } from "../diff.js";

export function createBackupsPart(api) {
  const { state, set, setMany, fs, mazmotStore, load, res } = api;

  // 当前应用对应的备份根句柄：本地渠道恢复句柄（只读列出 / 写入用），虚拟渠道 null
  async function backupRootHandle() {
    if (state.currentAppMode !== "local") return null;
    if (!res.localRootHandle) {
      res.localRootHandle =
        (await api.getLocalHandleFromRecord(state.currentAppName)) || null;
      if (res.localRootHandle) set("localDirLabel", res.localRootHandle?.name || "");
    }
    return res.localRootHandle;
  }

  // 读当前应用在 mazmot apps[] 登记记录里的发布态（mazmot 子对象，无则 null）
  async function readPublishedMeta() {
    if (!mazmotStore || state.currentAppName === "") return null;
    try {
      const apps = (await mazmotStore.getItem("apps")) || [];
      const rec = apps.find(
        (a) => a.mazmot?.source === "ai-builder" && a.name === state.currentAppName,
      );
      return rec?.mazmot?.published ? rec.mazmot : null;
    } catch {
      return null;
    }
  }

  // 同步发布态到页面状态（顶栏发布按钮提示；切应用 / 发布后调用）
  async function syncPublishedInfo() {
    const meta = await readPublishedMeta();
    set(
      "publishedInfo",
      meta ? { version: meta.publishedVersion, at: meta.publishedAt } : null,
    );
  }

  // 计算发布内容与当前代码的一致性（打开发布气泡时调用）：
  // publishMatch = true（已是当前代码）/ false（有未发布的修改）/ null（未知）；
  // 同时解析发布副本的 P2P 分享链接（优先用上次发布记住的，否则按副本
  // payloadHash 现场拼装）
  async function refreshPublishState() {
    await syncPublishedInfo();
    let match = null;
    let shareUrl = "";
    if (state.publishedInfo && fs && state.currentAppName !== "") {
      try {
        const rootHandle = await backupRootHandle();
        const meta = await readPublishedMeta();
        const hash = await currentAppHash(fs, state.currentAppName, rootHandle);
        match = hash !== "" && meta?.publishedHash === hash;
      } catch {
        match = null;
      }
      try {
        const shareMgr = await api.ensureShareMod();
        const meta = await readPublishedMeta();
        if (meta?.publishedShare?.shareUrl) {
          shareUrl = meta.publishedShare.shareUrl;
        } else if (meta?.publishedName) {
          const apps = (await mazmotStore.getItem("apps")) || [];
          const home = apps.find(
            (a) =>
              a.namespace === PUBLISH_NAMESPACE &&
              a.name === meta.publishedName &&
              a.mazmot?.source === "conjure-publish",
          );
          if (home?.payloadHash) {
            const { userId } = await shareMgr.ensureUser();
            shareUrl = shareMgr.buildRunUrl(
              location.origin,
              userId,
              home.payloadHash,
            );
          }
        }
      } catch (err) {
        console.warn("[publish] 分享链接解析失败：", err);
        shareUrl = "";
      }
    }
    setMany({ publishMatch: match, publishShareUrl: shareUrl });
  }

  async function refreshBackups() {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      // 历史版本把回合快照混进了 backup/：顺手清扫（纯快照删除，被发布
      // 流程复用标注过的保留），备份管理从此只有发布与用户主动备份
      try {
        await sweepLegacyAutoBackups(fs, state.currentAppName, rootHandle);
      } catch {
        /* 清扫失败不影响清单读取 */
      }
      // listAppBackups 返回 { id, label, note }；当前内容指纹与 id 尾部 hash
      // 一致的项标记 current（即「这份备份就是现在的内容」）；内容指纹命中
      // 发布记录 publishedVersions 的项带 publishedVersion（「已发布 vX.Y.Z」徽标）
      const hash = await currentAppHash(fs, state.currentAppName, rootHandle);
      const list = await listAppBackups(fs, state.currentAppName, rootHandle);
      const publishedVersions =
        (await readPublishedMeta())?.publishedVersions || {};
      set("currentHash", hash);
      set(
        "backups",
        list.map((b) => ({
          ...b,
          current: hash !== "" && b.id.endsWith(`-${hash}`),
          publishedVersion: publishedVersions[b.id.slice(-8)] || "",
        })),
      );
    } catch (err) {
      console.warn("读取备份列表失败：", err);
    }
  }

  // 发布当前应用到首页应用列表（复制 client/ 到 mazmot-apps/<发布名>/）；
  // 发布成功同时在备份管理打一条带正式版本号标注的备份（已有同内容备份
  // 且用户未命名时也补标注，不覆盖用户自定义名称）
  async function publishCurrent(bump) {
    if (state.publishBusy || state.currentAppName === "" || !fs) return null;
    set("publishBusy", true);
    try {
      // 当前用户 userId：副本记录的 appId 用（首页「我开发的」标记）
      let userId = "";
      try {
        const shareMgr = await api.ensureShareMod();
        userId = (await shareMgr.ensureUser()).userId;
      } catch (err) {
        console.warn("[publish] 获取用户失败（appId 省略）：", err);
      }
      const rootHandle = await backupRootHandle();
      const res2 = await publishAppToHome(
        fs,
        mazmotStore,
        state.currentAppName,
        rootHandle,
        { userId, bump },
      );
      try {
        const backup = await createAppBackup(
          fs,
          state.currentAppName,
          rootHandle,
        );
        await refreshBackups(); // AI 标注的「上一版」对比要基于最新备份清单
        // 发布备份走智能备份的 AI 标注（标题 + 备注）——裸日期看不出这版
        // 发了什么；AI 失败 / 没产出标题 / 幂等重发时回退「发布 vX.Y.Z」标注
        let labeled = "";
        if (!backup.skipped) {
          try {
            labeled = (await applySmartBackupMeta(backup.id, rootHandle)).label;
          } catch (err) {
            console.warn("[publish] 发布备份 AI 标注失败：", err);
          }
        }
        if (!labeled) {
          const list = await listAppBackups(fs, state.currentAppName, rootHandle);
          const hit = list.find((b) => b.id === backup.id);
          if (!hit?.label) {
            await renameAppBackup(
              fs,
              state.currentAppName,
              backup.id,
              `发布 v${res2.version}`,
            );
          }
        }
      } catch (err) {
        // 备份标注失败不影响发布结果
        console.warn("[publish] 发布备份标注失败：", err);
      }
      // P2P 分享发布：把副本发布到分享网络并回写 payloadHash，分享链接
      // 立即可用；失败不阻断发布（主系统列表打开时 autoShare 会自动重试）
      let shareUrl = "";
      try {
        const shareMgr = await api.ensureShareMod();
        const publishRoot = await fs.init(PUBLISH_NAMESPACE);
        const copyHandle = await publishRoot.get(res2.publishName);
        const apps = (await mazmotStore.getItem("apps")) || [];
        const home = apps.find(
          (a) =>
            a.namespace === PUBLISH_NAMESPACE &&
            a.name === res2.publishName &&
            a.mazmot?.source === "conjure-publish",
        );
        const { shareUrl: url, payloadHash, fileHash } =
          await shareMgr.publishApp(
            {
              source: "virtual",
              namespace: PUBLISH_NAMESPACE,
              name: res2.publishName,
              virtualDirName: res2.publishName,
              dirName: `${PUBLISH_NAMESPACE}/${res2.publishName}`,
              version: res2.version,
              desc: home?.desc || "",
              icon: home?.icon || "📦",
              _recordName: res2.publishName,
              _handle: copyHandle,
            },
            { appId: home?.appId || undefined },
          );
        shareUrl = url;
        if (home) {
          home.payloadHash = payloadHash;
          home.fileHash = fileHash || "";
        }
        const src = apps.find(
          (a) =>
            a.mazmot?.source === "ai-builder" &&
            a.name === state.currentAppName,
        );
        if (src) {
          src.mazmot = {
            ...src.mazmot,
            publishedShare: { payloadHash, shareUrl, at: Date.now() },
          };
        }
        await mazmotStore.setItem("apps", apps);
        set("publishShareUrl", shareUrl);
      } catch (err) {
        console.warn("[publish] 分享发布失败（首页列表会自动重试）：", err);
        set("publishShareUrl", "");
      }
      await syncPublishedInfo();
      await refreshBackups(); // 发布版本的指纹徽标 / 备份标注即刻反映到备份清单
      set("publishMatch", true);
      return res2;
    } catch (err) {
      set("keyError", `发布失败：${err.message}`);
      return null;
    } finally {
      set("publishBusy", false);
    }
  }

  async function createBackup() {
    if (state.backupBusy || state.currentAppName === "" || !fs) return;
    set("backupBusy", true);
    try {
      const rootHandle = await backupRootHandle();
      const res2 = await createAppBackup(fs, state.currentAppName, rootHandle);
      await refreshBackups();
      return res2;
    } catch (err) {
      set("keyError", `创建备份失败：${err.message}`);
    } finally {
      set("backupBusy", false);
    }
  }

  // 智能备份的 AI 阶段：对比当前与上一版备份，生成备份标题与变更备注
  async function generateBackupMeta(currentFiles, prevFiles) {
    if (!res.aiModules) res.aiModules = await load("/mz/ai/main.js");
    const { assistant, model } = await api.pickAssistant();
    const clip = (t) =>
      t.length > 2500 ? `${t.slice(0, 2500)}\n…（过长截断）` : t;
    const prevMap = new Map(prevFiles.map((f) => [f.path, f.text]));
    const curMap = new Map(currentFiles.map((f) => [f.path, f.text]));
    const parts = [];
    for (const f of currentFiles) {
      if (!prevMap.has(f.path)) {
        parts.push(`[新增文件] ${f.path}\n${clip(f.text)}`);
      } else if (prevMap.get(f.path) !== f.text) {
        parts.push(
          `[修改文件] ${f.path}\n--- 新版 ---\n${clip(f.text)}\n--- 旧版 ---\n${clip(prevMap.get(f.path))}`,
        );
      }
    }
    for (const f of prevFiles) {
      if (!curMap.has(f.path)) parts.push(`[删除文件] ${f.path}`);
    }
    const hasPrev = prevFiles.length > 0;
    const diffText =
      parts.join("\n\n") || "（两个版本内容没有文件级差异）";

    const system = `你是软件版本发布助手。根据用户提供的应用文件差异，输出备份的标题与备注。
要求：
1. 只输出一个 JSON 对象，格式：{"label":"...","note":"..."}，不要输出任何其他内容或代码块标记。
2. label：备份标题，不超过 16 字，概括这个版本的主题（如「任务清单页」）；首个备份则概括应用功能。
3. note：不超过 120 字的中文备注${hasPrev ? "，说明相比上一版新增了什么功能、少了/移除了什么功能" : "，简要介绍应用包含的功能"}；用「新增：…；移除：…」结构化表述，无对应项可省略。`;
    const res2 = await assistant.chat({
      ...(model ? { model } : {}),
      thinking: false,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `文件差异：\n\n${diffText}` },
      ],
    });
    const raw = String(res2.content || "").trim();
    const m = /\{[\s\S]*\}/.exec(raw);
    let out = {};
    try {
      out = JSON.parse(m ? m[0] : raw) || {};
    } catch {
      // 解析失败退化为把整段回复当备注
      out = { note: raw.slice(0, 200) };
    }
    return {
      label: String(out.label || "").trim().slice(0, 50),
      note: String(out.note || "").trim().slice(0, 200),
    };
  }

  // 智能备份的 AI 标注段（smartBackup 与发布备份共用）：对比上一版备份生成
  // 标题与备注并写入 meta。返回 { label, note }（都可能为空串——AI 没产出时
  // 由调用方兜底）。须先 refreshBackups：「上一版」取自最新备份清单
  async function applySmartBackupMeta(id, rootHandle) {
    const prev = state.backups.find((b) => b.id !== id);
    const currentFiles = await currentAppFiles(fs, state.currentAppName, rootHandle);
    const prevFiles = prev
      ? await readBackupFiles(fs, state.currentAppName, prev.id, rootHandle)
      : [];
    const { label, note } = await generateBackupMeta(currentFiles, prevFiles);
    if (label) {
      await renameAppBackup(fs, state.currentAppName, id, label, rootHandle);
    }
    if (note) {
      await setBackupNote(fs, state.currentAppName, id, note, rootHandle);
    }
    return { label, note };
  }

  // 智能备份：打包当前版本后，用 AI 对比上一版生成标题与备注并写入备份 meta。
  // 返回 { id, label, note }；内容无变化时返回 { skipped: true }
  async function smartBackup() {
    if (state.backupBusy || state.currentAppName === "" || !fs) return;
    set("backupBusy", true);
    set("smartBackupBusy", true);
    try {
      const rootHandle = await backupRootHandle();
      const res2 = await createAppBackup(fs, state.currentAppName, rootHandle);
      await refreshBackups();
      if (res2?.skipped) return { skipped: true };
      const { label, note } = await applySmartBackupMeta(res2.id, rootHandle);
      await refreshBackups();
      return { id: res2.id, label, note };
    } catch (err) {
      set("keyError", `智能备份失败：${err.message}`);
    } finally {
      set("backupBusy", false);
      set("smartBackupBusy", false);
    }
  }

  async function deleteBackup(id) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await deleteAppBackup(fs, state.currentAppName, id, rootHandle);
      await refreshBackups();
    } catch (err) {
      set("keyError", `删除备份失败：${err.message}`);
    }
  }

  // 备份更名：写入备份目录内 __meta.json 的 label（目录名/内容寻址不变）
  async function renameBackup(id, label) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await renameAppBackup(fs, state.currentAppName, id, label, rootHandle);
      await refreshBackups();
      return true;
    } catch (err) {
      set("keyError", `备份更名失败：${err.message}`);
    }
  }

  // 设置 / 清除备份备注（空串清除），存 __meta.json 的 note
  async function setNote(id, note) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      await setBackupNote(fs, state.currentAppName, id, note, rootHandle);
      await refreshBackups();
      return true;
    } catch (err) {
      set("keyError", `设置备注失败：${err.message}`);
    }
  }

  // 还原备份：内容无变动返回 { reason: "unchanged" }，失败返回 undefined
  async function restoreBackup(id) {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await backupRootHandle();
      return await restoreAppBackup(fs, state.currentAppName, id, rootHandle);
    } catch (err) {
      set("keyError", `还原备份失败：${err.message}`);
    }
  }

  /* ---------- 变更卡：回合 diff 与一键回滚 ---------- */

  // 变更卡展开：快照（该回合开始前）vs 当前盘上指定文件的行级 diff。
  // 历史回合展开时当前盘可能含后续回合改动（diff 随时间漂移，UI 如实标注）
  async function getTurnDiff(appName, snapshotId, path) {
    try {
      const hit = state.apps.find((a) => a.name === appName);
      const handle = hit?.mode === "local" ? res.localRootHandle : undefined;
      const files = await readBackupFiles(fs, appName, snapshotId, handle);
      const prev = files.find((f) => f.path === path)?.text ?? "";
      const cur = (await readAppFile(fs, appName, path, handle)) ?? "";
      if (prev === cur) return { hunks: [], same: true };
      return { hunks: compactHunks(diffLines(prev, cur), 3), same: false };
    } catch (err) {
      return { hunks: [], same: false, error: err.message };
    }
  }

  // 一键回滚到回合前快照（restoreAppBackup 清空 client/ 后按备份写回；
  // unchanged = 当前内容与快照一致未写入）。opts.sentiment："neutral"（默认）
  // / "dissatisfied"（用户对该回合改动不满意）；opts.requestText 为该回合的
  // 用户请求摘要（不满意通知里带给模型，让它知道否决的是哪次改动）。
  // 回滚后失效 Agent 并登记待消费通知——下次对话（同应用）注入「回滚通知」，
  // AI 感知回滚与反馈，不凭旧记忆把撤销的内容写回
  async function rollbackTurn(appName, snapshotId, opts = {}) {
    const hit = state.apps.find((a) => a.name === appName);
    const handle = hit?.mode === "local" ? res.localRootHandle : undefined;
    const res2 = await restoreAppBackup(fs, appName, snapshotId, handle);
    res.pendingRollback = {
      appName,
      sentiment: opts.sentiment === "dissatisfied" ? "dissatisfied" : "neutral",
      requestText: String(opts.requestText || "").slice(0, 120),
    };
    api.invalidateAgent();
    try {
      await api.syncAppMetaFromDisk(appName);
    } catch {
      /* meta 同步失败不阻塞回滚结果 */
    }
    await refreshBackups();
    return res2;
  }

  return {
    backupRootHandle,
    refreshPublishState,
    refreshBackups,
    publishCurrent,
    createBackup,
    smartBackup,
    deleteBackup,
    renameBackup,
    setNote,
    restoreBackup,
    getTurnDiff,
    rollbackTurn,
  };
}
