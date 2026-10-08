# CONTEXT.md — 待办清单（todo）

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个单页的轻量待办清单：添加、勾选完成、删除（5 秒倒计时后才进垃圾桶）、按状态筛选、一键清除已完成；带一个可还原 / 可彻底删除的垃圾桶（彻底删除需二次确认）。每条任务记录并展示创建时间与最近一次状态变更时间。数据保存在本机（NoneOS 存储），关掉再回来还在。

## 使用指南

页面自上而下四个区块，对应四条操作路径：

1. **添加**：顶部输入框输入内容 → 回车或点「添加」按钮（输入为空时按钮禁用）。新事项插入列表顶部，输入框自动清空，并带上创建时间。
2. **筛选**：`全部 / 未完成 / 已完成 / 🗑 垃圾桶` 按钮组切换视图，当前选中项为 `filled` 样式，其余为 `text` 样式；垃圾桶标签会带未清空的数量。空视图时显示对应提示文案（`emptyText` 随筛选切换）。
3. **勾选 / 删除（倒计时）**：每行左侧 `st-checkbox` 勾选完成（文字加删除线并变灰）；右侧按钮点一下 ✕ 开始 **5 秒倒计时**（条目整行变成错误容器色，副标题显示「🗑 N 秒后移入垃圾桶（点 ↩ 可撤销）」），倒计时中再点该按钮（此时图标为 ↩）即撤销；倒计时结束条目自动进入垃圾桶。
4. **垃圾桶**（切到「🗑 垃圾桶」视图）：每条可「还原」回列表，或点 🗑 **彻底删除**（弹二次确认对话框，确认后才真的删）；底部「清空垃圾桶」同样先二次确认，垃圾桶为空时该按钮禁用。垃圾桶里的条目不计入「N 项未完成 / 共 M 项」。
5. **时间信息**：每条任务文字下方一行灰色小字，格式 `创建于 MM-DD 时:分`（跨年带年份）；切换过完成态后追加 ` · 完成于 …` / ` · 恢复于 …`（按当前 `done` 状态取词），随勾选实时更新；垃圾桶里的显示 `删除于 … · 创建于 …`。历史数据无时间记录时显示「创建时间未知」。
6. **底部栏**：列表视图显示「N 项未完成 · 共 M 项」+「清除已完成」（无已完成项时禁用）；垃圾桶视图显示「垃圾桶 N 项」+「清空垃圾桶」。

## 目录结构

```
client/
├── index.html       # 入口：o-router fix-body > o-app，引 ofa.js / router / st-boot
├── app-config.js    # 仅导出 home 路由（./pages/home.html）
├── app.json         # 应用元信息（name=todo、displayName=待办清单、icon=✅）
└── pages/
    └── home.html    # 唯一页面模块：样式 + 模板 + 脚本（全部逻辑在此）
```

（`pitfalls/` 为踩坑库，`backup/` 为系统自动备份目录，均不属于运行时资源。）

## 数据模型

### 持久化（NoneOS 存储）

- 存储空间：`getStorage("conjure-todo-app")`；键：`"todos"`。
- 值：`Array<Todo>`，`Todo = { id, text, done, createdAt, statusChangedAt, deletedAt, pendingDeleteAt }`（后四个均为 `number|null` 时间戳），新增项置于数组首位。
- `id` 生成：`Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`。
- `createdAt`：创建时刻的 `Date.now()` 毫秒时间戳，添加时写入，之后不再变。
- `statusChangedAt`：最近一次切换完成态的时刻；未切换过为 `null`；勾选与取消勾选都会刷新（是否为「完成」由 `done` 推断，不另存操作类型）。
- `pendingDeleteAt`：点删除后开始倒计时的时刻；非空 = 正处于倒计时（仍在列表、仍计入统计）。倒计时时长常量 `TRASH_DELAY_MS = 5000`，轮询步长 `TICK_MS = 200`。**该字段不跨刷新恢复**（`loadTodos` 一律置 `null`），避免隔天打开时被“补刀”删掉。
- `deletedAt`：进入垃圾桶的时刻；非空 = 已在垃圾桶，不计入列表统计也不参与筛选（只在垃圾桶视图可见）。
- 读取时做一次规范化（`String(id)` / `String(text || "")` / `!!done`，时间字段非 number 时一律置 `null`）；**旧数据没有时间字段，显示为「创建时间未知」而不伪造时间**。非数组或读取异常时保持空列表并 `console.error`。

### 页面状态（data）

| 字段 | 含义 | 初始值 |
| ---- | ---- | ------ |
| `draft` | 输入框草稿（`sync:value` 双向绑定） | `""` |
| `view` | 当前筛选：`all` / `active` / `done` / `trash` | `"all"` |
| `todos` | 全量待办数组（含垃圾桶里的） | `[]` |
| `emptyText` | 空视图提示文案（`setView` 时按筛选切换） | 全部视图的提示语 |
| `nowTick` | 倒计时刷新用的当前时间戳；每次 tick 写入以驱动界面重算剩余秒数 | `0` |
| `confirmOpen` | 二次确认对话框 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `confirmTitle` / `confirmText` | 确认框标题与正文 | `""` |
| `purgeTarget` | 待彻底删除的目标：条目 `id` 或 `"ALL"`（清空垃圾桶） | `null` |

另有非响应式实例属性 `_tickId`（倒计时轮询的定时器句柄，见「关键流程」）。

### 计算属性（proto getter）

