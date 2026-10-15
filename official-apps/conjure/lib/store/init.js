/* ---------- 初始化 ----------
 * init 装配偏好恢复（推理等级 / API Key / 模型）、API Key 列表镜像与订阅、
 * 预览钩子接线、应用与会话恢复（?p= 直选项目 + sessionStorage 会话停留
 * 记忆）、技能索引装载与后台同步。
 */

import { loadSkillIndex } from "../skill-sync.js";

export function createInitPart(api) {
  const { state, set, fs, selfStore, load, res } = api;

  // 会话停留记忆（sessionStorage，标签页级）：刷新后回到该项目当前激活的
  // 会话而不是最近会话；不同项目标签互不干扰（sessionStorage 随标签隔离）
  const SESSION_KEY = (name) => `aib:session:${name}`;
  function rememberSession() {
    try {
      if (state.currentAppName) {
        sessionStorage.setItem(
          SESSION_KEY(state.currentAppName),
          state.currentSessionId || "",
        );
      }
    } catch {
      /* 隐私模式等场景静默降级 */
    }
  }
  function recallSession(appName) {
    try {
      return sessionStorage.getItem(SESSION_KEY(appName)) || "";
    } catch {
      return "";
    }
  }

  // initialApp：URL ?p= 带入的项目名。项目标签按名恢复（优先回到上次激活的
  // 会话，无记忆则开最近会话）；无 p 参数 = 草稿标签（新项目），恢复 chat:draft
  // （切换/新建项目由页面在新标签页打开，本标签不再承担跳转）
  async function init({ initialApp = "" } = {}) {
    if (!fs) {
      set(
        "coreError",
        "NoneOS Core 未就绪：无法写入文件系统，请从 Mazmot 主系统打开本应用。",
      );
    }
    // 预览窗口（应用页代理）在线状态监听：预览按钮亮标（失败静默，不影响主流程）。
    // 同时接线多窗口钩子：onWindowsChange 刷新注册表快照（下拉气泡），
    // onBridgeHello 在扫码/新窗口引导页连入时自动推送对应应用；
    // onCapRequest 执行预览能力桥（guest 替身）的 AI/联网调用
    (async () => {
      try {
        const mod = await api.ensurePreviewMod();
        mod.setPreviewHooks({
          onBridgeHello: (userId, app) => api.pushToWindow(userId, app),
          onWindowsChange: () => api.refreshPreviewWindows(mod),
          onCapRequest: api.handleCapRequest,
        });
        mod.watchPreviewAgent({
          load,
          selfStore,
          onChange: (online) => set("previewOnline", online),
        });
      } catch (_) {}
    })();
    // 恢复推理等级偏好（无记录时从旧版思考模式开关迁移：开=low，关=off；
    // 校验放宽到 efforts 全档位集，minimal / max 为后来新增）
    if (selfStore) {
      try {
        let level = await selfStore.getItem("pref:reasoning");
        if (!["off", "minimal", "low", "medium", "high", "max"].includes(level)) {
          const legacy = await selfStore.getItem("pref:thinking");
          level = legacy === false ? "off" : "low";
        }
        set("reasoning", level);
      } catch {
        /* 忽略 */
      }
      // 恢复手动选中的 API Key 与模型
      try {
        const keyId = await selfStore.getItem(api.API_KEY_LIST_KEY);
        if (typeof keyId === "string") set("activeKeyId", keyId);
        const modelId = await selfStore.getItem("pref:active-model");
        if (typeof modelId === "string") set("activeModelId", modelId);
      } catch {
        /* 忽略 */
      }
    }
    // API Key 列表镜像 + 变化订阅（惰性加载 /mz/ai，失败仅代表宿主未提供）
    try {
      const m = await load("/mz/ai/main.js");
      res.aiModules = res.aiModules || m;
      api.syncApiKeyList(m.getApiKeys());
      m.onApiKeysChange(api.syncApiKeyList);
    } catch (err) {
      console.warn("API Key 列表加载失败：", err);
    }
    // 思考档位表加载 + 首算（此前 refreshEffortOptions 因模块未就绪被跳过）
    try {
      await api.ensureEfforts();
      api.refreshEffortOptions();
    } catch {
      /* efforts 加载失败保持空表（菜单显示默认态，注入按通用表 clamp 兜底） */
    }
    await api.reloadApps();

    if (initialApp) {
      const hit = state.apps.find((a) => a.name === initialApp);
      if (hit) {
        // 必须在 selectApp 之前取记忆：selectApp 打开最近会话时
        // 会触发记忆监听器，把记住的会话覆盖成最近会话
        const sid = recallSession(hit.name);
        await api.selectApp(hit.name);
        // 刷新恢复：回到该项目上次激活的会话（记忆失效则保持最近会话）
        if (
          sid &&
          sid !== state.currentSessionId &&
          hit.sessions?.some((s) => s.id === sid)
        ) {
          await api.loadSessionById(sid);
        }
      } else {
        set("keyError", `项目 ${initialApp} 不存在，已回到新项目草稿。`);
        await api.startDraft();
      }
    } else {
      await api.startDraft();
    }
    // 先读一次已安装索引（VFS skills 空间）让「技能」列表立即有数据，
    // 再后台增量同步；同步无变化（changed=false）时索引早已就位
    if (fs) {
      try {
        res.skillIndex = await loadSkillIndex(fs);
        set("skills", [...res.skillIndex]);
      } catch (err) {
        console.warn("加载技能索引失败：", err);
      }
      api.backgroundSyncSkills();
    }
  }

  return { rememberSession, recallSession, init };
}
