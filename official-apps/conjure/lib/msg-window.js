// 会话消息反向瀑布流窗口（页面渲染层用，仓库仍持有全量）。
//
// 长会话把几百条消息全部渲染成 DOM（每条含 markdown / 变更卡 / 用量明细）
// 是对话滚动卡顿的主因。这里维护「全量消息（普通数组）+ 渲染窗口（注入的
// 目标数组，页面侧即 o-fill 的 stanz 源 data.messages）」：
//   - 初始只渲染最近 MSG_WINDOW_INIT 条；
//   - 仓库的 messages 事件（replace/push/patch/splice）原样喂给 apply()，
//     全量与窗口同步更新——push 只加尾不丢头（用户停在上方阅读时，新消息
//     不会把视口里的旧消息挤出窗口）；
//   - 滚动到顶时调 loadOlder() 向头部补挂 MSG_WINDOW_PAGE 条，配合页面的
//     scrollHeight 补偿实现「上滑加载更早消息」（反向瀑布流）。
//
// target 数组只要求实现 push/splice/find/findIndex（stanz 数组与普通数组
// 皆可注入，便于纯逻辑单测）。

// 初始渲染最近 N 条 / 每次上滑补挂 N 条
export const MSG_WINDOW_INIT = 30;
export const MSG_WINDOW_PAGE = 20;

export function createMsgWindow(
  target,
  { init = MSG_WINDOW_INIT, page = MSG_WINDOW_PAGE } = {},
) {
  const full = []; // 全量消息（统计 / 上下文占用等全量计算的数据源）
  let winStart = 0; // 窗口在全量中的起始下标（0 = 全部可见）

  const clone = (m) => ({ ...m });

  return {
    /** 全量消息（只读遍历用） */
    get all() {
      return full;
    },

    /** 窗口外被省略的更早消息数（顶部提示数据源；0 = 全部可见） */
    get hiddenCount() {
      return winStart;
    },

    /**
     * 应用一条仓库 messages 事件，返回 op 便于调用方做副作用（滚动等）。
     * patch 同时落到全量与窗口（窗口外消息保持全量侧最新，补挂时即是新值）。
     */
    apply(evt) {
      const op = evt?.op;
      if (op === "replace") {
        full.splice(0, full.length, ...(evt.list || []).map(clone));
        winStart = Math.max(0, full.length - init);
        target.splice(0, target.length, ...full.slice(winStart).map(clone));
        return op;
      }
      if (op === "push") {
        full.push(clone(evt.item));
        target.push(clone(evt.item));
        return op;
      }
      if (op === "patch") {
        const f = full.find((m) => m.id === evt.id);
        if (f) Object.assign(f, evt.patch);
        const t = target.find((m) => m.id === evt.id);
        if (t) Object.assign(t, evt.patch);
        return op;
      }
      if (op === "splice") {
        const fi = full.findIndex((m) => m.id === evt.id);
        if (fi > -1) full.splice(fi, 1);
        const ti = target.findIndex((m) => m.id === evt.id);
        if (ti > -1) {
          target.splice(ti, 1);
          // 窗口是「从 winStart 起的全量切片」，全量缩短后钳住起点
          winStart = Math.max(0, Math.min(winStart, full.length - target.length));
        }
        return op;
      }
      return op;
    },

    /** 向头部补挂一批更早消息；返回实际补挂条数（0 = 没有更早的了） */
    loadOlder() {
      if (winStart <= 0) return 0;
      const next = Math.max(0, winStart - page);
      const prepend = full.slice(next, winStart).map(clone);
      winStart = next;
      target.splice(0, 0, ...prepend);
      return prepend.length;
    },
  };
}