| getter | 含义 |
| ------ | ---- |
| `inTrashView` | `view === "trash"`，决定渲染哪套列表 / 底部栏（模板里两处 `o-if` 用它切换） |
| `activeTodos` | `todos` 中 `deletedAt` 为空的（含倒计时中的），统计与列表筛选都基于它 |
| `trashTodos` | `todos` 中 `deletedAt` 非空的 |
| `trashBadge` | 垃圾桶标签上的数量后缀（0 时为空串） |
| `visibleTodos` | 当前视图要渲染的列表（垃圾桶视图直接给 `trashTodos`） |
| `remaining` | `activeTodos` 中未完成数量 |
| `doneCount` | `activeTodos` 中已完成数量（同时决定「清除已完成」是否禁用） |
| `isListEmpty` | `visibleTodos.length === 0`，控制 `o-if` 空状态 |

### 时间显示（proto 方法）

| 方法 | 作用 |
| ---- | ---- |
| `formatTime(ts)` | 时间戳 → `MM-DD HH:mm`；跨年补为 `YYYY-MM-DD HH:mm`；非 number / 非法值返回「未知」 |
| `timeMeta(todo)` | 列表项副标题，按优先级：倒计时中 → `🗑 N 秒后移入垃圾桶（点 ↩ 可撤销）`；已在垃圾桶 → `删除于 … · 创建于 …`；其余 → `创建于 …`（+ 有 `statusChangedAt` 时追加 ` · 完成于 …` / ` · 恢复于 …`） |
| `isPending(todo)` / `pendingSeconds(todo)` | 是否处于倒计时 / 剩余秒数（用 `nowTick` 与 `TRASH_DELAY_MS` 算，向上取整） |
| `deleteButtonIcon(todo)` / `deleteButtonTitle(todo)` | 同一个按钮的状态化外观：倒计时中为 `↩`「撤销删除」，否则为 `✕`「删除（5 秒后移入垃圾桶）」 |

模板在 `o-fill` 项内以 `{{$host.timeMeta($data)}}` / `attr:title="$host.deleteButtonTitle($data)"` 调用；`timeMeta` 读了 `this.nowTick`，因此倒计时数字能随 tick 重渲染（实测 5→1 秒逐秒更新）。

## 关键流程

- **启动**：`index.html` 加载 ofa.js / router / st-boot → `o-app` 按 `app-config.js` 载入 `pages/home.html` → 页面工厂里 `load("/nos/storage/main.js")`、`getStorage("conjure-todo-app")` → `ready()` 调 `loadTodos()` 读存储并渲染 `o-fill`。
- **改动数据**：`addTodo` / `toggleTodo` / `clearDone` / `restoreTodo` / `confirmPurge` 都会重建 `this.todos` 后调 `persistTodos()` 写回存储；模板由 ofa 响应式更新。
- **筛选**：`setView(value)` 只改 `view` 与 `emptyText`，`visibleTodos` 随之重算，不动数据。
- **删除倒计时（核心机制）**：`handleDeleteClick(id)` 判分支——无 `pendingDeleteAt` 则 `startPendingDelete`（写入 `pendingDeleteAt`、写一次 `nowTick`、`startTicker()`），已有则 `cancelPendingDelete`（置 `null`）。`startTicker()` 用自终止的 `setTimeout` 链（`_tickId`，步长 `TICK_MS`）：每步写 `nowTick` 驱动界面刷新剩余秒数，把 `now - pendingDeleteAt >= TRASH_DELAY_MS` 的条目改为 `deletedAt = Date.now()` 并落盘；**没有倒计时条目时不再调度下一步**，不会留下常驻定时器。
- **彻底删除**：`purgeTodo(id)` / `emptyTrash()` 只设置 `purgeTarget` 与确认文案并打开 `st-dialog`（此阶段不删任何东西）；只有 `confirmPurge()` 才真正过滤掉对应条目并落盘，`closeConfirm()` 则取消。
- **时间记录**：`addTodo` 写入 `createdAt`；`toggleTodo` 每次切换写入 `statusChangedAt`；两者都随 `persistTodos()` 落盘。

**核心链路（实测清单，功能演进时同步扩充）**：① 打开应用渲染列表与计数；② 输入后添加（含按钮禁用态、输入框清空）；③ 勾选/取消勾选（删除线 + 计数变化 + 副标题出现「完成于/恢复于 …」）；④ 四个筛选视图切换与空状态文案；⑤ 点 ✕ 后 5 秒倒计时（逐秒递减、pending 样式、图标变 ↩）→ 自动进垃圾桶；⑥ 倒计时中点 ↩ 撤销（条目保留、不再倒计时）；⑦ 垃圾桶视图还原（回列表且不影响计数）；⑧ 彻底删除单条（弹框 → 取消不删 → 确认才删）；⑨ 清空垃圾桶（空时按钮禁用，弹框带条数，取消/确认均正确）；⑩ 进垃圾桶后硬刷新仍在（`deletedAt` 持久化）；⑪ 清除已完成（含无已完成项时的禁用态，且不误删垃圾桶与倒计时中的条目）；⑫ 重开后数据仍在；⑬ 长列表可滚到底；⑭ 每条任务显示创建时间，状态变更后时间实时更新，旧数据显示「创建时间未知」。

## 踩坑索引

> 一坑一文件收在 `pitfalls/` 目录（命名与格式见 `pitfalls/README.md`）；本表只放索引，禁止把坑的正文写进本表。使用方式：按标题判断与本回合任务是否相关，命中才精读对应文件。

| 编号 | 标题 | 文件 |
| ---- | ---- | ---- |
| 001 | 页面 `:host` 没做成滚动容器，长列表被裁掉且无法滚动 | `pitfalls/001-host-must-be-scroll-container.md` |
| 002 | 预览通道两个验证陷阱：增量刷新不重置页面状态、应用首帧日志捕获不到 | `pitfalls/002-preview-channel-verification-traps.md` |
| 003 | 重构时删了 proto 方法、模板仍在调用，报 `function "xxx" not found` | `pitfalls/003-template-callback-must-exist.md` |
