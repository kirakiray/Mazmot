/* ---------- 会话任务清单（task_list 工具 / 对话右侧面板） ----------
 * 模型开发前拆解任务、随做随勾；清单按会话持久化（tasks:<app>:<sid>），
 * 暂停 / 刷新后继续开发时原样恢复。预览自动检测的运行错误由
 * syncErrorTasks 自动登记为修复任务、验证通过后自动勾掉（不依赖模型）。
 * 纯逻辑（规整 / 错误合并）在 builder.js，供单测。
 */

import { normalizeTaskList, mergeErrorTasks } from "../builder.js";

export function createTasksPart(api) {
  const { state, set, selfStore } = api;

  // 当前会话的任务清单存储键；草稿（发送即建项目）与无会话态没有清单
  const sessionTasksKey = () =>
    state.currentAppName === "" || state.currentSessionId === ""
      ? null
      : `tasks:${state.currentAppName}:${state.currentSessionId}`;

  // 写状态镜像 + 落盘（小数据直接写，不防抖）
  function applySessionTasks(list) {
    set("sessionTasks", list);
    const key = sessionTasksKey();
    if (key && selfStore) {
      selfStore.setItem(key, list.map((m) => ({ ...m }))).catch(() => {});
    }
  }

  // 读取某会话的任务清单（无记录 = 空清单）
  async function loadSessionTasks(appName, sid) {
    if (!selfStore || !appName || !sid) return [];
    try {
      const saved = await selfStore.getItem(`tasks:${appName}:${sid}`);
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  // task_list 工具入口：全量替换清单（TodoWrite 语义）。返回给模型的
  // 结果文本带最新进度，模型据此汇报
  function setSessionTasks(tasks) {
    const key = sessionTasksKey();
    if (!key) {
      return "任务清单不可用：当前没有活动会话（发送首条消息建立会话后再用）";
    }
    const list = normalizeTaskList(tasks);
    if (!list) {
      return "tasks 无效：需要非空数组 [{ text: 任务描述, status: pending|in_progress|done }]，text 必填（≤120 字）";
    }
    applySessionTasks(list);
    // 模型重写清单（需求变化）时，当前仍检测在案的运行错误自动补回，
    // 防「错误修完前清单被整体替换导致修复任务丢失」
    if (state.autoErrors?.length) syncErrorTasks(state.autoErrors);
    // 清单进了系统提示词（「当前任务清单」节）：作废缓存的 Agent，下一
    // 回合重建即带上最新清单（运行中回合持有自身引用，不受影响）
    api.invalidateAgent();
    const done = state.sessionTasks.filter((t) => t.status === "done").length;
    return `任务清单已更新（${done}/${state.sessionTasks.length} 完成）：${state.sessionTasks
      .map((t, i) => `${i + 1}.[${t.status}]${t.text}`)
      .join("；")}`;
  }

  // 预览运行错误 ↔ 修复任务同步：新错误自动登记、消失的错误自动勾完成。
  // 由 autoCheckPreview（每回合收尾后的自动检测）与 setSessionTasks（模型
  // 重写清单）共同调用，保证「检测在案的错误必然有对应任务」
  function syncErrorTasks(lines) {
    const key = sessionTasksKey();
    if (!key) return;
    const merged = mergeErrorTasks(state.sessionTasks, lines);
    if (merged !== state.sessionTasks) applySessionTasks(merged);
  }

  // 回合后自动错误检测：推送最新代码 → 等应用重载与首轮报错 → 读 console
  // 的 error 行挂 state.autoErrors（fire-and-forget，不阻塞回合收尾；重入
  // 保护防连发回合叠加）。仅在预览窗口已开时被调用，不自动开窗
  let autoCheckBusy = false;
  async function autoCheckPreview(appName) {
    if (autoCheckBusy) return;
    autoCheckBusy = true;
    try {
      const hit = state.apps.find((a) => a.name === appName);
      await api.runRemotePreview(appName, hit?.mode || "vfs");
      await new Promise((r) => setTimeout(r, 2200));
      const outcome = await api.previewDebug("console", { limit: 30 });
      const lines = String(outcome?.result ?? "")
        .split("\n")
        .filter((l) => l.includes("[error]"))
        .slice(-6);
      set("autoErrors", lines);
      // 错误 ↔ 任务同步：新错误进清单（用户在面板看到「要修什么」），
      // 已消失的错误勾完成（修完自动打钩，不依赖模型记得）
      syncErrorTasks(lines);
      if (lines.length) api.invalidateAgent(); // 下回合重建提示词带上错误
    } catch (err) {
      console.warn("[autoCheck] 预览自动检测失败：", err);
    } finally {
      autoCheckBusy = false;
    }
  }

  // 用户忽略自动检测到的错误：清空（下回合提示词不再注入；新错误会重新收集）
  function dismissAutoErrors() {
    set("autoErrors", []);
  }

  // 关闭错误横幅（keyError 仅提示用；关闭不代表问题已解决，下次出错会再弹）
  function dismissError() {
    set("keyError", "");
  }

  return {
    sessionTasksKey,
    applySessionTasks,
    loadSessionTasks,
    setSessionTasks,
    syncErrorTasks,
    autoCheckPreview,
    dismissAutoErrors,
    dismissError,
  };
}
