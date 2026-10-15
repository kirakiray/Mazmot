/* ---------- 发送与回合收尾（含流式事件 → 消息变更映射） ----------
 * 发送主流程（send / resendLastUser / 表单恢复回合共用 driveTurn）、项目
 * 即建（createProjectNow）、回合收尾落盘（finishTurn）、新应用落地
 * （adoptNewApp）、元数据回填（syncAppMetaFromDisk / updateAppMeta）、
 * 停止（stop）。流式事件段把 chain 层事件映射为消息桶的细粒度变更：
 * 回合统计/用量以「单载体」落到末条 AI 消息，防止工具循环换气泡重复累计。
 * 回合全程以发送时固定的 chatKey 为准，与用户当前正查看哪个会话无关。
 */

import {
  sanitizeAppName,
  createAppDir,
  registerAppRecord,
  buildAppRecord,
  buildLocalAppRecord,
  validateApp,
  readAppFile,
  updateAppMeta as writeAppMetaToDisk,
  contextInfo,
  syncAppManifest,
  createAppBackup,
  pruneAppSnaps,
} from "../builder.js";
import { diffLines, diffStat, compactHunks } from "../diff.js";

/* ---------- 接口请求自动重试（限流 / 5xx / 断网等瞬时错误） ---------- */

// 单回合最多自动重试次数（超出按失败收尾，用户仍可手动「继续」）
const MAX_CHAT_RETRIES = 3;
// 第 n 次重试前等待 n × 3 秒（3s / 6s / 9s），给限流与上游抖动留恢复时间
const CHAT_RETRY_STEP_SEC = 3;

// 是否值得自动重试：供应商 HTTP 错误按状态码分流（鉴权 / 参数类重试也无益，
// 立即收尾）；网络层失败（断网 / DNS / 超时）没有状态码，按可重试处理；
// 用户停止（AbortError / 已停止生成）绝不重试
const isRetryableChatError = (error) => {
  if (!error) return false;
  if (error.name === "AbortError") return false; // 用户中止
  if (error.name === "TimeoutError") return true; // 请求超时
  const msg = String(error.message || "");
  if (msg.includes("已停止生成")) return false;
  const status = Number(/API error: (\d{3})/.exec(msg)?.[1]);
  if (Number.isFinite(status) && status > 0) {
    // 408 请求超时 / 425 过早 / 429 限流 / 5xx 服务端错误 / 529 上游过载
    return [408, 425, 429, 500, 502, 503, 504, 529].includes(status);
  }
  return /fetch failed|failed to fetch|network ?error|load failed|econn|etimedout|enotfound|epipe|socket|timed? ?out|timeout|getaddrinfo|temporary failure/i.test(
    msg,
  );
};

