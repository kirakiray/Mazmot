# MEMORY.md — 待办清单（todo）

项目记忆体：每回合**有改动**就在下方顶部追加一条（日期 / 改了什么 / 为什么 / 验证结论），最新在最上；纯讨论不记。容量上限 50 条：满 50 先把最旧 20 条压缩成 3–4 条（只留仍生效的决策与约束、用户偏好、未解决待办）。完整规则见 AGENTS.md「记忆体规则」。

## 记录

### 2026-10-08 · 修复滚动容器 + 补关键路径埋点 + 补齐文档体系

- **改了什么**：`pages/home.html` 的 `:host` 由 `min-height: 100vh`（`overflow: visible`）改成 `height: 100%; overflow-y: auto`；工厂函数补 `[init]` 埋点（含 `window.__todoInitCount` 计数侧信道），`loadTodos` / `persistTodos` 补 `[storage]` 日志并统一用 `console.error` 打失败分支，`addTodo`/`toggleTodo`/`deleteTodo`/`clearDone`/`setView` 各补 `[todo]` 日志；按实际代码填充 CONTEXT.md、MEMORY.md，新建 `pitfalls/001`、`pitfalls/002` 并登记索引。
- **为什么**：`:host` 未做滚动容器违反项目 AGENTS.md 硬性约定，长列表会被 `o-router` 的 `overflow: hidden` 裁掉且滚不动（真实隐患，本轮发现并修复）；埋点缺失同样违反硬性约定，会让后续排查只能靠猜。
- **验证结论**（预览实测，`preview` 工具）：控制台无应用报错；核心链路逐步实测通过——添加（含空输入按钮禁用、输入框自动清空、新项置顶）、勾选/取消勾选（删除线 + 计数实时变化）、三个筛选视图与空状态文案、单条删除、「清除已完成」（无已完成项时禁用）、硬刷新后数据仍在（存储 `conjure-todo-app.todos` 与 DOM 一致）；塞 40 条临时数据实测滚动：`scrollHeight 3052 / clientHeight 805`，`scrollTop` 可到底（2247 = 满值），最后一条与底部栏可见，测完已把存储恢复为原有 3 条（`22222`、`1111`、`写周报`，均未完成）。
- **遗留 / 注意**：`preview action=app` 增量刷新不会重置页面状态，且应用首帧日志不被预览通道捕获——验证初始化/持久化要用 `location.reload()` 硬刷新或直接读存储，详见 `pitfalls/002-preview-channel-verification-traps.md`。
