# CONTEXT.md — 待办清单（todo）

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个单页的轻量待办清单：**左侧固定侧栏管理分组**（新建 / 改名 / 删除，选哪个分组就只看 / 创建哪个分组的任务）；右栏是任务区：添加（支持标题 + 多行描述）、勾选完成、删除（5 秒倒计时后才进垃圾桶）、点任务看详情、按状态筛选、一键清除已完成；带一个可还原 / 可彻底删除的垃圾桶（彻底删除需二次确认）。每条任务记录并展示创建时间与最近一次状态变更时间。数据保存在本机（NoneOS 存储），关掉再回来还在。

## 使用指南

页面是**左右两栏** `.shell`：左栏 `.side`（固定宽度 190px、`position: sticky`，窄屏 ≤620px 时自动变为顶部横向分组条）只负责分组；右栏 `.main` 是任务区。

### 左栏（分组）

1. **新建分组**：顶部输入框输名字 → 回车或点「新建」；重名会自动加序号（如「公司 2」）。
2. **切换分组**：下方列表依次是「全部任务」+ 各分组，每项右侧是本分组的任务数（不计垃圾桶）；**点哪个就只在这个分组里看和创建任务**，当前选中项高亮。
3. **改名 / 删除**：选中某个具体分组后，列表下方出现「改名」「删除」——「改名」会把顶部输入框切为改名模式（预填原名、按钮变「保存」、出现「取消」与「正在改名：xxx」提示）；「删除」二次确认后组内任务自动移入「默认」。「默认」分组的删除键置灰不可用，列表顶部的「全部任务」不提供改名 / 删除。

### 右栏（任务）

4. **添加**：右上「＋ 添加任务」→ 弹窗里是多行输入框（4 行高）：**第一个非空行 = 标题，其后的内容（含换行）= 描述**；多行框里回车是换行，所以只能点「添加」提交（内容全空时禁用）。弹窗会提示「将加入分组：「xxx」」——归属**当前选中的分组**（在「全部任务」下则归默认分组）。
5. **筛选**：`全部 / 未完成 / 已完成 / 🗑 垃圾桶` 按钮组，与左栏分组叠加生效；垃圾桶标签带数量。垃圾桶视图显示所有分组的垃圾桶条目（忽略分组）。
6. **勾选 / 删除（倒计时）**：左侧 `st-checkbox` 勾选完成（文字加删除线变灰）；右侧按钮点一下 ✕ 开始 **5 秒倒计时**（整行变错误容器色、副标题逐秒倒计时、图标变 ↩），倒计时中再点即撤销，倒计时结束自动进垃圾桶。
7. **查看详情**：点任务正文区（标题/描述/时间那块）弹只读详情：分组、完整标题与描述、状态、创建 / 状态变更 / 删除时间；**底部只有「关闭」**。列表里的描述只显两行摘要。
8. **垃圾桶**：每条可「还原」或 🗑 **彻底删除**（二次确认）；底部「清空垃圾桶」（空时禁用）。
9. **时间信息**：副标题格式 `分组名 · 创建于 MM-DD 时:分`（跨年带年份），切换过完成态追加 ` · 完成于 …` / ` · 恢复于 …`；垃圾桶条目显示 `分组名 · 删除于 … · 创建于 …`；旧数据无时间记录显示「创建时间未知」。
10. **底部栏**：列表视图显示当前分组范围内的「N 项未完成 · 共 M 项」+「清除已完成」（无已完成项时禁用，**只清当前分组范围**）；垃圾桶视图显示「垃圾桶 N 项」+「清空垃圾桶」。

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

