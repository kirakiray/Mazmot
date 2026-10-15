/* ---------- 预览（隔离预览推送 + 多窗口 + 能力桥 broker） ----------
 * 预览按钮与 preview 工具共用的推送主流程、多窗口管理、跨设备扫码、
 * 缩略图抓取、调试指令通道；broker 段执行预览域 guest 替身经能力桥发来的
 * AI / 联网调用（key 与通道配置永不过桥）。
 */

import { sanitizeAppName, listAppFiles, readAppFile } from "../builder.js";

export function createPreviewPart(api) {
  const { state, set, selfStore, load, res, pushMessage, pushLocalError, recordPreviewDiag } = api;

  // share-mgr 模块缓存（发布副本的 P2P 分享：ensureUser / publishApp / buildRunUrl）
  let shareMod = null;
  async function ensureShareMod() {
    if (!shareMod) shareMod = await load("/mz/share-mgr.js");
    return shareMod;
  }

  // remote-preview 模块缓存（预览主流程 / 窗口清单 / 分享地址共用）
  let previewMod = null;
  async function ensurePreviewMod() {
    if (!previewMod) {
      previewMod = await load("/official-apps/conjure/lib/remote-preview.js");
    }
    return previewMod;
  }

  // 收集指定应用的全部文件（VFS 渠道读 ai-apps/<name>/client/，
  // 本地渠道恢复句柄后复用 app-runner 的 readAppFiles，优先 client/ 子目录）；
  // onFile({done, total, path}) 逐文件进度回调（本地渠道为整包读，仅结束时报一次）
  async function collectAppFiles(name, mode, onFile = null) {
    const report = (done, total, path) => {
      try {
        onFile?.({ done, total, path });
      } catch (_) {}
    };
    if (mode === "local") {
      let handle = res.localRootHandle;
      if (!handle) {
        handle = await api.getLocalHandleFromRecord(name);
        if (handle) {
          res.localRootHandle = handle;
          set("localDirLabel", handle?.name || "");
        }
      }
      if (!handle) throw new Error("本地目录句柄已丢失，请重新选择目录");
      const granted = await api.ensureLocalPermission(handle);
      if (!granted) throw new Error("本地目录权限未授予，无法读取应用文件");
      const { readAppFiles } = await load("/mz/app-runner.js");
      const raw = await readAppFiles(handle);
      const list = raw.map((f) => ({ path: f.path, text: f.content }));
      report(list.length, list.length, "");
      return list;
    }
    const paths = await listAppFiles(api.fs, name);
    const files = [];
    let i = 0;
    for (const p of paths) {
      const text = await readAppFile(api.fs, name, p);
      i++;
      if (text != null) files.push({ path: p, text });
      report(i, paths.length, p);
    }
    return files;
  }

  // 隔离预览推送主流程（预览按钮与 preview 工具共用）：
  // 收集文件 → 推送到 bridge 隔离域运行（AI 代码不接触主域数据）→
  // 同步其余在线预览窗口（多窗口：手机扫码设备等一并增量更新）。
  // 失败写入 keyError 并抛出（调用方决定是否吞掉），成功返回 done（含运行 url）
  async function runRemotePreview(appName, mode) {
    const name = sanitizeAppName(appName);
    if (!name) throw new Error("应用名不合法");
    if (state.previewBusy) throw new Error("预览推送进行中，请稍候再试");
    set("previewBusy", true);
    set("previewStatus", "准备推送...");
    set("previewProgress", null);
    try {
      const mod = await ensurePreviewMod();
      const files = await collectAppFiles(name, mode, (p) => {
        set("previewStatus", `读取文件 ${p.done}/${p.total}：${p.path}`);
        set("previewProgress", p);
      });
      if (!files.length) throw new Error("应用目录为空，请先生成应用文件");
      const done = await mod.openRemotePreview({
        load,
        appName: name,
        files,
        selfStore,
        onStatus: (text) => set("previewStatus", text),
        onProgress: (p) => set("previewProgress", p),
      });
      // 其余在线窗口一并同步（排除刚推完的主窗口对端）；失败逐个吞掉不阻断
      try {
        const primaryId = await mod.getPrimaryBridgeId(selfStore);
        const others = mod
          .listPreviewWindows()
          .filter((w) => w.online && primaryId && !w.id.startsWith(`${primaryId}|`))
          .map((w) => w.id);
        if (others.length) {
          const peerIds = [...new Set(others.map((id) => id.split("|")[0]))];
          await mod.syncPreviewPeers({
            load,
            appName: name,
            files,
            peerIds,
            onStatus: (text) => set("previewStatus", text),
            onProgress: (p) => set("previewProgress", p),
          });
        }
      } catch (err) {
        console.warn("[preview] 多窗口同步失败（主窗口已更新）：", err);
      }
      refreshPreviewWindows(mod);
      refreshPreviewInfo();
      return done;
    } catch (err) {
      recordPreviewDiag(err);
      // 回合中（preview 工具触发）：不弹横幅，错误卡片镜像进对话、紧跟
      // 工具调用（AI 仍从工具结果文本得知失败）；非回合入口走可关闭横幅。
      // reported 标记：对话已报过，防上层调用方（runTests 重推等）二次镜像
      if (state.sending) {
        pushLocalError(`隔离预览失败：${err.message}`, err?.diag || null);
        err.reported = true;
      } else {
        set("keyError", `隔离预览失败：${err.message}`);
      }
      throw err;
    } finally {
      set("previewBusy", false);
      set("previewStatus", "");
      set("previewProgress", null);
    }
  }

  // 预览按钮入口：错误已写入 keyError，这里吞掉避免未处理拒绝
  async function openAppRemote(appName, mode) {
    try {
      await runRemotePreview(appName, mode);
    } catch (_) {
      /* 错误提示已写入 keyError */
    }
  }

  // 新开一个预览窗口（槽位 popup）：引导页打开后由 onBridgeHello 钩子自动推送
  // 当前应用；窗口上限与弹窗拦截错误抛给调用方展示
  async function openNewPreviewWindow() {
    const name = sanitizeAppName(state.currentAppName);
    if (!name) throw new Error("还没有正在开发的应用，先创建应用再预览");
    if (state.previewBusy) throw new Error("预览推送进行中，请稍候再试");
    set("previewBusy", true);
    set("previewStatus", "新开预览窗口...");
    try {
      const mod = await ensurePreviewMod();
      const r = await mod.openPreviewWindow({ load, app: name });
      set("previewStatus", `预览窗口 #${r.slot} 已打开，等待应用推送...`);
      return r;
    } catch (err) {
      set("keyError", `新开预览窗口失败：${err.message}`);
      throw err;
    } finally {
      set("previewBusy", false);
    }
  }

  // 扫码 / 新开窗口的 bridge 引导页 hello（onBridgeHello 钩子）：自动把应用
  // 推给该对端。优先推 hello 指定的应用（?app=），不存在则回退当前应用；
  // 推送在 remote-preview 内部串行排队，失败只打日志（对端引导页有进度/错误展示）
  async function pushToWindow(peerId, appName) {
    try {
      const mod = await ensurePreviewMod();
      const hint = sanitizeAppName(appName);
      const hit = state.apps.find((a) => a.name === hint);
      const name = hit ? hint : sanitizeAppName(state.currentAppName);
      if (!name) return;
      const mode = hit
        ? hit.mode
        : state.apps.find((a) => a.name === name)?.mode || state.currentAppMode;
      const files = await collectAppFiles(name, mode, (p) => {
        set("previewStatus", `读取文件 ${p.done}/${p.total}：${p.path}`);
        set("previewProgress", p);
      });
      if (!files.length) return;
      await mod.syncPreviewPeers({
        load,
        appName: name,
        files,
        peerIds: [peerId],
        onStatus: (text) => set("previewStatus", text),
        onProgress: (p) => set("previewProgress", p),
      });
    } catch (err) {
      console.warn("[preview] 新窗口自动推送失败：", err);
    } finally {
      set("previewStatus", "");
      set("previewProgress", null);
    }
  }

  // 窗口注册表快照 → state（下拉气泡渲染源）；previewWindows 变更统一走这里
  function refreshPreviewWindows(mod) {
    try {
      const list = (mod || previewMod)?.listPreviewWindows?.() || [];
      set("previewWindows", list);
    } catch (_) {}
  }

  /* ---------- 预览能力桥 broker（remote-preview 接线） ----------
   * 预览域的 /mz/* 替身（bridge/guest/*）经能力桥发来的调用：用主容器当前
   * 选中的 key/模型（pickAssistant）与联网通道（mz/net）执行，结果序列化后
   * 回传。key 与通道配置永不过桥；模型/推理档位不开放 guest 指定（统一用
   * 主界面当前选中项，防止生成代码烧不认识的贵模型）。并发闸与窗口校验在
   * remote-preview.handleCapEnvelope（本函数只做单次执行）。
   */
  async function handleCapRequest({ cap, args, onChunk, signal }) {
    if (cap === "ai.chat") {
      const messages = Array.isArray(args.messages) ? args.messages : null;
      if (!messages?.length) throw new Error("ai.chat：messages 不能为空");
      if (!res.aiModules) res.aiModules = await load("/mz/ai/main.js");
      const { assistant, model } = await api.pickAssistant();
      const res2 = await assistant.chat({
        ...(model ? { model } : {}),
        thinking: args.thinking === true,
        stream: true,
        messages,
        onStream: (d) =>
          onChunk({ delta: d.delta || "", deltaReasoning: d.deltaReasoning || "" }),
        signal,
      });
      return {
        content: res2.content ?? "",
        reasoningContent: res2.reasoningContent ?? "",
        model: res2.model ?? model ?? "",
        usage: res2.usage ?? null,
      };
    }
    if (cap === "ai.models") {
      if (!res.aiModules) res.aiModules = await load("/mz/ai/main.js");
      const { assistant } = await api.pickAssistant();
      const models = await assistant.getModels();
      return { models: Array.isArray(models) ? models : [] };
    }
    if (cap === "net.fetch") {
      if (!res.netModules) res.netModules = await load("/mz/net/main.js");
      const res3 = await res.netModules.fetch(String(args.url ?? ""), { signal });
      let text = await res3.text();
      let truncated = !!res3.truncated;
      if (text.length > 400_000) {
        text = text.slice(0, 400_000);
        truncated = true;
      }
      return {
        url: res3.url,
        status: res3.status,
        ok: res3.ok,
        truncated,
        provider: res3.provider,
        contentType: res3.headers?.get?.("content-type") || "",
        text,
      };
    }
    if (cap === "net.fetchText") {
      if (!res.netModules) res.netModules = await load("/mz/net/main.js");
      const maxChars = Number(args.maxChars);
      return await res.netModules.fetchText(String(args.url ?? ""), {
        raw: args.raw === true,
        noCache: args.noCache === true,
        ...(Number.isFinite(maxChars) && maxChars > 0 ? { maxChars } : {}),
        signal,
      });
    }
    if (cap === "net.searchWeb") {
      if (!res.netModules) res.netModules = await load("/mz/net/main.js");
      return await res.netModules.searchWeb(String(args.query ?? ""), {
        signal,
        ...(args.engine ? { engine: args.engine } : {}),
      });
    }
    throw new Error(`未知能力：${cap}`);
  }

  // 跨设备扫码入口地址：bridge 引导页（?u=<conjure userId>&app=<应用>），
  // 手机扫码即自动收到当前应用
  async function refreshPreviewInfo() {
    try {
      const mod = await ensurePreviewMod();
      const name = sanitizeAppName(state.currentAppName);
      if (!name) {
        set("previewShareUrl", "");
        return;
      }
      const { userId } = await mod.getPreviewIdentity({ load });
      set(
        "previewShareUrl",
        `${mod.BRIDGE_ORIGIN}/bridge/?u=${encodeURIComponent(userId)}` +
          `&app=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      console.warn("[preview] 预览地址生成失败：", err);
    }
  }

  // 窗口缩略图抓取（预览气泡打开时调用 + 打开期间定时刷新）：逐个在线窗口
  // 定向发 wire 指令。wire 两级返回：① snapdom 真实渲染截图（vendor 本地库，
  // shadow DOM/字体/渐变保真，免屏幕授权、手机可用）的 JPEG dataURL 直接用；
  // ② 线框节点清单 JSON → thumb-paint 本地重绘近似图兜底。失败置空串由占位
  // 图兜底。thumbSeq 过期守卫防面板已关闭/新一轮已启动后旧结果继续写入
  let thumbSeq = 0;
  async function refreshPreviewThumbs() {
    const seq = ++thumbSeq;
    try {
      const mod = await ensurePreviewMod();
      const paint = await load("/official-apps/conjure/lib/thumb-paint.js");
      const validIds = new Set(state.previewWindows.map((w) => w.id));
      const next = {};
      for (const [k, v] of Object.entries(state.previewThumbs)) {
        if (validIds.has(k)) next[k] = v; // 清掉已消失窗口的旧缩略图
      }
      for (const w of state.previewWindows.filter((x) => x.online)) {
        try {
          const outcome = await mod.debugPreviewCommand({
            load,
            selfStore,
            cmd: "wire",
            args: {},
            timeoutMs: 20_000,
            winId: w.id,
          });
          const raw = outcome?.result || "";
          next[w.id] = raw.startsWith("data:image")
            ? raw
            : paint.paintWireframe(JSON.parse(raw || "{}"));
        } catch {
          next[w.id] = "";
        }
        if (seq !== thumbSeq) return; // 面板已关 / 新一轮抓取已启动
        set("previewThumbs", { ...next });
      }
    } catch (err) {
      console.warn("[preview] 窗口缩略图抓取失败：", err);
    }
  }

  // 调试指令通道（preview 工具）：转发到 remote-preview 的 dbg 链路；
  // winId 缺省投递给最近心跳的在线窗口。失败同样落诊断（dbg 超时/投递
  // 失败没有错误卡，diag 只能附在工具消息上）
  async function previewDebug(cmd, args = {}, timeoutMs, winId) {
    const mod = await ensurePreviewMod();
    try {
      return await mod.debugPreviewCommand({
        load,
        selfStore,
        cmd,
        args,
        timeoutMs,
        winId: winId || null,
      });
    } catch (err) {
      recordPreviewDiag(err);
      throw err;
    }
  }

  // preview_screenshot 工具：截图以图片卡片进入聊天流（用户可视核对）
  function pushPreviewShot(dataUrl, meta) {
    pushMessage({
      id: state.nextId++,
      role: "image",
      src: dataUrl,
      w: meta?.w || 0,
      h: meta?.h || 0,
      newGroup: false,
    });
  }

  return {
    ensureShareMod,
    ensurePreviewMod,
    collectAppFiles,
    runRemotePreview,
    openAppRemote,
    openNewPreviewWindow,
    pushToWindow,
    refreshPreviewWindows,
    handleCapRequest,
    refreshPreviewInfo,
    refreshPreviewThumbs,
    previewDebug,
    pushPreviewShot,
  };
}
