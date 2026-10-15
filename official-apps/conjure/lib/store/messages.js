/* ---------- 消息流水线（每会话独立消息桶 + 细粒度事件） ----------
 *
 * 每个会话（含草稿）有自己独立的消息桶（plain 数组），state.messages 只是
 * 「当前正在查看的会话」桶的视图镜像。进行中的回合（res.turnKey）始终写
 * 自己的桶——即便用户中途切到别的会话，流式内容也不会串台；切回来时直接
 * 投影内存中的实时桶继续流式显示。
 */

export function createMessagesPart(api) {
  const { state, set, res } = api;

  const msgEvent = (evt) => api.listeners.forEach((f) => f({ type: "messages", ...evt }));

  // 会话消息桶：chatKey（"chat:draft" / "chat:<app>:<sid>"）→ plain 消息数组
  const sessionBuckets = new Map();
  // 响应式镜像（state.turningKey）：页面据此判断「当前视图是否为正在生成的
  // 会话」——生成中状态行与停止按钮只在回合视图显示，切到别的会话不再误
  // 显示全局状态。所有 turnKey 赋值一律走这里（真值在共享资源包 res.turnKey）
  const setTurnKey = (v) => {
    res.turnKey = v;
    set("turningKey", v || "");
  };

  const viewKey = () =>
    state.currentAppName === ""
      ? "chat:draft"
      : `chat:${state.currentAppName}:${state.currentSessionId}`;

  const bucketFor = (key) => {
    let bucket = sessionBuckets.get(key);
    if (!bucket) {
      bucket = [];
      sessionBuckets.set(key, bucket);
    }
    return bucket;
  };
  // 消息操作的目标桶：回合进行中固定写回合桶，否则写当前视图桶
  const activeKey = () => res.turnKey || viewKey();

  // 增量落盘（防抖 400ms）：回合中途（表单挂起、流式输出等）也把消息写进
  // IndexedDB，刷新 / 意外关闭不再丢失整轮对话。捕获当下的 key，避免防抖
  // 触发时回合已收尾、activeKey 变化而写错桶
  function scheduleSave(key) {
    if (!api.selfStore || !sessionBuckets.has(key)) return;
    clearTimeout(scheduleSave._timer);
    scheduleSave._timer = setTimeout(() => {
      if (!sessionBuckets.has(key)) return;
      api.selfStore
        .setItem(key, bucketFor(key).map((m) => ({ ...m })))
        .catch(() => {});
    }, 400);
  }

  function pushMessage(item) {
    const key = activeKey();
    // 消息落盘时间：所有角色（含用户消息）统一在这里补时间戳，hover 展示
    if (item.ts == null) item.ts = Date.now();
    bucketFor(key).push(item);
    scheduleSave(key);
    if (key === viewKey()) {
      state.messages.push(item);
      msgEvent({ op: "push", item });
    }
    return item;
  }
  function patchMessage(id, patch) {
    const key = activeKey();
    const item = bucketFor(key).find((m) => m.id === id);
    if (!item) return;
    Object.assign(item, patch);
    scheduleSave(key);
    if (key === viewKey()) msgEvent({ op: "patch", id, patch });
  }
  function removeMessage(id) {
    const key = activeKey();
    const list = bucketFor(key);
    const idx = list.findIndex((m) => m.id === id);
    if (idx > -1) {
      list.splice(idx, 1);
      scheduleSave(key);
      if (key === viewKey()) msgEvent({ op: "splice", id });
    }
  }
  // 本地错误卡片：宿主在回合中发生的错误（如隔离预览失败）镜像进对话，
  // 紧跟触发它的工具调用便于定位问题。仅展示用——AI 的记忆走 wire thread，
  // 读不到这条消息（不传给 AI）。diag 可选：排查用诊断附件（链路事件等），
  // 只随消息落盘进对话 JSON，展示层忽略未知字段
  function pushLocalError(text, diag = null) {
    const item = {
      id: state.nextId++,
      role: "error",
      text: String(text).slice(0, 300),
      newGroup: false,
    };
    if (diag) item.diag = diag;
    return pushMessage(item);
  }
  // 预览诊断落档：把错误对象携带的 diag（链路事件段 + 推送上下文，见
  // remote-preview 的 attachDiag）写进对话 JSON——优先附在触发的 preview
  // 工具消息上（排查时紧跟现场），没有在途工具消息则补记到最近一条。
  // 仅持久化供人读：AI 上下文走 wire thread（工具返回值），不读消息桶
  function recordPreviewDiag(err) {
    const diag = err && err.diag;
    if (!diag) return;
    try {
      const bucket = bucketFor(activeKey());
      let target = null;
      for (let i = bucket.length - 1; i >= 0; i--) {
        const m = bucket[i];
        if (m.role !== "tool" || m.name !== "preview") continue;
        if (m.pending) {
          target = m;
          break;
        }
        if (!target) target = m;
      }
      if (target) patchMessage(target.id, { diag });
    } catch (_) {}
    console.warn("[preview][diag]", err?.message, diag);
  }
  // 整组替换某个会话桶并（若是当前视图）刷新镜像；nextId 全局单调递增，
  // 避免多桶并存时 id 撞车导致补丁打到别的会话消息上。
  // 注意：pending 表单原样保留——刷新后仍可填写提交（submitForm 走恢复回合）
  function replaceMessages(list, key = viewKey()) {
    const norm = (list || []).map((m) => {
      return {
        ...m,
        pending: false,
        open: false,
        reasoningOpen: false, // 历史消息的思考过程默认收起
      };
    });
    sessionBuckets.set(key, norm);
    state.nextId = Math.max(
      state.nextId,
      norm.reduce((max, m) => Math.max(max, m.id), 0) + 1,
    );
    if (key === viewKey()) {
      state.messages = [...norm];
      msgEvent({ op: "replace", list: norm });
    }
  }
  // 把某个桶直接投影为当前视图（切回「正在流式的会话」时用，不读盘）
  function projectBucket(key) {
    if (key !== viewKey()) return;
    state.messages = [...bucketFor(key)];
    msgEvent({ op: "replace", list: state.messages });
  }

  // 标记/清除会话的「对话进行中」状态（key 传 null 清除全部标记）
  function markBusy(key, busy = false) {
    const sid = key && key !== "chat:draft" ? key.split(":").pop() : "";
    set(
      "currentAppSessions",
      state.currentAppSessions.map((s) => ({
        ...s,
        busy: sid ? s.id === sid && busy : false,
      })),
    );
  }

  return {
    msgEvent,
    sessionBuckets,
    setTurnKey,
    viewKey,
    bucketFor,
    activeKey,
    scheduleSave,
    pushMessage,
    patchMessage,
    removeMessage,
    pushLocalError,
    recordPreviewDiag,
    replaceMessages,
    projectBucket,
    markBusy,
  };
}