- 存储空间：`getStorage("conjure-todo-app")`；键两个：`"todos"`（任务）与 `"groups"`（分组）。
- `groups` 值：`Array<{ id: string, name: string }>`，**首项固定为默认分组** `{ id: "default", name: "默认" }`；常量 `DEFAULT_GROUP_ID = "default"` / `DEFAULT_GROUP_NAME = "默认"`。新分组 id 为 `"g" + Date.now().toString(36) + random`。读取时过滤掉非法项；若不含 `default` 则自动在头部补上（旧数据没有 `groups` 键时也走这条，于是开局就有一个「默认」分组）。
- `todos` 值：`Array<Todo>`，`Todo = { id, text, desc, groupId, done, createdAt, statusChangedAt, deletedAt, pendingDeleteAt }`（时间字段均为 `number|null`），新增项置于数组首位。
- `groupId`：任务所属分组 id；旧数据没有则归入 `"default"`（不存在「无分组」状态）。删除分组时组内任务的 `groupId` 改回 `"default"`。
- `text`：标题（多行输入的第一个非空行）。`desc`：描述（标题之后的所有行，保留内部换行；无描述为空字符串），旧数据读取时补 `""`。
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
| `groups` | 分组表 `Array<{ id, name }>`（首项固定为默认分组） | `[{id:"default",name:"默认"}]` |
| `groupFilter` | 分组过滤：`"all"` 或某分组 id（侧栏选中项） | `"all"` |
| `groupDraft` | 侧栏输入框值（新建与改名共用） | `""` |
| `editingGroupId` | 正在改名的分组 id；`null` = 新建模式（决定按钮文案「新建 / 保存」与展开标题） | `null` |
| `addGroupHint` | 添加弹窗里「将加入分组：「xxx」」的提示文案（`openAdd` 时预计算） | `""` |
| `emptyText` | 空视图提示文案（按 `view` + `groupFilter` 由 `updateEmptyText()` 生成） | 全部视图的提示语 |
| `nowTick` | 倒计时刷新用的当前时间戳；每次 tick 写入以驱动界面重算剩余秒数 | `0` |
| `confirmOpen` | 二次确认对话框 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `confirmTitle` / `confirmText` | 确认框标题与正文 | `""` |
| `purgeTarget` | 待彻底删除的目标：条目 `id` 或 `"ALL"`（清空垃圾桶） | `null` |
| `confirmKind` | 确认框类型：`"purge"`（彻底删除） / `"deleteGroup"`（删除分组） | `"purge"` |
| `confirmGroupId` | 待删除的分组 id（`confirmKind = "deleteGroup"` 时用） | `null` |
| `addOpen` | 「添加任务」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detailOpen` | 「任务详情」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detail` | 详情弹窗的展示对象快照（字段见下），打开时用 `buildDetail(todo)` 算好 | 空对象（各字段为空串 / `false`） |

`detail` 快照字段（**文案全部预计算**，模板只读字段，原因见踩坑 005）：`{ title, desc, hasDesc, groupText, statusText, createdText, statusChangedText, deletedText }`。

另有非响应式实例属性 `_tickId`（倒计时轮询的定时器句柄，见「关键流程」）。

### 计算属性（proto getter）

| getter | 含义 |
| ------ | ---- |
| `inTrashView` | `view === "trash"`，决定渲染哪套列表 / 底部栏（模板里两处 `o-if` 用它切换） |
| `activeTodos` | `todos` 中 `deletedAt` 为空的（含倒计时中的），统计与列表筛选都基于它 |
| `trashTodos` | `todos` 中 `deletedAt` 非空的 |
| `trashBadge` | 垃圾桶标签上的数量后缀（0 时为空串） |
| `scopedActiveTodos` | 当前分组范围内的列表条目（`groupFilter = "all"` 时等于 `activeTodos`），列表 / 统计 / 清除已完成都基于它 |
| `visibleTodos` | 当前视图要渲染的列表（垃圾桶视图直接给 `trashTodos`，忽略分组） |
| `remaining` | `scopedActiveTodos` 中未完成数量 |
| `doneCount` | `scopedActiveTodos` 中已完成数量（同时决定「清除已完成」是否禁用） |
| `draftGroupId` | 新任务将归入的分组：浏览某分组时即该分组，否则默认分组 |
| `allCountText` | 侧栏「全部任务」的计数文案（不含垃圾桶） |
| `canModifyGroup` | `groupFilter !== "all"`，决定侧栏底部「改名 / 删除」是否出现 |
| `editingGroupName` | 正在改名的分组名（侧栏提示用） |
| `groupSubmitLabel` | 侧栏提交按钮文案：「新建」/「保存」（改名时） |
| `isListEmpty` | `visibleTodos.length === 0`，控制 `o-if` 空状态 |

