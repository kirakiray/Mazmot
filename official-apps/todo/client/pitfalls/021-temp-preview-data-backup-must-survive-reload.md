# 021 · 临时改预览数据时，备份必须挂 localStorage（挂 `window` 会被 reload 抹掉，且 `setItem(key, undefined)` 会清掉数据）

## 事故经过

想临时往预览里塞两条归档数据看新功能渲染，于是：

```js
// ❌ 错：备份挂在 window 上
window.__tmpBackup = await s.getItem('todos');
await s.setItem('todos', [...cur, 临时两条]);
sessionStorage.setItem('todo-ui-state', JSON.stringify({ view: 'archived', ... }));
location.reload();     // ← 这一步把 window.__tmpBackup 一起销毁了
```

看完成效后想还原，在**重载后的新页面**执行：

```js
await s.setItem('todos', window.__tmpBackup);   // undefined！
```

结果 `todos` 被写成 `undefined`，**用户真实数据在预览存储里消失**（后续 `getItem('todos')` 返回 undefined，`.map` 直接 TypeError）。所幸测试用例的 `localStorage.__todo_test_backup_v1` 里有当场备份，已立即还原（todos 3 条 / groups 2 个 / ui.sideWidth 239 全部回来）。

## 两条硬规则

1. **跨 reload 的临时状态一律存 `localStorage` / `sessionStorage`**（`window.__xxx` 只活在当前页面实例里，reload 后为 `undefined`）——测试用例的 `T` 同理，这正是「reload 之后不依赖 T」的原因（踩坑 019）。
2. **写存储前先校验值**：`setItem(key, undefined)` / `null` 这类调用会把用户数据抹掉且不报错。凡是"还原备份"的代码，先判空再写：

```js
const bak = JSON.parse(localStorage.getItem('__todo_test_backup_v1') || 'null');
if (!bak || !Array.isArray(bak.todos)) throw new Error('备份缺失，放弃还原');
await s.setItem('todos', bak.todos);
```

## 附带结论：改完预览数据后如何自证干净

1. `getItem` 读回 `todos` / `groups` / `ui`，比对改动前记下的期望值（标题、done、deletedAt、sideWidth）；
2. 确认 `localStorage.__todo_test_dirty` 已清、`sessionStorage` 会话状态已清；
3. 再 `location.reload()`（单独一条 eval）后用 `eval` 读页面渲染结果（列表文案 / 底栏统计 / 徒标），与用户原状一致才算收尾。
