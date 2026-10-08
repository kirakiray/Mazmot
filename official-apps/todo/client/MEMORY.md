# MEMORY.md — 待办清单（todo）

项目记忆体：每回合**有改动**就在下方顶部追加一条（日期 / 改了什么 / 为什么 / 验证结论），最新在最上；纯讨论不记。容量上限 50 条：满 50 先把最旧 20 条压缩成 3–4 条（只留仍生效的决策与约束、用户偏好、未解决待办）。完整规则见 AGENTS.md「记忆体规则」。

## 记录

### 2026-10-08 · 新增垃圾桶（倒计时删除 + 还原 + 二次确认彻底删除）

- **改了什么**：`pages/home.html` 新增垃圾桶功能——数据字段 `pendingDeleteAt`（倒计时中）/ `deletedAt`（已在垃圾桶）；点 ✕ 开始 5 秒倒计时（常量 `TRASH_DELAY_MS=5000`、轮询 `TICK_MS=200`），期间条目变错误容器色、副标题逐秒倒计时、图标变 ↩（再点即撤销），到点自动进垃圾桶；筛选栏新增「🗑 垃圾桶」视图（带数量），内可「还原」或 🗑 彻底删除，底部「清空垃圾桶」；彻底删除与清空均走 `st-dialog` 二次确认（`purgeTarget` = 条目 id 或 `"ALL"`，只有 `confirmPurge()` 才真删）；统计（未完成/共 N 项）只算非垃圾桶条目；`clearDone` 改为不误删垃圾桶与倒计时中的条目；新增 `formatTime/timeMeta/isPending/pendingSeconds/deleteButtonIcon/deleteButtonTitle` 等方法。
- **为什么**：用户要求“添加一个垃圾桶，删除后倒计时 5 秒进入，可还原、可在垃圾桶彻底删除（需二次提醒）”。
- **设计决策**：同一条目用 `pendingDeleteAt`/`deletedAt` 两个时间戳表达生命周期，不另建垃圾桶数组（清空/还原都是改字段）；倒计时**不跨刷新恢复**（`loadTodos` 一律置 `null`），避免隔天打开被“补刀”删掉；轮询用自终止的 `setTimeout` 链，没有倒计时条目时不再调度，不留常驻定时器。
- **验证结论**（预览实测）：倒计时精确（带时间戳测量：0.98s→5 秒、1.98s→4…4.98s→1、5.98s 时已入垃圾桶）；撤销后条目保留且不再倒计时；还原后落盘正确；彻底删除先弹框（取消不删、确认才删）；清空垃圾桶弹框带条数、空时按钮禁用；垃圾桶里条目不计入计数（显示「2 项未完成 · 共 2 项」）；进垃圾桶后硬刷新仍在（`deletedAt` 持久化）；清除已完成不误删倒计时中的条目（实测保留）；40 条长列表滚到底（`scrollHeight 3052`、`scrollTop` 到 2247，末条与底栏在视口内）；控制台无 error。
- **踩到的坑（已沉淀 `pitfalls/003`）**：重构时把 `deleteTodo`/`clearDone` 一起改写，忘了补回 `clearDone`，模板 `on:click="clearDone"` 报 `function "clearDone" not found`——页面渲染正常、只有该按钮失效；已补回并重测。改 `proto` 方法后必须读控制台确认。
- **数据说明**：测试期间曾把存储临时改成 40 条测试数据，已恢复为用户的 2 条（`22222` `createdAt=1791446821823`、`111111` `createdAt=1791446819849`，均未完成、不在垃圾桶），字段值与原数据一致。

### 2026-10-08 · 新增创建时间 / 状态变更时间的记录与展示

- **改了什么**：`pages/home.html`：数据模型每条任务新增 `createdAt`（添加时写入）与 `statusChangedAt`（`toggleTodo` 每次切换完成态刷新）两个毫秒时间戳；`loadTodos` 规范化时为缺失字段补 `null`；新增 proto 方法 `formatTime(ts)`（`MM-DD HH:mm`，跨年补年份，非法值返回「未知」）与 `timeMeta(todo)`（`创建于 …` + 有状态变更时追加 ` · 完成于 …` / ` · 恢复于 …`）；模板在每条任务文字下方加 `.meta` 副标题行（12px、`--md-sys-color-on-surface-variant`），`.item .text` 包进新的 `.body` 纵向容器。
- **为什么**：用户要求“添加任务时显示创建时间，修改状态时记录修改时间”。
- **设计决策**：只存时间戳不存格式化文本（显示格式随时可改）；不另存操作类型，用 `done` 推断“完成/恢复”字样；**历史数据不伪造时间**，缺字段显示「创建时间未知」。
- **验证结论**（预览实测）：添加后副标题为「创建于 10-08 16:03」；勾选后实时变为「创建于 … · 完成于 …」，取消勾选变为「创建于 … · 恢复于 …」（`o-fill` 内 `{{$host.timeMeta($data)}}` 的响应式正常）；已完成筛选视图下时间同样正确；存储里确实带有两个时间戳字段；旧数据（无字段）显示「创建时间未知」且未报错；控制台无应用报错；DOM 量到 meta 行 12px、灰色。测试新增的条目已删除，存储已恢复为用户原有 3 条（`22222`、`1111`、`写周报`，`createdAt`/`statusChangedAt` 均为 `null`）。

### 2026-10-08 · 修复滚动容器 + 补关键路径埋点 + 补齐文档体系

- **改了什么**：`pages/home.html` 的 `:host` 由 `min-height: 100vh`（`overflow: visible`）改成 `height: 100%; overflow-y: auto`；工厂函数补 `[init]` 埋点（含 `window.__todoInitCount` 计数侧信道），`loadTodos` / `persistTodos` 补 `[storage]` 日志并统一用 `console.error` 打失败分支，`addTodo`/`toggleTodo`/`deleteTodo`/`clearDone`/`setView` 各补 `[todo]` 日志；按实际代码填充 CONTEXT.md、MEMORY.md，新建 `pitfalls/001`、`pitfalls/002` 并登记索引。
- **为什么**：`:host` 未做滚动容器违反项目 AGENTS.md 硬性约定，长列表会被 `o-router` 的 `overflow: hidden` 裁掉且滚不动（真实隐患，本轮发现并修复）；埋点缺失同样违反硬性约定，会让后续排查只能靠猜。
- **验证结论**（预览实测，`preview` 工具）：控制台无应用报错；核心链路逐步实测通过——添加（含空输入按钮禁用、输入框自动清空、新项置顶）、勾选/取消勾选（删除线 + 计数实时变化）、三个筛选视图与空状态文案、单条删除、「清除已完成」（无已完成项时禁用）、硬刷新后数据仍在（存储 `conjure-todo-app.todos` 与 DOM 一致）；塞 40 条临时数据实测滚动：`scrollHeight 3052 / clientHeight 805`，`scrollTop` 可到底（2247 = 满值），最后一条与底部栏可见，测完已把存储恢复为原有 3 条（`22222`、`1111`、`写周报`，均未完成）。
- **遗留 / 注意**：`preview action=app` 增量刷新不会重置页面状态，且应用首帧日志不被预览通道捕获——验证初始化/持久化要用 `location.reload()` 硬刷新或直接读存储，详见 `pitfalls/002-preview-channel-verification-traps.md`。