### 组件与页面骨架

- 页面结构自上而下：**左右两栏 `.shell`** → 左栏 `<aside class="side">`（标题 → 新建输入框 + 按钮 → 改名提示 → 分组列表 `.glist`（「全部任务」+ `o-fill :value="groups"`）→ 选中具体分组时出现的 `.side-actions`（改名 / 删除））；右栏 `<div class="main">`（标题栏 `.top`（h1 + 副标题 + 「＋ 添加任务」）→ 筛选按钮组 → 列表（列表视图 / 垃圾桶视图二选一）→ 空状态 → 底部栏（两种视图各一份））→ 三个 `st-dialog`（**添加任务**、**任务详情**、**统一二次确认**）。
- **侧栏放页面内而非弹窗里**：侧栏需要 `o-fill` 循环分组并在行内传 `$data.id` 调方法，而弹窗内 `$host` / `$data` 的行为不可靠（踩坑 005）。
- **绑定写法要区分层级（踩坑 006）**：页面**根级**元素用裸方法名 / data 字段（`class:active="isGroupActive('all')"`、`on:click="setGroup('all')"`）；**`o-fill` / `o-if` 内部**用 `$host.方法($data.id)`。根级写 `$host.xxx()` 会报 `Error evaluating element expression` 且绑定静默失效。
- 窄屏（≤620px）：`.shell` 改列向、`.side` 不再 sticky 而是通栏、`.glist` 改横向 wrap。
- `st-dialog` 用法统一为：`sync:open="xxxOpen"` + `auto-close`，`slot="headline"` 放标题、`slot="actions"` 放按钮；`st-dialog` 内直接 `querySelectorAll('st-button')` 能拿到两个操作按钮（`slot="actions"` 里的 div 不影响）。
- `.dialog-field { width: 100%; }`：弹窗内输入框只改宽度，**不覆盖 `st-input` 的 `display`**（原因见踩坑 004）。

### 时间显示（proto 方法）

| 方法 | 作用 |
| ---- | ---- |
| `formatTime(ts)` | 时间戳 → `MM-DD HH:mm`；跨年补为 `YYYY-MM-DD HH:mm`；非 number / 非法值返回「未知」 |
| `timeMeta(todo)` | 列表项副标题，按优先级：倒计时中 → `🗑 N 秒后移入垃圾桶（点 ↩ 可撤销）`；已在垃圾桶 → `删除于 … · 创建于 …`；其余 → `创建于 …`（+ 有 `statusChangedAt` 时追加 ` · 完成于 …` / ` · 恢复于 …`） |
| `isPending(todo)` / `pendingSeconds(todo)` | 是否处于倒计时 / 剩余秒数（用 `nowTick` 与 `TRASH_DELAY_MS` 算，向上取整） |
| `deleteButtonIcon(todo)` / `deleteButtonTitle(todo)` | 同一个按钮的状态化外观：倒计时中为 `↩`「撤销删除」，否则为 `✕`「删除（5 秒后移入垃圾桶）」 |
| `openAdd()` / `closeAdd()` | 打开 / 关闭添加弹窗（两者都会重置 `draft` 为空；`openAdd` 不给残留草稿） |
| `submitAdd()` | 弹窗内提交入口：调 `addTodo()`，**成功才关弹窗**（多行输入回车 = 换行，所以只有按钮会调它） |
| `parseDraft(raw)` | 多行文本 → `{ title, desc }`：第一个非空行作标题，其后全部行（含内部换行）作描述；无任何非空行返回 `null` |
| `buildDetail(todo)` | 生成详情弹窗的展示对象（标题 / 描述 / 状态文案 / 三个时间文案均在此算好） |
| `openDetail(id)` / `closeDetail()` | 打开详情（生成快照） / 关闭详情 |
| `groupName(id)` / `groupCountText(id)` / `isGroupActive(id)` | 分组名（找不到回「默认」） / 分组内任务数（不计垃圾桶） / 是否为当前选中分组（供侧栏高亮） |
| `setGroup(id)` | 切换选中分组（并重算空状态文案） |
| `submitGroup()` / `startEditGroup(id)` / `cancelEditGroup()` | 新建或保存改名 / 进入改名模式 / 取消改名 |
| `requestDeleteGroup(id)` / `deleteGroup(id)` | 删除分组：前者弹二次确认，后者真正执行（任务移入默认分组并落盘） |
| `updateEmptyText()` | 按当前 `view` + `groupFilter` 生成空状态文案 |
| `confirmAction()` | 确认弹窗统一入口：按 `confirmKind` 分发「彻底删除」与「删除分组」 |