export function createTurnPart(api) {
  const {
    state,
    set,
    setMany,
    fs,
    mazmotStore,
    selfStore,
    res,
    msgEvent,
    sessionBuckets,
    bucketFor,
    viewKey,
    activeKey,
    pushMessage,
    patchMessage,
    removeMessage,
    scheduleSave,
    setTurnKey,
    markBusy,
  } = api;

  /* ---------- 项目即建与元数据回填 ---------- */

  // 用户在草稿态发出第一条消息：**立即**创建项目（目录 + 登记 + 切换上下文 +
  // 首个会话），不等回合结束——中断 / 关页的回合也归属项目，下次进来接着迭代，
  // 草稿桶不再积攒半成品对话
  async function createProjectNow(text) {
    const isLocal = state.storageMode === "local" && !!res.localRootHandle;
    // 应用名从请求文本取 slug；中文等取不出时用时间戳兜底（模型稍后会写入
    // 正式的 app.json，元数据经 syncAppMetaFromDisk 回填）
    const clean = sanitizeAppName(text) || `app-${Date.now().toString(36)}`;
    const displayName = String(text || "").trim().slice(0, 24) || clean;
    await createAppDir(
      fs,
      { name: clean, displayName, description: "", icon: "📦" },
      isLocal ? res.localRootHandle : undefined,
    );

    // mazmot 登记：本地句柄必须尽早落库，否则刷新后无法恢复授权
    if (mazmotStore) {
      try {
        await registerAppRecord(
          mazmotStore,
          isLocal
            ? buildLocalAppRecord({
                appName: clean,
                displayName,
                icon: "📦",
                handle: res.localRootHandle,
              })
            : buildAppRecord({ appName: clean, displayName, icon: "📦" }),
        );
      } catch (err) {
        console.warn("登记应用记录失败：", err);
      }
    }

    // registry + 首个会话；同名项目已存在（如同类需求重建）时并入为新会话
    const reg = await api.loadRegistry();
    const sid = `s${Date.now().toString(36)}`;
    const hit = reg.find((a) => a.name === clean);
    const session = {
      id: sid,
      title: String(text || "").trim().slice(0, 24) || "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (hit) {
      hit.mode = isLocal ? "local" : hit.mode;
      hit.sessions = hit.sessions || [];
      hit.sessions.push(session);
    } else {
      reg.push({
        name: clean,
        displayName,
        icon: "📦",
        mode: isLocal ? "local" : "vfs",
        createdAt: Date.now(),
        sessions: [session],
      });
    }
    await api.saveRegistry(reg);
    await api.reloadApps();
    await api.applyApp(hit || reg.find((a) => a.name === clean));
    set("currentSessionId", sid);
    api.syncSessionTitle(reg);
    res.freshTurn = { appName: clean, sid };
  }

  // 模型覆写 app.json 后，用盘上真实元数据回填 registry 与当前视图
  //（占位的 displayName/icon 在项目创建后很快被正式值替换）
  async function syncAppMetaFromDisk(appName) {
    if (!fs) return;
    try {
      const isLocal = state.currentAppMode === "local" && !!res.localRootHandle;
      const raw = await readAppFile(
        fs,
        appName,
        "app.json",
        isLocal ? res.localRootHandle : undefined,
      );
      if (!raw) return;
      const meta = JSON.parse(raw);
      const reg = await api.loadRegistry();
      const hit = reg.find((a) => a.name === appName);
      if (!hit) return;
      const display = String(meta.displayName || "").trim();
      const icon = String(meta.icon || "").trim();
      let changed = false;
      if (display && display !== hit.displayName) {
        hit.displayName = display;
        changed = true;
      }
      if (icon && icon !== hit.icon) {
        hit.icon = icon;
        changed = true;
      }
      if (!changed) return;
      await api.saveRegistry(reg);
      await api.reloadApps();
      if (state.currentAppName === appName) {
        set("currentAppDisplay", hit.displayName || appName);
        set("currentAppIcon", hit.icon || "📦");
      }
    } catch (err) {
      console.warn("回填项目元数据失败：", err);
    }
  }

  // 手动修改应用信息（名称 / 图标，顶栏铅笔入口）：写回 client/app.json 后走
  // syncAppMetaFromDisk 统一回填登记表与顶栏展示。对话生成中不允许改——模型
  // 同回合可能也在写 app.json，两边互踩；改完 invalidateAgent 让下回合提示词
  // 用新名称
  async function updateAppMeta(patch) {
    if (state.sending) return { ok: false, reason: "sending" };
    if (state.currentAppName === "" || !fs) return { ok: false, reason: "draft" };
    const isLocal = state.currentAppMode === "local" && !!res.localRootHandle;
    let res2;
    try {
      res2 = await writeAppMetaToDisk(
        fs,
        state.currentAppName,
        isLocal ? res.localRootHandle : undefined,
        patch,
      );
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    await syncAppMetaFromDisk(state.currentAppName);
    api.invalidateAgent();
    return { ok: true, ...res2 };
  }

  /* ---------- 发送前准备 ---------- */

  // 发送前确保落点就绪：草稿需本地句柄；已选应用需会话（无则自动新建）
  async function prepareContext(text) {
    if (state.currentAppName === "") {
      if (state.storageMode === "local" && !res.localRootHandle) {
        const ok = await api.chooseLocalDir();
        if (!ok) {
          set("storageMode", "vfs");
          api.invalidateAgent();
        }
      }
      // 选中的目录是既有项目：chooseLocalDir 已自动导入并切换应用，
      // 不返回草稿，继续走下方既有应用的会话准备流程
      if (state.currentAppName === "") {
        // 用户一开口即建项目（方案定稿：项目存在先于对话结束）
        await createProjectNow(text);
        return `${state.currentAppName}:${state.currentSessionId}`;
      }
    }
    if (state.currentSessionId === "") {
      const reg = await api.loadRegistry();
      const hit = reg.find((a) => a.name === state.currentAppName);
      if (!hit) throw new Error("当前应用记录已不存在");
      const sid = `s${Date.now().toString(36)}`;
      hit.sessions = hit.sessions || [];
      hit.sessions.push({
        id: sid,
        title: text.slice(0, 24) || "新对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await api.saveRegistry(reg);
      await api.reloadApps();
      set("currentSessionId", sid);
      api.syncSessionTitle();
      set("sessionTasks", []); // 新会话从空清单开始
    } else {
      // 「＋ 新对话」预建的空会话：首条消息发出即把占位标题换成首句摘要
      //（不等回合收尾，左侧标签与顶栏立刻跟随）；fork/导入等带真实标题的
      // 会话不动
      const reg = await api.loadRegistry();
      const hit = reg.find((a) => a.name === state.currentAppName);
      const ses = hit?.sessions?.find((s) => s.id === state.currentSessionId);
      if (ses && (!ses.title || ses.title === "新对话")) {
        ses.title = text.slice(0, 24) || "新对话";
        ses.updatedAt = Date.now();
        await api.saveRegistry(reg);
        await api.reloadApps();
        set("currentSessionTitle", ses.title);
      }
    }
    // 本地渠道句柄可能因切换应用 / 刷新丢失，从记录恢复；
    // 句柄还在时先尝试补授权（requestPermission），失败才回退重选目录
    if (state.currentAppMode === "local") {
      if (!res.localRootHandle) {
        res.localRootHandle = await api.getLocalHandleFromRecord(
          state.currentAppName,
        );
        if (res.localRootHandle) {
          set("localDirLabel", res.localRootHandle?.name || "");
        }
      }
      if (res.localRootHandle) {
        const granted = await api.ensureLocalPermission(res.localRootHandle);
        if (!granted) {
          const ok = await api.chooseLocalDir();
          if (!ok) throw new Error("本地目录不可用，无法继续开发");
        }
      } else {
        const ok = await api.chooseLocalDir();
        if (!ok) throw new Error("本地目录不可用，无法继续开发");
      }
      api.invalidateAgent(); // 工具闭包需要新句柄
    }
    return `${state.currentAppName}:${state.currentSessionId}`;
  }

  /* ---------- 回合收尾与新应用落地 ---------- */

  // 回合收尾：落盘会话、（若本轮创建了应用）迁移草稿 → 注册 → 出预览卡片
  // 全程以回合所属 chatKey（发送时固定）为准，与用户当前正查看哪个会话无关
  async function finishTurn(firstUserText, threadId, elapsedMs = 0) {
    if (!selfStore) return;
    const chatKey = threadId === "draft" ? "chat:draft" : `chat:${threadId}`;
    // 会话桶已在中途被删除（删除会话/应用时丢弃实时桶）：跳过落盘
    if (!sessionBuckets.has(chatKey)) return;

    // 发送时即创建的全新项目：首回合结束出预览卡片（卡片须在快照前入桶，
    // 随会话一起落盘；中断 / 出错的回合同样出卡——项目与文件现状如实呈现）
    if (res.freshTurn && threadId === `${res.freshTurn.appName}:${res.freshTurn.sid}`) {
      res.freshTurn = null;
      // 首回合的「空项目生成」agent 到此为止：重建后后续回合换常规
      // 「已存在应用」提示词与完整工具清单
      api.invalidateAgent();
      const isLocal = state.currentAppMode === "local" && !!res.localRootHandle;
      let check = { ready: false, missing: [] };
      try {
        check = await validateApp(
          fs,
          state.currentAppName,
          isLocal ? res.localRootHandle : undefined,
        );
      } catch (err) {
        console.warn("校验新项目失败：", err);
      }
      pushMessage({
        id: state.nextId++,
        role: "app",
        appName: state.currentAppName,
        displayName: state.currentAppDisplay,
        icon: state.currentAppIcon,
        mode: state.currentAppMode,
        ready: check.ready,
        missing: check.missing,
        newGroup: false,
      });
    }

    // 本轮创建了新应用：草稿回合把草稿会话迁移为该应用的第一个会话；
    // 既有会话里 AI 另建新应用（create_app）时只登记 + 在本会话出预览卡片
    // ——不迁移会话（会搬走用户当前正查看的对话）、不强制切视图（会把用户
    // 刚切换到的视图拽走：回合进行中切走再切回，表象即「对话消失 / 会话
    // 被顶替」）。卡片入桶后不 return，落入下方正常落盘与会话收尾
    if (res.pendingNewApp) {
      const info = res.pendingNewApp;
      res.pendingNewApp = null;
      if (chatKey === "chat:draft") {
        await adoptNewApp(info, firstUserText, chatKey, elapsedMs);
        await api.syncLocalProjectChats(info.appName);
        return;
      }
      await adoptNewApp(info, firstUserText, chatKey, elapsedMs, {
        migrate: false,
      });
    }

    await selfStore.setItem(
      chatKey,
      bucketFor(chatKey).map((m) => ({ ...m })),
    );

    // 更新会话标题与时间（应用/会话取自回合的 threadId，不受当前视图影响）
    const [appName, sid] = threadId === "draft" ? ["", ""] : threadId.split(":");
    if (appName && sid) {
      const reg = await api.loadRegistry();
      const app = reg.find((a) => a.name === appName);
      const ses = app?.sessions?.find((s) => s.id === sid);
      if (ses) {
        if (!ses.title || ses.title === "新对话") {
          ses.title = firstUserText.slice(0, 24) || "新对话";
        }
        ses.updatedAt = Date.now();
        // 累计本回合对话耗时（会话从创建到现在的所有回合时长之和）
        ses.duration = (ses.duration || 0) + (elapsedMs || 0);
        await api.saveRegistry(reg);
        await api.reloadApps();
        if (
          state.currentAppName === appName &&
          state.currentSessionId === sid
        ) {
          api.syncSessionTitle();
        }
      }
      // 兜底：记录缺失（历史会话/旧版本创建）时补登记，保证句柄可恢复
      await api.ensureAppRegistered(appName);
    }
    // 本地渠道：回合结束把对话快照写入项目目录（conjure-chats/ 目录，
    // 只重写本会话的文件），供下次选择该目录时走导入流程恢复对话数据
    if (appName) await api.syncLocalProjectChats(appName, sid || null);

    // 本回合有文件写入：同步 client/__app.json 安装清单（文件增删自动
    // bump app.json 版本，AI 无须感知）；失败不阻塞收尾
    if (fs && appName && res.turnChanges.length > 0) {
      try {
        await syncAppManifest(
          fs,
          appName,
          state.currentAppName === appName && state.currentAppMode === "local"
            ? res.localRootHandle
            : undefined,
        );
      } catch (err) {
        console.warn("[builder] 同步 __app.json 失败：", err);
      }
    }
  }

  // 新应用落地：注册（mazmot apps[] + 本应用 registry）、迁移草稿会话、出预览卡片
  // draftKey：本轮回合所属的草稿 chatKey，消息从其实时桶迁移（不读盘）
  async function adoptNewApp(
    info,
    firstUserText,
    draftKey,
    elapsedMs = 0,
    { migrate = true } = {},
  ) {
    const isLocal = info.mode === "local" && !!res.localRootHandle;
    const check = await validateApp(
      fs,
      info.appName,
      isLocal ? res.localRootHandle : undefined,
    );

    // 创建即登记（不等文件齐全）：本地句柄必须随记录尽早落库，
    // 否则刷新后无法恢复授权、被迫重新选择目录
    if (mazmotStore) {
      try {
        await registerAppRecord(
          mazmotStore,
          isLocal
            ? buildLocalAppRecord({ ...info, handle: res.localRootHandle })
            : buildAppRecord(info),
        );
      } catch (err) {
        console.warn("登记应用记录失败：", err);
      }
    }

    if (!migrate) {
      // 既有会话里另建的新应用：登记进项目列表即可（无会话），预览卡片出在
      // 产生它的当前会话里（pushMessage 落回合桶）；不迁移消息、不切视图
      const reg = await api.loadRegistry();
      if (!reg.find((a) => a.name === info.appName)) {
        reg.push({
          name: info.appName,
          displayName: info.displayName,
          icon: info.icon,
          mode: isLocal ? "local" : "vfs",
          createdAt: Date.now(),
          sessions: [],
        });
        await api.saveRegistry(reg);
      }
      await api.reloadApps();
      pushMessage({
        id: state.nextId++,
        role: "app",
        appName: info.appName,
        displayName: info.displayName,
        icon: info.icon,
        mode: isLocal ? "local" : "vfs",
        ready: check.ready,
        missing: check.missing,
        newGroup: false,
      });
      // 本回合 AI 已往新应用写文件：收口一次清单（createAppDir 只生成初始）
      try {
        await syncAppManifest(fs, info.appName, isLocal ? res.localRootHandle : undefined);
      } catch (err) {
        console.warn("[builder] 同步 __app.json 失败：", err);
      }
      return;
    }

    // registry + 第一个会话；草稿消息与 Agent 记忆迁移过去
    const reg = await api.loadRegistry();
    const sid = `s${Date.now().toString(36)}`;
    const existed = reg.find((a) => a.name === info.appName);
    const session = {
      id: sid,
      title: firstUserText.slice(0, 24) || "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      duration: elapsedMs || 0,
    };
    if (existed) {
      existed.sessions = existed.sessions || [];
      existed.sessions.push(session);
    } else {
      reg.push({
        name: info.appName,
        displayName: info.displayName,
        icon: info.icon,
        mode: isLocal ? "local" : "vfs",
        createdAt: Date.now(),
        sessions: [session],
      });
    }
    await api.saveRegistry(reg);

    if (selfStore) {
      // 消息桶迁移：草稿实时桶 → 新应用第一个会话桶（存储副本下面统一落盘）
      sessionBuckets.set(`chat:${info.appName}:${sid}`, [...bucketFor(draftKey)]);
      sessionBuckets.delete(draftKey);
      await selfStore.removeItem(draftKey);
      const oldThread = await selfStore.getItem("thread:draft");
      if (oldThread) {
        await selfStore.setItem(`thread:${info.appName}:${sid}`, oldThread);
        await selfStore.removeItem("thread:draft");
      }
    }

    // 切换到新应用上下文（目标随应用锁定）
    await api.applyApp(reg.find((a) => a.name === info.appName));
    set("currentSessionId", sid);
    api.syncSessionTitle(reg);
    // 回合指向新会话：预览卡片写入新桶并镜像到当前视图
    if (res.turnKey === draftKey) setTurnKey(`chat:${info.appName}:${sid}`);

    pushMessage({
      id: state.nextId++,
      role: "app",
      appName: info.appName,
      displayName: info.displayName,
      icon: info.icon,
      mode: isLocal ? "local" : "vfs",
      ready: check.ready,
      missing: check.missing,
      newGroup: false,
    });

    // 卡片入桶后统一落盘（含卡片在内的完整首会话）
    if (selfStore) {
      const newKey = `chat:${info.appName}:${sid}`;
      await selfStore.setItem(
        newKey,
        bucketFor(newKey).map((m) => ({ ...m })),
      );
    }
  }

  /* ---------- 流式事件 → 消息变更 ---------- */

  // 参数值的展示文本：长字符串（如 code）截断省略并标注长度；对象/数组展开为紧凑 JSON 再截断
  const prettyValue = (v) => {
    let text = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    if (text.length > 80) text = `${text.slice(0, 80)}…(${text.length} 字符)`;
    return text;
  };

  const prettyArgs = (raw) => {
    let obj = raw;
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (!obj || typeof obj !== "object") return String(obj);
    const text = Object.entries(obj)
      .map(([k, v]) => `${k} = ${prettyValue(v)}`)
      .join("，");
    return text || JSON.stringify(obj);
  };

  function newBubble() {
    const item = pushMessage({
      id: state.nextId++,
      role: "assistant",
      content: "",
      reasoning: "",
      model: res.activeModel,
      reasoningOpen: false, // 思考默认收起：头部只滚动展示最后一行，点击展开
      newGroup: false,
    });
    activeBubble = item;
    bubbleRTStart = turnUsage?.reasoning_tokens ?? 0;
    return item;
  }

  function handleStreamEvent(ev) {
    if (ev.type === "text" && (ev.delta || ev.deltaReasoning)) {
      const bubble = activeBubble ?? newBubble();
      const patch = {};
      if (ev.delta) {
        bubble.content += ev.delta;
        patch.content = bubble.content;
      }
      if (ev.deltaReasoning) {
        bubble.reasoning = (bubble.reasoning || "") + ev.deltaReasoning;
        patch.reasoning = bubble.reasoning;
      }
      patchMessage(bubble.id, patch);
    } else if (ev.type === "toolCalls") {
      // 气泡关闭：本模型调用的思考 token 增量落独立字段（turnUsage 为回合
      // 累计，差值即该次调用的思考消耗；统计聚合只读 usage，互不影响）
      if (activeBubble) {
        const rtDelta = (turnUsage?.reasoning_tokens ?? 0) - bubbleRTStart;
        if (rtDelta > 0) {
          patchMessage(activeBubble.id, { reasoningTokens: rtDelta });
        }
      }
      if (activeBubble && !activeBubble.content) {
        removeMessage(activeBubble.id);
      }
      activeBubble = null;
      for (const call of ev.toolCalls) {
        // args 可能是字符串（OpenAI 风格）或对象（部分供应商），统一转成
        // 展示用文本，避免模板直接渲染出 [object Object]
        const rawArgs = call.function?.arguments ?? call.args ?? "{}";
        let argsText = rawArgs;
        if (typeof rawArgs !== "string") {
          try {
            argsText = JSON.stringify(rawArgs, null, 2);
          } catch {
            argsText = String(rawArgs);
          }
        }
        pushMessage({
          id: state.nextId++,
          role: "tool",
          name: call.function?.name ?? call.name,
          args: argsText,
          summary: prettyArgs(argsText),
          result: "",
          pending: true,
          open: false,
          newGroup: false,
          toolCallId: call.id,
        });
      }
    } else if (ev.type === "usage" && ev.usage) {
      // 工具循环中间模型调用的实时快照：写进 state.liveTurnStats 供底部
      // 统计条即时刷新——不 patch 消息，模型不说话直接调工具的步同样有数据；
      // 最终数值随 done / 停止收尾落到回合末条 AI 消息（页面聚合时消息是
      // 「既往回合」，live 是「进行中回合」，两边相加不重复）
      turnUsage = ev.usage;
      turnStats = ev.stats || null;
      turnBreakdown = ev.contextBreakdown || null;
      set("liveTurnStats", {
        usage: { ...turnUsage },
        stats: turnStats ? { ...turnStats } : null,
        breakdown: turnBreakdown ? { ...turnBreakdown } : null,
      });
    } else if (ev.type === "toolResult") {
      const item = bucketFor(activeKey()).find(
        (m) => m.toolCallId === ev.toolCallId,
      );
      if (item) {
        item.result = ev.result;
        item.pending = false;
        patchMessage(item.id, { result: ev.result, pending: false });
      }
    } else if (ev.type === "done") {
      turnUsage = ev.usage || turnUsage;
      if (ev.stats) turnStats = ev.stats;
      if (ev.contextBreakdown) turnBreakdown = ev.contextBreakdown;
      const patch = turnPatchPayload();
      if (activeBubble) {
        if (ev.content) {
          activeBubble.content = ev.content;
          patch.content = ev.content;
        }
        // 用响应里的真实模型名回填徽标（随机 assistant 场景 provider 名只是兜底）
        if (ev.model) {
          activeBubble.model = ev.model;
          patch.model = ev.model;
        }
        Object.assign(activeBubble, patch);
        if (Object.keys(patch).length) carryTurnData(activeBubble.id, patch);
      } else if (ev.content || ev.usage) {
        const bubble = newBubble();
        bubble.content = ev.content || "";
        if (ev.model) bubble.model = ev.model;
        Object.assign(bubble, patch);
        patchMessage(bubble.id, {
          content: bubble.content,
          ...(ev.model ? { model: ev.model } : {}),
          ...patch,
        });
      }
    }
  }

  // 回合统计/用量 patch 载荷（usage 恒有；stats / contextBreakdown 有则带）
  function turnPatchPayload() {
    const patch = {};
    if (turnUsage) patch.usage = turnUsage;
    if (turnStats) patch.turnStats = turnStats;
    if (turnBreakdown) patch.contextBreakdown = turnBreakdown;
    return patch;
  }

  // 回合内用量/统计的单一载体：数据落到 carrier 消息，并剥掉本回合其它
  // assistant 消息上的同类字段（工具循环中途换气泡时防止聚合重复累计）
  function carryTurnData(carrierId, patch) {
    for (const m of bucketFor(res.turnKey)) {
      if (m.role !== "assistant" || m.id < turnFirstId || m.id === carrierId)
        continue;
      if (m.usage || m.turnStats || m.contextBreakdown) {
        delete m.usage;
        delete m.turnStats;
        delete m.contextBreakdown;
        patchMessage(m.id, {
          usage: null,
          turnStats: null,
          contextBreakdown: null,
        });
      }
    }
    const carrier = bucketFor(res.turnKey).find((m) => m.id === carrierId);
    if (carrier) Object.assign(carrier, patch);
    patchMessage(carrierId, patch);
  }

  /* ---------- 发送主流程 ---------- */

  // 发送主流程：落点准备 → 用户消息入列 → Agent 流式对话 → 回合收尾
  // currentAbort：本轮的中止信号；stop() 触发后置位并 abort 在途模型请求，
  // Agent 对话被中断，已产生的流式内容保留，回合照常收尾落盘（下次发送继续
  // 同一 thread）；turnUsage 暂存本轮最近一次模型调用的用量（停止收尾补挂）
  let currentAbort = null;
  let currentAbortCtrl = null;
  let turnUsage = null;
  // 当前气泡（模型调用）开始时的回合累计推理 token：气泡关闭时差值即
  // 本次思考消耗，落独立字段 reasoningTokens（统计聚合读 usage，互不影响）
  let bubbleRTStart = 0; // 本回合最近一次模型调用的用量快照（停止收尾补挂用）
  let turnStats = null; // 本回合执行统计快照（步数/模型用时/工具用时/TTFT/TPS 分母）
  let turnBreakdown = null; // 本回合上下文构成估算快照（系统提示词/工具定义/对话消息）
  let turnFirstId = 0; // 本回合第一条消息的 id 基线（单载体剥离只看本回合消息）
  // 本回合开始快照（createAppBackup 幂等内容寻址 id）：变更 diff 的旧侧 +
  // 一键回滚目标，收尾随 changes 一起挂到末条 AI 消息
  let turnSnapshotId = "";
  // 当前气泡（流式中的 AI 消息，非响应式；句柄进 state 会被响应式包装拆原型）
  let activeBubble = null;

  /**
   * 发送一条用户消息（可带图片，多模态）。
   * @param {string} text 文本内容（纯图片消息可为空串）
   * @param {string[]} images 图片 dataURL 列表（data:image/*；随消息持久化，
   *        wire 侧组装为 OpenAI content 数组——text + image_url 混排，由
   *        supplier 层原样透传给支持视觉的模型）
   */
  async function send(text, images = []) {
    const body = String(text ?? "").trim();
    const imgs = (Array.isArray(images) ? images : []).filter(
      (s) => typeof s === "string" && s.startsWith("data:image/"),
    );
    if (state.sending) return;
    if (!body && !imgs.length) return;
    if (!fs) {
      set("keyError", state.coreError);
      return;
    }

    let threadId;
    try {
      threadId = await prepareContext(body);
    } catch (err) {
      set("keyError", err.message);
      return;
    }

    // 本回合固定写自己的会话桶：此后无论用户切到哪个会话/项目，
    // 流式消息、落盘、收尾都以该 key 为准，不再随当前视图漂移
    setTurnKey(threadId === "draft" ? "chat:draft" : `chat:${threadId}`);
    if (!sessionBuckets.has(res.turnKey)) {
      sessionBuckets.set(res.turnKey, [...state.messages]);
    }
    res.turnStartAt = Date.now();
    markBusy(res.turnKey, true);

    setMany({ keyError: "" });
    // 用户消息记录发送时间 ts（聊天区 hover 展示）；图片随消息持久化
    pushMessage({
      id: state.nextId++,
      role: "user",
      content: body,
      ...(imgs.length ? { images: imgs } : {}),
      newGroup: true,
      ts: res.turnStartAt,
    });
    setMany({ turnStartTs: res.turnStartAt });

    // 上回合自动检测到预览错误：失效缓存 Agent，本回合重建提示词时带上
    //（ensureAgent 读 state.autoErrors 注入；driveTurn 开始时取走清空）
    if (state.autoErrors.length) api.invalidateAgent();
    // 存在待消费的回滚通知：失效 Agent 让本回合提示词带上；
    // driveTurn 开始时消费清除
    if (res.pendingRollback && res.pendingRollback.appName === state.currentAppName) {
      api.invalidateAgent();
    }
    // 上一回合已正常收尾（非中断续作）：先清空任务清单再建本回合 Agent。
    // 清单是「本回合进度」，跨回合沿用会挂着上一轮的全完成清单不动（实测
    // 第二轮对话面板不更新——注入的旧清单带着「全部 done 不必调用」条款，
    // 模型正好拿它当跳过 task_list 的理由）；清在 ensureAgent 之前，本回合
    // 提示词的任务节为空，由基础规则引导模型重建新清单。中断续作
    // （interrupted）保留清单——暂停/继续的「停在哪一步」展示依赖它
    if (!state.interrupted && api.sessionTasksKey()) {
      api.applySessionTasks([]);
      // 待修的运行错误重登记进新清单（提示词错误节声称宿主已登记）
      if (state.autoErrors.length) api.syncErrorTasks(state.autoErrors);
    }
    try {
      await api.ensureAgent();
    } catch {
      setTurnKey(null); // 回合未真正开始，回退到视图内联模式
      res.turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return;
    }

    set("sending", true);
    // 自动压缩：预计本轮输入会突破窗口时，先压缩记忆再开聊（失败不阻塞对话）
    try {
      const info = contextInfo(bucketFor(res.turnKey));
      const estimate = info.used + Math.ceil((body.length || 0) / 2) + 64;
      if (res.contextWindow > 0 && info.used > 0 && estimate >= res.contextWindow) {
        await api.compressThread(res.turnKey);
      }
    } catch (err) {
      console.warn("自动压缩上下文失败：", err);
    }
    // wire 侧多模态组装：有图片时 content 为 OpenAI 数组（text 部分仅在有文本
    // 时包含），无图片保持纯字符串（与历史消息一致）
    const wireContent = buildWireContent(body, imgs);
    await driveTurn(threadId, body, [{ role: "user", content: wireContent }]);
  }

  // OpenAI wire 消息组装（send 与编辑重发共用）：图片随 content 数组携带
  const buildWireContent = (body, imgs) =>
    imgs.length
      ? [
          ...(body ? [{ type: "text", text: body }] : []),
          ...imgs.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : body;

  /**
   * 编辑并重发末条用户消息（仅停止/完成后可调用，UI 已限定入口）。
   * 撤销最后一个回合：删除末条 user 之后的所有消息（AI 回复 / 工具记录）、
   * user 内容就地更新、Agent 记忆截断到该回合之前，再以新内容重新驱动回合。
   * 记忆截断按 wire 末条 user 定位而非 chat 侧序号——上下文压缩会改写
   * thread 头部的回合结构，序号对应不可靠；wire 末条 user 恒为最近一次发送。
   * 图片不可编辑（保留原消息的附件），仅文本可改。
   */
  async function resendLastUser(text) {
    const body = String(text ?? "").trim();
    if (state.sending) return { ok: false, reason: "sending" };
    const key = viewKey();
    const list = bucketFor(key);
    let userIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return { ok: false, reason: "no-user" };
    const userMsg = list[userIdx];
    const imgs = Array.isArray(userMsg.images) ? userMsg.images : [];
    if (!body && !imgs.length) return { ok: false, reason: "empty" };
    if (!fs) {
      set("keyError", state.coreError);
      return { ok: false, reason: "no-fs" };
    }

    // 撤销该轮：末条 user 之后全部删除，user 就地更新（逐条 splice 事件，
    // 页面窗口按 fill-key 增量移除）
    const removed = list.splice(userIdx + 1);
    for (const m of removed) msgEvent({ op: "splice", id: m.id });
    userMsg.content = body;
    patchMessage(userMsg.id, { content: body });
    scheduleSave(key);

    // Agent 记忆回退：截掉 wire 末条 user 起的最后一个回合（停止留下的
    // 悬空 tool_calls 恰好整段在删除范围内）
    if (selfStore) {
      const threadKey = `thread:${key.slice("chat:".length)}`;
      try {
        const wire = (await selfStore.getItem(threadKey)) || [];
        let cut = -1;
        for (let i = wire.length - 1; i >= 0; i--) {
          if (wire[i]?.role === "user") {
            cut = i;
            break;
          }
        }
        if (cut > -1) await selfStore.setItem(threadKey, wire.slice(0, cut));
      } catch (err) {
        console.warn("[builder] 重发前记忆截断失败：", err);
      }
    }

    // 以下与 send 同构：建回合 → 自动压缩检查 → 驱动
    setTurnKey(key);
    res.turnStartAt = Date.now();
    markBusy(key, true);
    setMany({ keyError: "", turnStartTs: res.turnStartAt });
    if (state.autoErrors.length) api.invalidateAgent();
    // 旧回合的回滚通知已随撤销失效，不带入重发回合
    if (res.pendingRollback && res.pendingRollback.appName === state.currentAppName) {
      res.pendingRollback = null;
    }
    // 重发 = 重新驱动本条请求：上一轮清单同步清空（同 send，中断续作除外）
    if (!state.interrupted && api.sessionTasksKey()) {
      api.applySessionTasks([]);
      if (state.autoErrors.length) api.syncErrorTasks(state.autoErrors);
    }
    try {
      await api.ensureAgent();
    } catch {
      setTurnKey(null);
      res.turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return { ok: false, reason: "no-key" };
    }
    set("sending", true);
    try {
      const info = contextInfo(bucketFor(res.turnKey));
      const estimate = info.used + Math.ceil((body.length || 0) / 2) + 64;
      if (res.contextWindow > 0 && info.used > 0 && estimate >= res.contextWindow) {
        await api.compressThread(res.turnKey);
      }
    } catch (err) {
      console.warn("自动压缩上下文失败：", err);
    }
    const threadId = key.slice("chat:".length);
    await driveTurn(threadId, body, [
      { role: "user", content: buildWireContent(body, imgs) },
    ]);
    return { ok: true };
  }

  // 驱动一轮 agent 对话循环：流式转发、错误入气泡、收尾（取消挂起表单、
  // 落盘、迁移草稿、清忙）。send 与表单恢复回合共用
  async function driveTurn(threadId, firstUserText, inputMessages) {
    activeBubble = null;
    // 本回合开跑，上次中断提醒随之失效（点继续 / 用户发新消息都算接手）
    set("interrupted", false);
    currentAbort = { stopped: false };
    currentAbortCtrl = new AbortController();
    turnUsage = null;
    turnStats = null;
    turnBreakdown = null;
    const abort = currentAbort;
    // 本回合第一条消息的 id 基线：收尾标记（turnMs / stopped / usage）只
    // patch 本回合内产生的消息，避免误改上一回合的末条 AI 消息
    turnFirstId = state.nextId;
    // 上回合自动检测的预览错误已随本回合 agent 构建（send 侧失效重建）注入
    // 提示词，此处取走清空，避免跨回合重复注入
    if (state.autoErrors.length) set("autoErrors", []);
    // 回滚通知同理：本回合 agent 的提示词已带上（send 侧失效重建），消费清除
    if (res.pendingRollback && res.pendingRollback.appName === state.currentAppName) {
      res.pendingRollback = null;
    }
    // 回合开始快照（存应用目录 snaps/，不进备份管理清单）：变更卡 diff 的
    // 旧侧 + 一键回滚目标。内容寻址幂等——未改动的回合与既有快照同 id 零
    // 成本；草稿态（项目未建）跳过
    res.turnChanges = [];
    turnSnapshotId = "";
    if (state.currentAppName) {
      try {
        const snapHandle =
          state.currentAppMode === "local" ? res.localRootHandle : undefined;
        const snap = await createAppBackup(fs, state.currentAppName, snapHandle, {
          snapshot: true,
        });
        turnSnapshotId = snap.id;
        // 只保留最近 10 份快照（被更早回合变更卡引用到的会被清掉，回滚按钮
        // 随 snapshotAvailable 失效；diff 内容已冻结进消息，不受影响）
        await pruneAppSnaps(fs, state.currentAppName, snapHandle);
      } catch (err) {
        console.warn("回合快照失败：", err);
      }
    }
    try {
      // 自动重试循环：可重试错误（限流 / 5xx / 断网）倒计时几秒后自动再试，
      // 不必等用户手动发「继续」。重试沿用同一 Agent 与 threadId——记忆已
      // 增量落盘，续跑与「继续」同语义（wire 可能留下重复 user，无害）。
      // 倒计时经 state.turnRetry 驱动状态行展示，停止按钮随时中断等待。
      // Agent 引用在循环外捕获一次：技能后台同步等流程会在回合中途置空
      // res.agent（那只为下一回合重建提示词），运行中回合持有自身引用
      const turnAgent = res.agent;
      let retryAttempt = 0;
      while (true) {
        try {
          await turnAgent.chat({
            messages: inputMessages,
            threadId,
            stream: true,
            signal: currentAbortCtrl.signal,
            onStream: (ev) => {
              if (abort.stopped) throw new Error("已停止生成");
              handleStreamEvent(ev);
            },
          });
          break;
        } catch (chatError) {
          if (
            abort.stopped ||
            retryAttempt >= MAX_CHAT_RETRIES ||
            !isRetryableChatError(chatError)
          ) {
            throw chatError;
          }
          retryAttempt++;
          for (
            let remain = retryAttempt * CHAT_RETRY_STEP_SEC;
            remain > 0;
            remain--
          ) {
            if (abort.stopped) throw chatError; // 等待中被停止：按停止收尾
            set("turnRetry", {
              attempt: retryAttempt,
              maxAttempts: MAX_CHAT_RETRIES,
              remain,
              error: String(chatError.message || chatError).slice(0, 200),
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
    } catch (error) {
      if (!abort.stopped) {
        const bubble = activeBubble ?? newBubble();
        bubble.content +=
          (bubble.content ? "\n\n" : "") + `出错了：${error.message}`;
        patchMessage(bubble.id, { content: bubble.content });
      }
    } finally {
      activeBubble = null;
      currentAbort = null;
      currentAbortCtrl = null;
      set("stopRequested", false);
      // 先清实时快照再落终值：避免「消息终值 + live」叠加的瞬时双计
      set("liveTurnStats", null);
      set("turnRetry", null); // 重试倒计时随回合收尾清除（覆盖等待中被停止的出口）
      api.cancelPendingForm("回合已结束"); // 表单仍挂起时兜底取消（如 Agent 自行结束）
      set("sending", false);
      // 本轮耗时 / 手动停止标记 / 停止与异常收场的实时用量 patch 到回合内
      // 末条 AI 消息（须在 finishTurn 落盘前 patch，随会话桶一起持久化）
      if (res.turnStartAt) {
        const lastAi = [...bucketFor(res.turnKey)]
          .reverse()
          .find((m) => m.role === "assistant" && m.id >= turnFirstId);
        if (lastAi) {
          const patch = { turnMs: Date.now() - res.turnStartAt };
          if (abort.stopped) patch.stopped = true;
          // 本回合文件变更（含回滚目标快照 id）：统计与行级内容统一从
          // 「首改前 + 末改后」重算——即该回合自己的净变化，冻结进消息，
          // 此后无论磁盘如何变化（后续回合 / 回滚），展开看到的都是当时的改动
          if (res.turnChanges.length) {
            patch.changes = res.turnChanges.map((c) => {
              // prevText 为 null = 新文件（无旧内容）：全行 add，不产生 del
              const full =
                c.prevText == null
                  ? (c.nextText ?? "")
                      .split("\n")
                      .map((text, i) => ({
                        type: "add",
                        aLn: null,
                        bLn: i + 1,
                        text,
                      }))
                  : diffLines(c.prevText, c.nextText ?? "");
              const stat = diffStat(full);
              const out = { path: c.path, op: c.op, ...stat };
              // 行级内容冻结（±3 行上下文折叠）；单文件超 200 行不保留，
              // 只留统计（展开时提示改动过大）
              const compacted = compactHunks(full, 3);
              if (compacted.length <= 200) out.hunks = compacted;
              else out.tooLarge = true;
              return out;
            });
            if (turnSnapshotId) patch.snapshotId = turnSnapshotId;
          }
          // 停止 / 异常收场（步数上限、网络错误…）没有 done 事件把终值落到
          // 消息，这里统一把累计的实时快照补上，否则统计胶囊整轮消失；
          // 正常完成时 lastAi.usage 已有值，守卫自动跳过不重复累计
          if (turnUsage && !lastAi.usage) patch.usage = turnUsage;
          // 末条气泡的思考 token 增量（badge 显示「本次思考」而非回合累计）
          const rtDelta = (turnUsage?.reasoning_tokens ?? 0) - bubbleRTStart;
          if (rtDelta > 0) patch.reasoningTokens = rtDelta;
          if (turnStats && !lastAi.turnStats) patch.turnStats = turnStats;
          if (turnBreakdown && !lastAi.contextBreakdown) {
            patch.contextBreakdown = turnBreakdown;
          }
          patchMessage(lastAi.id, patch);
        }
      }
      turnUsage = null;
      turnStats = null;
      turnBreakdown = null;
      await finishTurn(firstUserText, threadId, Date.now() - res.turnStartAt);
      // 回合结束刷新备份清单：回合开始的自动快照 + 当前内容是否已有备份
      //（变更卡「备份代码」按钮的已备份感知数据源）；不阻塞收尾
      api.refreshBackups();
      // 自动错误回路：本回合有文件改动且预览窗口开着（不自动开窗打扰）时，
      // 推送最新代码 → 等应用跑起 → 读 console 的 error 行挂 state.autoErrors，
      // 下回合提示词自动注入（见 ensureAgent / buildSystemPrompt）
      const changedFiles = res.turnChanges;
      const changedApp = threadId === "draft" ? "" : threadId.split(":")[0];
      res.turnChanges = [];
      turnSnapshotId = "";
      if (
        changedFiles.length &&
        changedApp &&
        state.previewOnline &&
        !abort.stopped
      ) {
        api.autoCheckPreview(changedApp);
        // 场景测试不自动跑（用户拍板：回合收尾自动跑体验太密，改为用户在
        // 测试抽屉点跑 / AI 经 preview action=run-tests 主动跑）
      }
      // adoptNewApp 可能把回合迁移到新应用会话，收尾后按最终 turnKey 清忙
      markBusy(res.turnKey, false);
      setTurnKey(null);
      res.turnStartAt = 0;
      setMany({ turnStartTs: 0 });
    }
  }

  // 停止当前生成：置位中止信号 + abort 在途模型请求（不必等下一个流式
  // 事件，模型长流式 / 工具执行中点击都能尽快中断），已生成内容保留并照常
  // 落盘收尾（耗时 / 用量 / stopped 标记见 driveTurn 收尾）。
  // 视觉表单挂起中（Agent 在等用户提交）时一并取消，工具以 cancelled 返回；
  // stopRequested 供按钮显示「停止中」并防重复点击
  function stop() {
    if (!currentAbort || currentAbort.stopped) return;
    currentAbort.stopped = true;
    set("stopRequested", true);
    try {
      currentAbortCtrl?.abort();
    } catch {}
    api.cancelPendingForm("用户停止了生成");
  }

  return {
    createProjectNow,
    syncAppMetaFromDisk,
    updateAppMeta,
    prepareContext,
    finishTurn,
    adoptNewApp,
    send,
    resendLastUser,
    stop,
  };
}