模板在 `o-fill` 项内以 `{{$host.timeMeta($data)}}` / `attr:title="$host.deleteButtonTitle($data)"` 调用；`timeMeta` 读了 `this.nowTick`，因此倒计时数字能随 tick 重渲染（实测 5→1 秒逐秒更新）。

## 关键流程

- **添加**：页面上的「＋ 添加任务」→ `openAdd()`（清空 `draft`、`addOpen = true`）→ 弹窗内 `st-textarea` 输入 → 「添加」按钮调 `submitAdd()` → `parseDraft()` 把多行文本拆成标题 / 描述 → `addTodo()` 返回布尔，**只在成功时**由 `submitAdd()` 关闭弹窗；`addTodo()` 往 `todos` 头部插入带 `createdAt` 的新条目并 `persistTodos()`。
- **查看详情**：点任务 `.body` → `openDetail(id)` 用 `buildDetail(todo)` 生成展示快照并打开弹窗；弹窗只读，关闭用 `closeDetail()`（增删改一律回到列表上操作）。
- **启动**：`index.html` 加载 ofa.js / router / st-boot → `o-app` 按 `app-config.js` 载入 `pages/home.html` → 页面工厂里 `load("/nos/storage/main.js")`、`getStorage("conjure-todo-app")` → `ready()` 先 `loadGroups()` 再 `loadTodos()`（分组要先就位，列表渲染时才能显示分组名）→ 渲染 `o-fill`。
- **分组**：`loadGroups()` / `persistGroups()` 读写 `groups` 键；`setGroup(id)` 切侧栏选中项并重算空状态；新建 / 改名合并在 `submitGroup()`（看 `editingGroupId` 分支），删除走 `requestDeleteGroup()` → `confirmAction()` → `deleteGroup()`（任务 `groupId` 改回 `default`、若正在浏览该分组则回到 `all`）。
- **改动数据**：`addTodo` / `toggleTodo` / `clearDone` / `restoreTodo` / `confirmAction` / `deleteGroup` 都会重建 `this.todos` 后调 `persistTodos()` 写回存储；模板由 ofa 响应式更新。
- **筛选**：`setView(value)` 只改 `view` 与 `emptyText`，`visibleTodos` 随之重算，不动数据。
- **删除倒计时（核心机制）**：`handleDeleteClick(id)` 判分支——无 `pendingDeleteAt` 则 `startPendingDelete`（写入 `pendingDeleteAt`、写一次 `nowTick`、`startTicker()`），已有则 `cancelPendingDelete`（置 `null`）。`startTicker()` 用自终止的 `setTimeout` 链（`_tickId`，步长 `TICK_MS`）：每步写 `nowTick` 驱动界面刷新剩余秒数，把 `now - pendingDeleteAt >= TRASH_DELAY_MS` 的条目改为 `deletedAt = Date.now()` 并落盘；**没有倒计时条目时不再调度下一步**，不会留下常驻定时器。
- **彻底删除 / 删除分组**：`purgeTodo(id)` / `emptyTrash()` / `requestDeleteGroup(id)` 都只设置 `confirmKind` + 目标（`purgeTarget` 或 `confirmGroupId`）与确认文案、打开 `st-dialog`（此阶段不删任何东西）；只有 `confirmAction()` 才真正执行并落盘，`closeConfirm()` 则取消。
- **时间记录**：`addTodo` 写入 `createdAt`；`toggleTodo` 每次切换写入 `statusChangedAt`；两者都随 `persistTodos()` 落盘。

**核心链路（实测清单，功能演进时同步扩充）**：① 打开应用渲染列表与计数；② 点「＋ 添加任务」弹窗（空输入时「添加」禁用）→ 多行输入提交后标题 / 描述分别正确、弹窗关闭、草稿清空；点「取消」关掉不新增，重开弹窗草稿为空；③ 勾选/取消勾选（删除线 + 计数变化 + 副标题出现「完成于/恢复于 …」）；④ 四个筛选视图切换与空状态文案；⑤ 点 ✕ 后 5 秒倒计时（逐秒递减、pending 样式、图标变 ↩）→ 自动进垃圾桶；⑥ 倒计时中点 ↩ 撤销（条目保留、不再倒计时）；⑦ 垃圾桶视图还原（回列表且不影响计数）；⑧ 彻底删除单条（弹框 → 取消不删 → 确认才删）；⑨ 清空垃圾桶（空时按钮禁用，弹框带条数，取消/确认均正确）；⑩ 进垃圾桶后硬刷新仍在（`deletedAt` 持久化）；⑪ 清除已完成（含无已完成项时的禁用态，且不误删垃圾桶与倒计时中的条目）；⑫ 重开后数据仍在；⑬ 长列表（含多行描述）可滚到底；⑭ 每条任务显示创建时间，状态变更后时间实时更新，旧数据显示「创建时间未知」；⑮ 点任务正文区弹详情（标题 / 描述全文 / 状态 / 三个时间正确），点勾选框不会误开详情；⑯ 详情弹窗底部只有「关闭」，点它关闭弹窗（列表内与垃圾桶内的条目都一样）；⑰ 分组（左栏）：新建两个分组后侧栏出现对应项（重名自动加序号），点某项即选中高亮且只看该分组；在分组下添加的任务归入该分组（元信息与弹窗提示均正确），“全部任务”下添加则归默认；改名同步到侧栏与列表元信息；删除需二次确认（取消不删；确认后组内任务移入默认并落盘）；「默认」的删除键禁用，选中「全部任务」时不出现改名/删除；底部统计随分组变化；「清除已完成」只清当前分组范围；刷新后分组与归属仍正确。

## 踩坑索引

> 一坑一文件收在 `pitfalls/` 目录（命名与格式见 `pitfalls/README.md`）；本表只放索引，禁止把坑的正文写进本表。使用方式：按标题判断与本回合任务是否相关，命中才精读对应文件。

| 编号 | 标题 | 文件 |
| ---- | ---- | ---- |
| 001 | 页面 `:host` 没做成滚动容器，长列表被裁掉且无法滚动 | `pitfalls/001-host-must-be-scroll-container.md` |
| 002 | 预览通道两个验证陷阱：增量刷新不重置页面状态、应用首帧日志捕获不到 | `pitfalls/002-preview-channel-verification-traps.md` |
| 003 | 重构时删了 proto 方法、模板仍在调用，报 `function "xxx" not found` | `pitfalls/003-template-callback-must-exist.md` |
| 004 | 给 `st-input` 覆盖 `display` 会让真实可输入区缩成 156px；后台标签页里弹窗动画被冻结，rect 量出的尺寸是缩放假象 | `pitfalls/004-st-input-display-override-and-frozen-anim.md` |
| 006 | 页面根级绑定里写 `$host.xxx()` 会报 `Error evaluating element expression`（根级要用裸方法名） | `pitfalls/006-host-in-root-level-binding.md` |
