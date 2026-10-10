# CONTEXT.md — 待办清单（todo）

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个单页的轻量待办清单：**左侧固定侧栏管理分组**（新建 / 改名 / 删除，宽度可拖拽 150–300px，选哪个分组就只看 / 创建哪个分组的任务）；右侧任务区**吃满剩余宽度**：添加（支持标题 + 多行描述；也能让 **AI 根据一句自然语言描述自动生成标题与描述**）、勾选完成、**编辑已有任务的标题与描述**、**拖拽调整顺序**、删除（5 秒倒计时后才进垃圾桶）、点任务看详情、按视图筛选（**全部 / 已归档 / 垃圾桶**，三个视图都跟随左栏选中分组）、右上「归档已完成」（把已完成的任务收进归档）；带一个可还原 / 可彻底删除的垃圾桶（彻底删除需二次确认）和一个可「取消归档」的归档箱——归档箱内还能按「**全部归档 / 按日期 / 按周**」切换查看方式（按日期按归档日期分组、按周按 ISO 周分组）。每条任务记录并展示创建时间与最近一次状态变更时间。数据保存在本机（NoneOS 存储），关掉再回来还在。

## 使用指南

页面是**两列网格** `.shell`：`grid-template-columns: auto minmax(0, 1fr)`——**左列** = 分组侧栏 `.side`（`position: sticky`、贴着屏幕左边缘，只负责分组；宽度 = `data.sideWidth`，**可拖拽调整 150–300px，默认 190，记忆在存储里**）；**右列** = 任务区 `.main`，**用满剩余宽度**（`width: 100%` + `max-width: 1200px`，避免超宽屏单行文案过长；中途不设任何留白列）。左列宽取 `auto`，实际宽度由 `.side` 自身行内 `width`（`sideWidth`）决定，拖拽只需改这一个 data 字段。视口 ≤620px 时变单列堆叠、侧栏转为顶部横向分组条、拖拽手柄隐藏。

> **历史坑**：曾经为了让任务区落在视口正中，加过一列与侧栏等宽的留白列（`.spacer`）。结果是**侧栏拖宽后右侧白白浪费一大块**（用户反馈），且 `.main` 的 `max-width` 只有 880px。现已改为两列 + 任务区吃满剩余宽度；**不要再加回留白列 / 视口居中那套写法**。

### 左栏（分组）

1. **新建分组**：分组列表**下方**的「新建分组」按钮（前置 `mdi:plus` 图标）→ 弹窗里输名字（回车或点「创建」提交，内容为空时禁用）；重名会自动加序号（如「公司 2」）。
2. **切换分组**：上方列表依次是「全部任务」+ 各分组，每行右侧是本分组的任务数（不计垃圾桶）；**点分组的名字（或计数）就只在这个分组里看和创建任务**，当前选中项高亮。
   - 每行**行高统一 42px**（由 ⋯ 按钮的 34px 与 `.gname` 的 `min-height: 34px` 共同决定），且 `.gname` 用 `align-self: stretch` **撑满整行**——行的垂直内边距已从 `.gitem` 移到 `.gname`，所以**文字上方 / 下方的留白也都在点击区内**（历史 bug：`.gname` 只有 28px 高而行高 42px，上下各约 7px 点不动，用户反馈“item 偏上和下的地方点击不了”）。
   - **所有行（含「全部任务」）的计数右边缘对齐**：「全部任务」是虚拟项、没有 ⋯ 菜单，用等宽（34px）的占位元素 `.gmenu-ghost` 撑出相同位置（历史 bug：没有占位时它的计数比下面各行向右突出 38px，看着突兀）。
3. **行内「⋯」菜单（重命名 / 删除）**：每个**真实分组行**的最右侧有一个 ⋯ 图标按钮（`n-icon icon="mdi:dots-horizontal"`，`title` 为「分组操作：xxx」），点开是下拉菜单（`st-menu`）：
   - 「重命名」→ 打开**改名弹窗**（输入框预填原名、按钮为「保存」，取消不改名）；
   - 「删除」→ 二次确认后组内任务自动移入「默认」；**「默认」分组的「删除」置灰**。
   两个菜单项各带前置图标（重命名 `mdi:pencil` / 删除 `mdi:delete-outline`，放在 `st-menu-item` 的 `prefix` 槽）：禁用态的「删除」由组件自带的 `.item { opacity: 0.38 }` 让图标与文字**一起**变淡，不用额外写禁用样式。
   这个 ⋯ 按钮平时隐藏，**鼠标悬停 / 当前选中 / 键盘聚焦该行时淡入**（触屏等无 hover 设备始终可见，见 `@media (hover: none)`）。列表顶部的「全部任务」是虚拟项（不可改名 / 删除），没有这个按钮；侧栏也**没有底部操作区**（改名、删除都已收进行内菜单）。

4. **调整侧栏宽度**：侧栏右边缘有一条**拖拽手柄** `.resizer`（平时是一条灰短线、鼠标悬停或拖动中变主题色），**按住左右拖动即可调整分组栏宽度（150–300px，默认 190px）**，松手即写入存储（`ui` 键的 `sideWidth`），下次打开保持；拖拽中任务区随剩余宽度实时变化（它是 `1fr`）。

### 右栏（任务）

5. **添加**：右上「添加任务」按钮（前置 `mdi:plus` 图标）→ 弹窗里是多行输入框（4 行高）：**第一个非空行 = 标题，其后的内容（含换行）= 描述**；多行框里回车是换行，所以只能点「添加」提交（内容全空时禁用）。弹窗会提示「将加入分组：「xxx」」——归属**当前选中的分组**（在「全部任务」下则归默认分组）。
   - **AI 添加（同一个弹窗的下半部分）**：用一句自然语言描述要做的事（如「明天下午三点和客户开会，记得先准备报价单」）→ 点「AI 生成」（前置 `mdi:creation` 图标）→ 调平台 AI（`/mz/ai/main.js`）让模型输出 `{title, desc}`，**自动回填到上面的多行输入框**（标题首行 + 描述在后），用户改一改再点「添加」；描述框为空时按钮禁用，请求中按钮变「AI 生成中…」并禁用，成功后提示「AI 已生成，确认或改一改再点「添加」」，失败则在弹窗内红字显示原因且输入内容不丢。
6. **视图筛选**：`全部 / 已归档 / 垃圾桶` 按钮组（已归档前置 `mdi:archive-arrow-down`、垃圾桶前置 `mdi:delete-outline` 图标，后两个标签带数量），与左栏分组叠加生效。
   - **全部**：列表（未归档、未删除的条目，含已完成与未完成两种）。
   - **已归档**：任务在这个视图里「收起来」——**不在列表显示、不计入统计与侧栏分组计数**，但数据没被删。每条可「取消归档」（回到原分组，勾选状态保留，由 `unarchiveTodo()`）或删除（走列表同款的 5 秒倒计时 → 垃圾桶）。**归档视图跟随左栏分组**（与列表视图同一口径）：左栏选中某分组时只显示该分组的归档，选「全部任务」时才是所有分组的归档；顶部有一行说明。
   - **归档视图内的查看方式（子标签）**：说明行下方是 `全部归档 / 按日期 / 按周` 三个子标签，**默认「全部归档」**（平铺、无日期组头，等价于原来的样子）。
     - **按日期**：按归档时刻（`archivedAt`）的**本地日期**分组（用本机时区切分，不用 UTC），**最新的一组排最前**；组头形如「**10-10 周六**」+ 右侧「N 项」（跨年时补 `YYYY-` 前缀）。
     - **按周**：按 **ISO 周**分组（周一为一周起点、取该周周四所在年份与周序号，跨年周不会算错），组头形如「**2026 年第 41 周 · 10-05 ~ 10-11**」+ 右侧「N 项」，同样最新的一组排最前。
     - 两种分组模式下**不带日期组头的那一档仍保持原顺序**（组内顺序 = `archivedTodos` 顺序，即 `todos` 里的顺序）；老数据没有 `archivedAt` 时单独兜底一组「归档时间未知」，因为 key 前缀最小而**排在最后**。
     - 选中哪个子标签会写进 `sessionStorage` 会话状态（键 `archiveGroup`），刷新后仍停在原查看方式；关标签页 / 新窗口回落到「全部归档」。
     - 子标签切换**不筛数据、不改数据**，只改渲染方式（与筛选视图的「已归档」是两级：先选视图，再选组内呈现）。
   - **垃圾桶**：**同样跟随左栏分组**——左栏选中某分组时只显示该分组的垃圾桶条目，选「全部任务」时是全部；底部「清空垃圾桶」也只在当前分组范围内生效（确认框标题与文案都会写明分组名，不会误清其它分组）。
   - **当前筛选与选中分组会被记住**：切换分组 / 筛选时写入 `sessionStorage`，**刷新（F5）后仍停在原来的分组与视图**；关闭标签页或新开窗口则回到默认（「全部任务」+「全部」）。如果记住的分组已被删除，启动时自动回落到「全部任务」。
7. **拖拽排序**：每条任务最左侧有一个拖拽手柄（`mdi:drag-vertical` 图标，平时半透明 opacity 0.45、鼠标悬停到该行时变亮，`title` 为「按住拖动调整顺序：xxx」）。
   - **拖动过程只给引导，不改位**：按住手柄开始拖后，被拖的行原地变淡（`opacity 0.4` + 细描边，作为“源”标记），指针所在位置用**目标行的边缘线**提示落点——`class:drop-before`（插到这行之前，主题色 2px 线画在该行**上边**）+ `class:drop-after`（插到下一行之前 / 末尾，线画在该行**下边**），线左端带一个 9px 圆点；**松手时条目才真正插到指示线位置**并写入存储。按下后未移动就松手、或落点就是原位置时**不动数据也不写盘**。
   - 指示线**不使用坐标计算**：它由行自己的伪元素（`.item.drop-before::after` / `::before`）画在行边缘上（线在行外 5px、恰落在 8px 行间距的中间），所以永远与行对齐——**不要改回“算一个 `top` 再定位浮层”的写法**（那样会因为参照物取错而跑偏，见踩坑 016）。
   - 手柄**只在「全部」视图出现**（归档 / 垃圾桶视图不提供排序）；在某个分组下也能拖，但只能在当前分组可见的条目之间调（其它分组的条目相对顺序不变，任务的 `groupId` 不会被改）。
   - 实现要点（详情见「页面骨架」）：手柄 `touch-action: none`、pointerdown 后监听挂 `window`、**落点判定用逐行 `getBoundingClientRect()` 比较**（不用 `elementFromPoint`，它穿不过页面 shadow；找列表容器用 `closest('.list')`，**不能用 `parentElement`**——它是 rect 全 0 的 `<o-fill>`，见踩坑 016），每个 `.item` 带 `attr:data-id` 供反查。
   - 拖拽**不会自动碌动列表**（长列表要先把目标区域滚进视口再拖）。
8. **勾选 / 编辑 / 删除（倒计时）**：左侧 `st-checkbox`（22px）勾选完成（文字加删除线变灰）；行尾操作区 `.item-actions` 里两个 **34px** 图标按钮（与侧栏分组行 ⋯ 同规格）：铅笔（`mdi:pencil`，`title`「编辑：xxx」，常态 `opacity: 0.7`、悬停变主题色）→ 直接打开详情并进入编辑模式；删除按钮点一下（关闭图标 `mdi:close`）开始 **5 秒倒计时**（整行变错误容器色、副标题逐秒倒计时、图标变撤销图标 `mdi:reply`），倒计时中再点即撤销，倒计时结束自动进垃圾桶。
9. **查看详情 / 编辑**：点任务正文区（标题/描述/时间那块）弹详情：分组、完整标题与描述、状态、创建 / 状态变更 / **归档** / 删除时间；底部是「关闭」+「**编辑**」。列表里的描述只显两行摘要。
   - **编辑**：点「编辑」或列表行上的铅笔图标按钮 → 弹窗切到编辑模式（标题单行输入 + 描述多行输入，**预填当前内容**）→「保存」写回 `text` / `desc` 并回到只读视图（列表与标题实时同步）、「取消」丢弃修改。**标题不能为空**（全空时「保存」置灰）；编辑只改这两项，不影响分组、勾选状态与各时间戳。归档视图的条目也能这样编辑。
10. **垃圾桶**：每条可「还原」或用删除图标（`mdi:delete-outline`）**彻底删除**（二次确认）；底部「清空垃圾桶」（空时禁用）。
11. **时间信息**：副标题格式 `分组名 · 创建于 MM-DD 时:分`（跨年带年份），倒计时中为 `分组名 · N 秒后移入垃圾桶（点撤销按钮可撤销）`，切换过完成态追加 ` · 完成于 …` / ` · 恢复于 …`；垃圾桶条目显示 `分组名 · 删除于 … · 创建于 …`；旧数据无时间记录显示「创建时间未知」。
12. **右上「归档已完成」**（与「添加任务」并排在标题栏右侧 `.top-actions` 里，前置 `mdi:archive-arrow-down` 图标，`title` = 「把当前分组里已完成的任务收进归档（不会删除）」）：把**当前分组范围内**已完成的条目收进归档，当前范围内无已完成项时置灰。**作用范围看分组、不看当前视图**，所以它在 `全部 / 已归档 / 垃圾桶` 三个视图下都常驻显示；不是危险操作，所以不用红色。
13. **底部栏**：`全部` 视图只显示当前分组范围内的「N 项未完成 · 共 M 项」（归档入口已移到右上，底栏不再有按钮）；`已归档` 视图显示「已归档 N 项」；`垃圾桶` 视图显示「垃圾桶 N 项」+「清空垃圾桶」。

> **命名约定**：归档相关的叫法统一为——视图标签「**已归档**」、动作与按钮「**归档已完成**」、归档项上的按钮「**取消归档**」（不用「清除 / 还原」：数据没被删，只是收起来了）。

## 目录结构

```
client/
├── index.html       # 入口：o-router fix-body > o-app，引 ofa.js / router / st-boot
├── app-config.js    # 仅导出 home 路由（./pages/home.html）
├── app.json         # 应用元信息（name=todo、displayName=待办清单、icon=✅）
├── pages/
│   └── home.html    # 唯一页面模块：样式 + 模板 + 脚本（全部逻辑在此）
└── test/            # 场景测试（防迭代回归）：10 个 *.test.json 用例 + 可选本地回放驱动 _driver.js
```

（`pitfalls/` 为踩坑库，`backup/` 为系统自动备份目录，均不属于运行时资源。）

## 数据模型

### 持久化（NoneOS 存储）

- 存储空间：`getStorage("conjure-todo-app")`；键三个：`"todos"`（任务）、`"groups"`（分组）、`"ui"`（界面偏好）。

> 另有**会话状态**（当前筛选 + 选中分组）不进 NoneOS 存储，而是存在浏览器的 `sessionStorage` 键 `"todo-ui-state"`（值 `{ view, groupFilter, archiveGroup }`，其中 `archiveGroup` 是归档视图的查看方式，见 `archiveGroupMode`）。这是经用户明确要求的**豁免**（项目约定数据一律进 `/nos/storage`）：`sessionStorage` 的会话语义正好是「刷新保留、关标签页重置」。详见 MEMORY.md 的豁免记录，**不要把它「修正」回 `/nos/storage`**——那会变成关掉再打开也留在旧分组（超出用户预期）。
- `ui` 值：`{ sideWidth: number }` —— 分组侧栏宽度（px）。读取时用 `clampSideWidth()` 收敛到 150–300（非法 / 缺失回默认 190）；常量 `SIDE_MIN_W = 150` / `SIDE_MAX_W = 300` / `SIDE_DEFAULT_W = 190`。
- `groups` 值：`Array<{ id: string, name: string }>`，**首项固定为默认分组** `{ id: "default", name: "默认" }`；常量 `DEFAULT_GROUP_ID = "default"` / `DEFAULT_GROUP_NAME = "默认"`。新分组 id 为 `"g" + Date.now().toString(36) + random`。读取时过滤掉非法项；若不含 `default` 则自动在头部补上（旧数据没有 `groups` 键时也走这条，于是开局就有一个「默认」分组）。
- `todos` 值：`Array<Todo>`，`Todo = { id, text, desc, groupId, done, createdAt, statusChangedAt, archivedAt, deletedAt, pendingDeleteAt }`（时间字段均为 `number|null`），新增项置于数组首位。
- `archivedAt`：归档时刻；非空 = 已归档（不在列表显示、不计入统计与分组计数、不参与「全部」视图，但仍属于原分组，`groupId` 不变）。旧数据没有该字段，读取时补 `null`。条目只在「已归档」视图可见，取消归档则置回 `null`。**归档与垃圾桶是两个互斥维度**（`archivedAt` / `deletedAt` 可先后置位）：归档项可再被删入垃圾桶，从垃圾桶还原时 `restoreTodo` 会**一并清掉 `archivedAt`**，让它回到列表而不是回归档箱。
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
| `view` | 当前视图：`all` / `archived` / `trash` | `"all"` |
| `archiveGroupMode` | 「已归档」视图内的查看方式：`all`（全部归档，平铺）/ `day`（按归档日期分组）/ `week`（按 ISO 周分组） | `"all"` |
| `todos` | 全量待办数组（含垃圾桶里的） | `[]` |
| `groups` | 分组表 `Array<{ id, name }>`（首项固定为默认分组） | `[{id:"default",name:"默认"}]` |
| `groupFilter` | 分组过滤：`"all"` 或某分组 id（侧栏选中项） | `"all"` |
| `groupDraft` | 「新建 / 改名分组」弹窗输入框值（两种模式共用，`sync:value` 双向绑定） | `""` |
| `editingGroupId` | 正在改名的分组 id；`null` = 新建模式（决定弹窗标题与按钮文案「创建 / 保存」） | `null` |
| `groupDialogOpen` | 「新建 / 改名分组」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `sideWidth` | 分组侧栏宽度（px），`150–300`，写入 `ui` 键记忆 | `190` |
| `resizing` | 是否正在拖拽侧栏宽度（拖拽中给 `.shell` 加 `resizing` 类以禁用文本选中） | `false` |
| `draggingId` | 正在拖拽排序的条目 id（`null` = 没在拖）；驱动 `.item.dragging` 与 `.shell.dragging` | `null` |
| `dropBeforeId` / `dropAfterId` | 拖拽落点提示：插到该行之前（线画该行上边）/ 插到该行之后（线画该行下边）；至多一个非 `null` | `null` |
| `addGroupHint` | 添加弹窗里「将加入分组：「xxx」」的提示文案（`openAdd` 时预计算） | `""` |
| `aiDraft` | AI 添加的描述框草稿（自然语言，`sync:value` 双向绑定） | `""` |
| `aiLoading` | 是否正在请求 AI（按钮文案与禁用态据此变化） | `false` |
| `aiNote` | AI 区进行中 / 成功的提示文案（空串时整行隐藏） | `""` |
| `aiError` | AI 生成失败的红字提示（空串时整行隐藏） | `""` |
| `emptyText` | 空视图提示文案（按 `view` + `groupFilter` 由 `updateEmptyText()` 生成） | 全部视图的提示语 |
| `nowTick` | 倒计时刷新用的当前时间戳；每次 tick 写入以驱动界面重算剩余秒数 | `0` |
| `confirmOpen` | 二次确认对话框 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `confirmTitle` / `confirmText` | 确认框标题与正文 | `""` |
| `purgeTarget` | 待彻底删除的目标：条目 `id` 或 `"ALL"`（清空垃圾桶） | `null` |
| `confirmKind` | 确认框类型：`"purge"`（彻底删除） / `"deleteGroup"`（删除分组） | `"purge"` |
| `confirmGroupId` | 待删除的分组 id（`confirmKind = "deleteGroup"` 时用） | `null` |
| `addOpen` | 「添加任务」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detailOpen` | 「任务详情」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detailId` | 详情弹窗当前展示的任务 id（编辑保存时据此定位条目） | `null` |
| `detailEditing` | 详情弹窗是否处于编辑模式（控制只读区 / 编辑区与两组 `slot="actions"` 按钮的显隐） | `false` |
| `editTitle` / `editDesc` | 编辑模式的草稿（`startEditDetail` 预填，`sync:value` 双向绑定） | `""` |
| `detail` | 详情弹窗的展示对象快照（字段见下），打开时用 `buildDetail(todo)` 算好 | 空对象（各字段为空串 / `false`） |

`detail` 快照字段（**文案全部预计算**，模板只读字段，原因见踩坑 005）：`{ title, desc, hasDesc, groupText, statusText, createdText, statusChangedText, archivedText, deletedText }`（归档时间未归档时为 `—`）。

另有非响应式实例属性 `_tickId`（倒计时轮询的定时器句柄，见「关键流程」）与 `_assistant`（`/mz/ai/main.js` 的 Assistant 实例缓存，首次点「AI 生成」时懒加载，见「关键流程」）。

### 计算属性（proto getter）

| getter | 含义 |
| ------ | ---- |
| `inTrashView` / `inArchiveView` / `inListView` | 当前视图是否为 `trash` / `archived` / `all`；模板用它们切换列表与底部栏（三套 `o-if`） |
| `activeTodos` | `todos` 中 `!deletedAt && !archivedAt` 的（含倒计时中的），统计、分组计数与「全部」视图都基于它 |
| `archivedTodos` | `!deletedAt && !!archivedAt` 的，即已归档条目 |
| `trashTodos` | `todos` 中 `deletedAt` 非空的 |
| `scopedArchivedTodos` / `scopedTrashTodos` | 归档 / 垃圾桶条目按当前选中分组过滤后的结果（`groupFilter = "all"` 时等于 `archivedTodos` / `trashTodos`），两个视图的列表、底栏计数、标签数量都基于它们 |
| `trashBadge` / `archiveBadge` | 垃圾桶 / 已归档标签上的数量后缀（取 `scopedTrashTodos` / `scopedArchivedTodos` 的长度，0 时为空串，因此**跟着分组变**） |
| `archiveGroups` | 「已归档」视图的渲染数据：`all` 模式返回**一组** `{ key:"all", showHead:false, todos: scopedArchivedTodos }`（组头隐藏 → 等价平铺）；`day` / `week` 模式按 `archiveBucket()` 分组、**最新一组在前**，每组 `{ key, label, showHead:true, countText:"N 项", todos }`。两种模式共用同一个 `o-fill`，不必维护两套条目模板 |
| `scopedActiveTodos` | 当前分组范围内的列表条目（`groupFilter = "all"` 时等于 `activeTodos`），列表 / 统计 / **归档已完成**都基于它 |
| `visibleTodos` | 当前视图要渲染的列表：`trash` → `scopedTrashTodos`、`archived` → `scopedArchivedTodos`、其余 → `scopedActiveTodos`（**三个视图统一跟随分组**） |
| `remaining` | `scopedActiveTodos` 中未完成数量 |
| `doneCount` | `scopedActiveTodos` 中已完成数量（同时决定「归档已完成」是否禁用） |
| `draftGroupId` | 新任务将归入的分组：浏览某分组时即该分组，否则默认分组 |
| `allCountText` | 侧栏「全部任务」的计数文案（不含垃圾桶） |
| `groupDialogTitle` | 分组弹窗标题：新建时为「新建分组」，改名时为「改名分组：「xxx」」 |
| `groupSubmitLabel` | 分组弹窗提交按钮文案：「创建」/「保存」（改名时） |
| `isListEmpty` | `visibleTodos.length === 0`，控制 `o-if` 空状态 |
| `aiDisabled` | AI 生成按钮是否禁用：正在请求 或 描述框为空（模板 `attr:disabled="aiDisabled"`） |
| `aiButtonLabel` | AI 生成按钮文案：「AI 生成中…」/「AI 生成」 |

### 组件与页面骨架

- 页面结构自上而下：**两列网格 `.shell`**（左列 = 侧栏 `auto`（宽度由 `sideWidth` 决定）/ 右列 = 任务区 `minmax(0,1fr)`） → 左列 `<aside class="side">`（标题 → 分组列表 `.glist`（「全部任务」+ `o-fill :value="groups"`，每个真实分组行 = `.gname` + `.gcount` + ⋯ 菜单（`st-menu`：trigger `.gmenu` + 两个带 `prefix` 图标的 `st-menu-item`））→ 「＋ 新建分组」按钮 `.add-group-btn`）；右栏 `<div class="main">`（标题栏 `.top`（左侧 h1 + 副标题；右侧 `.top-actions` = 「归档已完成」`st-button` + 「＋ 添加任务」）→ 视图筛选按钮组 → **三套互斥的列表 + 底部栏（`o-if` 按 `inListView` / `inArchiveView` / `inTrashView` 切换）** → 共用的空状态）→ 四个 `st-dialog`（**添加任务**、**新建 / 改名分组**、**任务详情 / 编辑**、**统一二次确认**）。
- **任务详情弹窗内部有两个互斥视图**（由 `detailEditing` 控制）：只读区 `.detail` 与编辑区 `.detail-edit`（`.edit-title` = `st-input`、`.edit-desc` = `st-textarea`，只给 `width` / `min-height`，**不覆盖组件的 `display`**，见踩坑 004）；`slot="actions"` 写两组，各用 `class:hidden` 切换（关闭 / 编辑；取消 / 保存）。headline 用 `{{detailEditing ? '编辑任务' : detail.title}}`——弹窗内**读 data 字段的表达式可用**，不可用的只是 `$host.方法()`（踩坑 005）。
- **添加弹窗内分两段**：上半是任务输入（`st-textarea.dialog-field` + 「将加入分组」提示），下半是虚线分隔的 **AI 区 `.ai-box`**（说明行 `.ai-head`（`n-icon mdi:auto-fix`）→ 描述框 `st-textarea.ai-field` → 右对齐的「AI 生成」`st-button`（`prefix` 槽放 `mdi:creation`）→ `.ai-note` / `.ai-error` 两行提示）。因为弹窗内容处在页面**根级**（不在 `o-fill` / `o-if` 内），绑定一律写裸方法名 / data 字段（`on:click="generateWithAi"`、`attr:disabled="aiDisabled"`），调用的也是 data 字段与 proto getter（踩坑 005 / 006）。AI 提示行与描述框的样式都在 `.ai-*` 类下，`.ai-field` 只给 `width` / `min-height`，**不覆盖 `st-textarea` 的 `display`**（踩坑 004）。
- **侧栏没有常驻输入框**（旧方案的顶部输入框已删）：新建分组走列表下方的「＋ 新建分组」按钮 → 弹窗；改名走**分组行右侧的 ⋯ →「重命名」** → 同一个弹窗（`editingGroupId` 区分模式）。原因：常驻输入框占位、与分组列表混在一起不易理解，用户反馈难用。侧栏 CSS 里 `st-input` 的选择器已改为 `.dialog-input`（弹窗内单行输入框只给 `width`）。
- **分组行的 `on:click` 绑在 `.gname` 与 `.gcount` 上而不是整行 `.gitem` 上**：这样行内的 ⋯ 菜单点下去不会顺带切分组，**不需要依赖 `stopPropagation`**（ofa 事件委托对 stopPropagation 不可靠）。行名区够大（`.gname` 撑满行高、含上下留白）+ 计数也接受点击，已经覆盖了行的整个左半部分；只剩右侧 34px 的 ⋯ 按钮区（它就是按钮本身，本就不该切分组）与「全部任务」行同位置的 `.gmenu-ghost` 占位点不动。后续若还想把点击区域扩到整行，必须处理“点行内按钮又切分组”的副作用，不要直接改回去。
- **行内四列结构**（从「全部任务」行与 `o-fill` 分组行两处对照看）：`.gname`（flex:1、可点）→ `.gcount`（可点）→ **第三列**：真实分组是 `st-menu > st-icon-button.gmenu`（34×34，平时 opacity 0 / 悬停与选中淡入），「全部任务」行是等宽的 `.gmenu-ghost`（34×34、不可点，只为对齐）。**改任一处宽度时两边要一起改**，否则计数会再次错位。
- **行内 ⋯ 的尺寸与显隐**：`st-icon-button` 只给 `font-size: 12px`（em 等比缩到 34px，实测 34.3×34.3），图标用 `n-icon` 且**不给它写 width/height**（见踩坑 009）；显隐靠 `.gitem:hover .gmenu` / `.gitem.active .gmenu` / `.gitem:focus-within .gmenu` 淡入，外加 `@media (hover: none)` 兜底（后台标签页量不到 `:hover`，见踩坑 010）。
- **行内菜单用 `st-menu`**：`<st-menu><st-icon-button slot="trigger" …></st-icon-button><st-menu-item>…</st-menu-item></st-menu>`；`st-menu-item` 在 light DOM，所以 `o-fill` 里的 `$host.方法($data.id)` 绑定正常（实测「重命名」/「删除」都命中正确分组）。`open` 是 ofa data 不是标签属性；面板关闭时菜单项仍在 light DOM（rect 为 0）——自测陷阱见踩坑 010。
- **页面内功能图标已全部走 NoneOS Core 的 `n-icon`**（`<l-m src="/nos/n-icon/n-icon.html"></l-m>`，Iconify 集名语法如 `mdi:pencil`），不用 emoji：颜色自动继承 `currentColor`、可随主题变化。落位：h1 前置 `mdi:check-circle-outline`（`h1 n-icon { font-size: 1em; color: var(--md-sys-color-primary) }`）；「添加任务」「新建分组」用 `st-button` 的 `prefix` 槽放 `mdi:plus`、筛选栏垃圾桶用 `mdi:delete-outline`（统一 `st-button n-icon { font-size: 1.15em }` 与 14px 文字齐高，实测 16.1px）；分组行 ⋯ 菜单的两个 `st-menu-item` 也用 `prefix` 槽放图标（`mdi:pencil` / `mdi:delete-outline`，`st-menu-item n-icon { font-size: 1.15em }`，实测 16.1px、菜单项 106×37）；列表删除按钮的图标名由 `deleteButtonIconName()` 给（`mdi:close` / `mdi:reply`）、垃圾桶「彻底删除」用 `mdi:delete-outline`。仍是 emoji 的只剩**文案**里的装饰（空状态提示 🎉 等），不是功能图标。**放进 `st-icon-button` 时不要给 `n-icon` 写 `width/height/font-size`**——它会吃组件自带的 `::slotted { font-size: 1.571em }`，再叠加就撑出按钮（见踩坑 009）。图标按需从 `api.iconify.design` 取并持久化缓存在 `getStorage("n-icon")`（本环境实测可直连、硬刷新约 100ms 出图）。
- **拖拽排序（引导式，松手才换位）**：`.item` 首位是手柄 `.drag-handle`（`font-size: 20px`、图标 `mdi:drag-vertical`、`touch-action: none` 防触屏拖动变成滚页、`cursor: grab`；`opacity: 0.45` → `.item:hover` 时 1，`@media (hover: none)` 常显 0.8）。手柄 `on:pointerdown="$host.startDrag($event, $data.id)"`（模板里用 `$event` 传事件对象）。**拖动中不改 `todos`**，只写两个 data 字段驱动引导：`dropBeforeId` / `dropAfterId`（对应模板 `class:drop-before` / `class:drop-after`）；被拖行靠 `.item.dragging`（`opacity 0.4` + `inset` 描边，**位置不动**）标识。**换位只在 pointerup 时发生**（`commitDragDrop()` 一次 splice + 落盘）。手柄在 `.body` 之外，所以点 / 拖手柄都不会误开详情弹窗。
- **落点指示线画在行自己的边缘上（不用坐标）**：`.item { position: relative }`，`.item.drop-before::after` / `.item.drop-after::after` 是 `left: 8px; right: 0; height: 2px` 的主题色线（`top: -5px` / `bottom: -5px`，恰好落在 8px 行间距的中间），`:before` 是左端 9px 圆点（`top: -8.5px` / `bottom: -8.5px`）。这样指示线与行**几何上永远对齐**，不存在坐标系错位（曾经的“算 top 再定位浮层”写法因参照物取错而跑偏，见踩坑 016）。
- **拖拽落点判定不能用 `elementFromPoint`，也不能用 `parentElement`**：前者从 `document` 出发只能命中 `<o-page>` 宿主（穿不过页面 shadow）；后者拿到的是 `display: contents` 的 `<o-fill>`（rect 全为 0，详情见踩坑 016）。正确做法是本项目 `dragDropPosition()`：`handleEl.closest('.item').closest('.list')` 拿列表容器，再 `querySelectorAll('.item')` 逐行比 `getBoundingClientRect()`，看指针 `clientY` 落在哪行的上半 / 下半区——**上半区 → 插到该行前、下半区 → 插到下一行前**（最后一行下半区则追加到列表末尾）。行上的待办 id 从 `attr:data-id="$data.id"` 读。
- **换位索引换算**：`commitDragDrop(id, beforeId, afterId)` 先把被拖条目从 `todos` `splice` 出来，再用 `remap(origIdx) = origIdx > from ? origIdx - 1 : origIdx` 把**原数组下标换算到“抽掉自己之后”的下标**（`beforeId` 直接用它，`afterId` 再 +1）；`insertAt === from` 说明落点就是原位，直接返回不写盘。这样拖拽不会“自己把自己插到错位”。
- **侧栏放页面内而非弹窗里**：侧栏需要 `o-fill` 循环分组并在行内传 `$data.id` 调方法，而弹窗内 `$host` / `$data` 的行为不可靠（踩坑 005）。
- **绑定写法要区分层级（踩坑 006）**：页面**根级**元素用裸方法名 / data 字段（`class:active="isGroupActive('all')"`、`on:click="setGroup('all')"`）；**`o-fill` / `o-if` 内部**用 `$host.方法($data.id)`。根级写 `$host.xxx()` 会报 `Error evaluating element expression` 且绑定静默失效。
- 媒体查询只有两条：`@media (max-width: 620px)`（`.shell` 变单列、`.side` 不再 sticky 也不限高而是通栏（`width: auto !important` 压过行内宽度）、`.glist` 改横向 wrap、`.resizer` 隐藏）与 `@media (hover: none)`（触屏上行内 ⋯ 菜单常驻可见）。**已不存在 ≤1100px 那条**（两列布局没有右侧留白列可去）。
- **宽度与空间利用**：`.shell` 只设 `width: 100%`（**不设 `max-width` / `margin: 0 auto`**，否则超宽屏上侧栏会被居中容器一起推到屏幕中间）；布局用两列 grid（左栏 `auto` + 右列 `minmax(0,1fr)`），`.side` 写行内 `width: sideWidth`、`.main` 写 `width: 100%` ——**任务区把剩余宽度吃满，侧栏拖多宽都不会在右侧浪费空间**；行宽上限（`max-width: 1200px` + `margin: 0 auto`）只加在 `.main` 上。上面提到的 `.spacer` 留白列已删除（曾为“任务区居中”而存在，会浪费空间）。
- **可拖拽的侧栏宽度**：`.side` 写 `:style.width = sideWidth + 'px'`；手柄 `.resizer` 是**绝对定位在侧栏右边缘间隙中间**的独立元素（`left = sideWidth + 10 + 'px'`，`transform: translateX(-50%)`），不参与网格排版，所以不会被侧栏的 `overflow` 裁剪；`pointerdown` 起手后监听挂在 `window`（`startResize`），拖动结束才落盘。改宽度时**只改 `data.sideWidth` 一处**，侧栏与手柄都会跟随（任务区是 `1fr`，自动吃满剩余宽度）。
- `st-dialog` 用法统一为：`sync:open="xxxOpen"` + `auto-close`，`slot="headline"` 放标题、`slot="actions"` 放按钮；`st-dialog` 内直接 `querySelectorAll('st-button')` 能拿到两个操作按钮（`slot="actions"` 里的 div 不影响）。
- `.dialog-field { width: 100%; }`：弹窗内输入框只改宽度，**不覆盖 `st-input` 的 `display`**（原因见踩坑 004）。
- **右上操作区 `.top-actions`**：`display: flex; align-items: center; gap: 8px; flex: none`，内容依次是「归档已完成」（`variant="text"`，与主按钮「添加任务」区分主次）与「添加任务」。实测任务区右边缘贴齐视口（归档按钮 x=898 / 添加按钮 x=1042、右边缘 1164 = 视口 1180 - 16 padding）。窄屏（≤620px）在媒体查询里给 `.top` 加 `flex-wrap: wrap`，放不下时按钮组整块换行，不把标题挤扁。
- **行尾操作区 `.item-actions`**：`flex: none; display: flex; gap: 2px`，里面并排「编辑」`st-icon-button.edit-btn`（常态 `opacity: 0.7`，`hover` / `focus-within` 变 `opacity: 1` + 主题色）与「删除」`st-icon-button`。**两个按钮统一 34px**（给 `st-icon-button` 设 `font-size: 12px`，em 等比缩放，图标 18.9px；不要给 `n-icon` 写尺寸，见踩坑 009）——曾经是默认 40px、两个并排占 92px，显得笨重（用户反馈“太丑”），现为 70.6px。倒计时（`.item.pending`，错误容器底色）下两个按钮的**宿主** color 换成 `on-error-container`（实测 255,180,171），编辑按钮也取消降透明度。注意必须直接命中 `st-icon-button` 宿主：它自带 `color: on-surface-variant`，父容器上写 `color` 会被组件自声明盖掉。
- **「已归档」视图内是两层容器 + 嵌套 `o-fill`**：说明行 → 子标签 `st-button-group.archive-tabs`（`全部归档 / 按日期 / 按周`）→ `.agroups` → `o-fill :value="archiveGroups" fill-key="key"`（每组一个 `.agroup`，组内是 `.agroup-head`（`label` + `countText`）+ `.list` → 内层 `o-fill :value="$data.todos" fill-key="id"` 渲染条目）。**嵌套 `o-fill` 里的 `$data` 分别指向两层数据**（外层是组、内层是任务），内层条目上的回调仍旧用 `$host.xxx($data.id)`；`fill-key` 两层都要给（外层 `key`、内层 `id`）。
- **「全部归档」不用单独一套模板**：`archiveGroups` 在 `all` 模式下返回「一组 + `showHead:false`」，组头用 `class:hidden="!$data.showHead"` 隐藏，条目模板与分组模式完全共用（少维护一套一模一样的行结构）。
- **三个视图的模板结构**：`全部`（`.item`：拖拽手柄 `.drag-handle` + `st-checkbox` + `.body` + `.item-actions`（编辑 / 删除））、`已归档`（`.item.archived`：用 `.arch` 包一个 `n-icon icon="mdi:archive-arrow-down"` 占住勾选框位置（行高与其它视图一致）+ `.body` + 「取消归档」`st-button` + `.item-actions`）、`垃圾桶`（`.item.trash`：`.body` + 「还原」+ 彻底删除）。**三套列表各自一个 `o-fill`**，且**都绑过滤后的 getter**：列表视图 `visibleTodos`、归档视图 `archiveGroups`（内部用 `scopedArchivedTodos`）、垃圾桶视图 `scopedTrashTodos`。改数据范围时要三处一起看——本项目就漏过垃圾桶那一处（底栏计数已过滤、列表还是全量，见踩坑 022）。共用 `.list` / `.item` 基础样式；空状态 `isListEmpty` 与 `{{emptyText}}` 在三套之外只写一次（数组成空就显一个，不会重叠）。

### 时间显示（proto 方法）

| 方法 | 作用 |
| ---- | ---- |
| `formatTime(ts)` | 时间戳 → `MM-DD HH:mm`；跨年补为 `YYYY-MM-DD HH:mm`；非 number / 非法值返回「未知」 |
| `timeMeta(todo)` | 列表项副标题，按优先级：倒计时中 → `N 秒后移入垃圾桶（点撤销按钮可撤销）`；已在垃圾桶 → `删除于 … · 创建于 …`；**已归档 → `归档于 … · 创建于 …`**；其余 → `创建于 …`（+ 有 `statusChangedAt` 时追加 ` · 完成于 …` / ` · 恢复于 …`） |
| `isPending(todo)` / `pendingSeconds(todo)` | 是否处于倒计时 / 剩余秒数（用 `nowTick` 与 `TRASH_DELAY_MS` 算，向上取整）；列表与归档视图都用它 |
| `deleteButtonIconName(todo)` / `deleteButtonTitle(todo)` | 同一个按钮的状态化外观：倒计时中图标名为 `mdi:reply` +「撤销删除」，否则为 `mdi:close` +「删除（5 秒后移入垃圾桶）」 |
| `startDrag(ev, id)` | 拖拽手柄 `pointerdown` 入口（写 `$host.startDrag($event, $data.id)`）：置 `draggingId`，把 `pointermove` / `pointerup` / `pointercancel` 挂到 `window`；移动时只更新 `dropLineTop` / `dropHoverId` 与闭包里的落点（`beforeId` / `afterId`），**不动 `todos`**；松手时清视觉态，**真移动过才调 `commitDragDrop()`** |
| `dragDropPosition(clientY, handleEl)` | 由手柄 `closest('.item')` → `closest('.list')`（**不能 `parentElement`，见踩坑 016**）拿到列表容器，逐行比 `getBoundingClientRect()`，返回 `{ beforeId, afterId }`——**不产生任何坐标**：指针在某行上半区 → 插到该行前；下半区 → 插到下一行前；末行下半区 / 列表下方 → 追加末尾 |
| `commitDragDrop(id, beforeId, afterId)` | 松手提交：splice 出被拖条目 → 用 `remap()` 把原下标换算成“抽掉自己之后”的下标（`beforeId` 直接用，`afterId` 则 +1）→ 插回、`persistTodos()`；落点即原位时不动数据、不写盘 |
| `isDragging(id)` / `isDropBefore(id)` / `isDropAfter(id)` / `dragHandleTitle(todo)` | 该行是否被拖（`.item.dragging`） / 落点线画在该行上边 / 下边 / 手柄 `title` 文案 |
| `openAdd()` / `closeAdd()` | 打开 / 关闭添加弹窗（两者都会重置 `draft` 为空，并清空 AI 区的 `aiDraft` / `aiNote` / `aiError`；`openAdd` 不给残留草稿） |
| `submitAdd()` | 弹窗内提交入口：调 `addTodo()`，**成功才关弹窗**（多行输入回车 = 换行，所以只有按钮会调它） |
| `parseDraft(raw)` | 多行文本 → `{ title, desc }`：第一个非空行作标题，其后全部行（含内部换行）作描述；无任何非空行返回 `null` |
| `getAssistant()` | 懒加载 `/mz/ai/main.js` 并缓存 `getAssistant()` 实例到 `this._assistant`（模块顶层不能 import，必须用工厂注入的 `load`） |
| `parseAiReply(content)` | 模型回复 → `{ title, desc }`：先剥掉可能的 ```json 围栏、取首个 `{` 到末个 `}` 做 `JSON.parse`（兼容 `name` / `description` 字段名），失败则把整段回复交给 `parseDraft` 兜底 |
| `generateWithAi()` | 「AI 生成」入口：置 loading、按 `AI_SYSTEM_PROMPT` 请模型整理成 JSON，成功后把 `title + "\n" + desc` 回填 `draft`（保持“首行标题”的既有格式）；失败写入 `aiError`，`finally` 复位 loading |
| `buildDetail(todo)` | 生成详情弹窗的展示对象（标题 / 描述 / 状态文案 / **四个**时间文案均在此算好；状态优先级：倒计时中 → 已在垃圾桶 → 已归档 → 已完成 → 未完成） |
| `openDetail(id)` / `closeDetail()` | 打开详情（生成快照 + 记 `detailId`、复位编辑态） / 关闭详情（同时清编辑态与草稿） |
| `openEditDetail(id)` | 列表 / 归档行铅笔按钮入口：`openDetail(id)` 后直接 `startEditDetail()` |
| `editButtonTitle(todo)` | 铅笔图标按钮的 `title` 文案（「编辑：xxx」，图标按钮必须给无障碍名称） |
| `startEditDetail()` | 进入编辑：**从 `todos` 取原始 `text` / `desc` 预填**（不读 `detail` 快照——它把空标题换成了「（无标题）」），置 `detailEditing = true` |
| `cancelEditDetail()` | 取消编辑：清草稿、回只读视图并从 `todos` 重算快照 |
| `submitEditDetail()` | 保存编辑：标题 `trim()` 后非空才生效，只改 `text` / `desc`（不动分组、`done` 与各时间戳），刷新快照、退出编辑态、`persistTodos()` |
| `groupName(id)` / `groupCountText(id)` / `isGroupActive(id)` | 分组名（找不到回「默认」） / 分组内任务数（**归档与垃圾桶都不计**，与统计口径一致） / 是否为当前选中分组（供侧栏高亮） |
| `setGroup(id)` | 切换选中分组（重算空状态文案 + 保存会话状态） |
| `openAddGroup()` / `openRenameGroup(id)` / `closeGroupDialog()` | 打开「新建分组」弹窗（清空草稿） / 打开「改名」弹窗（预填原名） / 取消关闭（清空草稿与编辑态） |
| `groupMenuTitle(name)` | 分组行 ⋯ 按钮的 `title` 文案（图标按钮无文字，必须给无障碍名称） |
| `isDefaultGroup(id)` | 是否为默认分组（行内菜单的「删除」据此置灰，`requestDeleteGroup` 内部也会再拦一道） |
| `submitGroup()` | 分组弹窗提交入口（回车与按钮都走它）：按 `editingGroupId` 分支新建或保存改名，**成功才关弹窗**并落盘 |
| `archiveDone()` | 「归档已完成」入口：把当前分组范围内**未归档、未删、未在倒计时**的已完成项打上 `archivedAt = now`（一条条改字段，不删数据）；无变化时不写盘 |
| `unarchiveTodo(id)` | 取消归档（`archivedAt = null`），条目回列表与原分组，`done` 与各时间戳保留 |
| `setArchiveGroupMode(mode)` | 切换归档查看方式（只接受 `all` / `day` / `week`，非法值忽略），写会话状态 |
| `dateKey(ts)` / `monthDayText(d)` | 本地日期 key（`YYYY-MM-DD`）/ `MM-DD` 文案；分组 key 一律用它们拼（key 前缀 `d` / `w` 后跟 `YYYY-MM-DD`，**字典序即时间序**，倒序排序即最新在前） |
| `archiveBucket(ts)` | 一个归档时刻归到哪个分组 → `{ key, label }`：`day` 模式 `key="dYYYY-MM-DD"`、label「10-10 周六」；`week` 模式 `key="wYYYY-MM-DD"`（该周周一）、label「2026 年第 41 周 · 10-05 ~ 10-11」；`archivedAt` 非数字时返回 `{ key:"0-unknown", label:"归档时间未知" }`（排在最后） |
| `isoWeek(ts)` | ISO 周序号：取该周**周四**所在的年份 + `Math.ceil` 出的周数（跨年周不至于算错） |
| `requestDeleteGroup(id)` / `deleteGroup(id)` | 删除分组：前者弹二次确认，后者真正执行（任务移入默认分组并落盘） |
| `updateEmptyText()` | 按当前 `view` + `groupFilter` 生成空状态文案 |
| `scopeByGroup(list)` | 按当前选中分组过滤一个条目数组（`groupFilter = "all"` 时原样返回）；`scopedActiveTodos` / `scopedArchivedTodos` / `scopedTrashTodos` 三个 getter 都走它，保证三个视图口径一致 |
| `confirmAction()` | 确认弹窗统一入口：按 `confirmKind` 分发「彻底删除」与「删除分组」；`target === "ALL"`（清空垃圾桶）时按 `emptyTrash()` 当时记下的 `_purgeScope` 只清该分组范围 |
| `restoreTodo(id)` | 从垃圾桶还原：清 `deletedAt` / `pendingDeleteAt`，**并清 `archivedAt`**（归档项被删后又还原，应回列表而非回归档箱） |
| `emptyTrash()` | 请求清空垃圾桶：**只针对当前分组范围**（条数取 `scopedTrashTodos.length`，范围记在 `_purgeScope` 里）；选「全部任务」时才是清空全部。选中分组时确认框标题 / 文案都带分组名 |
| `clampSideWidth(v)` / `loadUi()` / `saveUi()` | 侧栏宽度边界收敛（150–300，非法值回默认）/ 启动读取 / 拖动结束保存 `ui` 键 |
| `sessionSnapshot()` / `saveSessionState()` | 当前会话状态快照 `{ view, groupFilter, archiveGroup }` / 写入 `sessionStorage`（切分组、切筛选、切归档查看方式、删除分组后调） |
| `restoreSessionState()` | 启动时恢复会话状态：校验 `view` 属于 `all` / `archived` / `trash` 三个合法值、`groupFilter` 为 `"all"` 或仍存在的分组、`archiveGroup` 属于 `all` / `day` / `week`（均非法则回落），完成后 `updateEmptyText()` |
| `startResize(ev)` | 拖拽手柄 `pointerdown` 入口：记下起点与起始宽度后，把 `pointermove` / `pointerup` / `pointercancel` 监听到 `window` 上（指针移出手柄甚至移出窗口也能继续跟随），结束时移除监听并 `saveUi()` |

模板在 `o-fill` 项内以 `{{$host.timeMeta($data)}}` / `attr:title="$host.deleteButtonTitle($data)"` 调用；`timeMeta` 读了 `this.nowTick`，因此倒计时数字能随 tick 重渲染（实测 5→1 秒逐秒更新）。

## 关键流程

- **AI 添加**：弹窗内输入 `aiDraft` → `generateWithAi()`（置 `aiLoading`、清 `aiError`）→ `getAssistant()` 懒加载 `/mz/ai/main.js` 并 `getAssistant()` → `assistant.chat({ messages: [系统提示 AI_SYSTEM_PROMPT, 用户描述] })` → `parseAiReply()` 解出 `{ title, desc }`（JSON 优先，失败回退多行文本）→ 回填 `draft` 并提示成功；任何异常（无可用 key、模型报错、解析失败）写进 `aiError` 红字提示，`finally` 复位 `aiLoading`。**AI 只负责生成内容，落盘始终由用户点「添加」走 `submitAdd()`**——保持单一写入路径。模型名 / 推理档位不由应用指定（用宿主当前配置），因此 `chat()` 不传 `model` / `thinking`（`kimi-k3` 传 `thinking` 会报错）。
- **添加**：页面上的「＋ 添加任务」→ `openAdd()`（清空 `draft` 与 AI 区、`addOpen = true`）→ 弹窗内 `st-textarea` 输入 → 「添加」按钮调 `submitAdd()` → `parseDraft()` 把多行文本拆成标题 / 描述 → `addTodo()` 返回布尔，**只在成功时**由 `submitAdd()` 关闭弹窗；`addTodo()` 往 `todos` 头部插入带 `createdAt` 的新条目并 `persistTodos()`。
- **查看详情 / 编辑任务**：点任务 `.body` → `openDetail(id)` 用 `buildDetail(todo)` 生成展示快照并打开弹窗（弹窗内展示文案均预计算，见踩坑 005）；点「编辑」（或行内铅笔按钮走 `openEditDetail(id)`）→ `startEditDetail()` 用原始 `text` / `desc` 预填编辑框 → 「保存」走 `submitEditDetail()` 写回并落盘、回只读；「取消」走 `cancelEditDetail()`；关闭走 `closeDetail()`。
- **启动**：`index.html` 加载 ofa.js / router / st-boot → `o-app` 按 `app-config.js` 载入 `pages/home.html` → 页面工厂里 `load("/nos/storage/main.js")`、`getStorage("conjure-todo-app")` → **`ready()` 是 async，依次 `await loadUi()` / `await loadGroups()` / `await loadTodos()`**（界面偏好与分组都要先就位，列表渲染时才能按宽度排版、显示分组名），最后 `restoreSessionState()` 恢复上次的筛选与分组（它要校验分组是否存在，所以必须排在 `loadGroups()` 之后）→ 渲染 `o-fill`。
- **会话状态**：`setGroup()` / `setView()` / `deleteGroup()` 末尾调 `saveSessionState()` 写 `sessionStorage`；启动时 `restoreSessionState()` 读回并校验（`view` 只接受 `"all"` / `"archived"` / `"trash"`——**旧会话里存的 `active` / `done` 会被忽略并回落到「全部」**；已不存在的分组回落为 `"all"`；`archiveGroup` 只接受 `"all"` / `"day"` / `"week"`，非法 / 缺失均为「全部归档」）。
- **归档**：`archiveDone()`（右上「归档已完成」按钮）只把**当前分组范围**内已完成的条目打上 `archivedAt`（一条条改字段、不删数据），于是它们同时从 `activeTodos` / 分组计数 / 统计里消失，只出现在「已归档」视图（`archivedTodos`）；`unarchiveTodo(id)` 清 `archivedAt` 让条目回列表（`done` 与各时间戳不变）；从垃圾桶还原时 `restoreTodo()` 一并清 `archivedAt`。
- **归档查看方式**：子标签 `on:click="setArchiveGroupMode('day')"` → 只改 `archiveGroupMode`（`archiveGroups` 随之重算、写会话状态），不动任何数据；`archiveBucket()` 只读 `archivedAt`，所以取消归档 / 删除归档项后组内条数即时重算。
- **侧栏宽度**：`startResize(ev)` 记下起始 `sideWidth`，`pointermove` 时写 `sideWidth = clampSideWidth(...)`（驱动侧栏宽度与手柄位置，任务区按 `1fr` 自动变宽 / 变窄），`pointerup` / `pointercancel` 移除监听、置 `resizing = false` 并 `saveUi()` 落盘。
- **分组**：`loadGroups()` / `persistGroups()` 读写 `groups` 键；`setGroup(id)` 切侧栏选中项并重算空状态；新建走 `openAddGroup()` → 弹窗输入 → `submitGroup()`，改名走行内菜单「重命名」→ `openRenameGroup(id)` → 同一个 `submitGroup()`（看 `editingGroupId` 分支），两者成功后都关弹窗并 `persistGroups()`；删除走行内菜单「删除」→ `requestDeleteGroup(id)` → `confirmAction()` → `deleteGroup()`（任务 `groupId` 改回 `default`、若正在浏览该分组则回到 `all`）。
- **改动数据**：`addTodo` / `toggleTodo` / `archiveDone` / `unarchiveTodo` / `restoreTodo` / `confirmAction` / `deleteGroup` 都会重建 `this.todos` 后调 `persistTodos()` 写回存储；模板由 ofa 响应式更新。`startPendingDelete` / `cancelPendingDelete` / 倒计时到点也会落盘（`pendingDeleteAt` 不跨刷新恢复，但 `deletedAt` 会）。
- **拖拽排序**：按住某行手柄 `pointerdown` → `startDrag(ev, id)` 置 `draggingId` 并把 `pointermove` / `pointerup` / `pointercancel` 挂到 `window`；每次 `pointermove` 调 `dragDropPosition(clientY, 手柄元素)` 算出落点，**只更新 `dropBeforeId` / `dropAfterId`（行边缘的指示线）并把落点存进闭包**——`todos` 在整个拖动过程中不变；`pointerup` / `pointercancel` 时移除监听、清掉落点提示，**真的移动过才** 调 `commitDragDrop(id, beforeId, afterId)`（splice 提出来、按下标映射插回去、`persistTodos()`）；落点即原位则只打日志、不动数据。
- **筛选**：`setView(value)` 只改 `view` 与 `emptyText`，`visibleTodos` 随之重算，不动数据，并把会话状态写入 `sessionStorage`。三个视图的数据源都过 `scopeByGroup()`，所以**切换分组会同时改变三个视图的内容**（列表、归档、垃圾桶的计数 / 徒标 / 底栏 / 空状态都跟着变）。
- **删除倒计时（核心机制）**：`handleDeleteClick(id)` 判分支——无 `pendingDeleteAt` 则 `startPendingDelete`（写入 `pendingDeleteAt`、写一次 `nowTick`、`startTicker()`），已有则 `cancelPendingDelete`（置 `null`）。`startTicker()` 用自终止的 `setTimeout` 链（`_tickId`，步长 `TICK_MS`）：每步写 `nowTick` 驱动界面刷新剩余秒数，把 `now - pendingDeleteAt >= TRASH_DELAY_MS` 的条目改为 `deletedAt = Date.now()` 并落盘；**没有倒计时条目时不再调度下一步**，不会留下常驻定时器。
- **彻底删除 / 删除分组**：`purgeTodo(id)` / `emptyTrash()` / `requestDeleteGroup(id)` 都只设置 `confirmKind` + 目标（`purgeTarget` 或 `confirmGroupId`）与确认文案、打开 `st-dialog`（此阶段不删任何东西）；只有 `confirmAction()` 才真正执行并落盘，`closeConfirm()` 则取消。
- **时间记录**：`addTodo` 写入 `createdAt`；`toggleTodo` 每次切换写入 `statusChangedAt`；两者都随 `persistTodos()` 落盘。

**核心链路（实测清单，功能演进时同步扩充）**（①–㉑ 为主线流程；【编辑任务】【行尾操作区尺寸与观感】【归档链路】【拖拽排序】是后加功能的专题链路，未重排编号）：① 打开应用渲染列表与计数；② 点「添加任务」按钮弹窗（空输入时「添加」禁用）→ 多行输入提交后标题 / 描述分别正确、弹窗关闭、草稿清空；点「取消」关掉不新增，重开弹窗草稿为空；③ 勾选/取消勾选（删除线 + 计数变化 + 副标题出现「完成于/恢复于 …」）；④ 三个视图（全部 / 已归档 / 垃圾桶）切换与空状态文案；⑤ 点删除按钮（关闭图标）后 5 秒倒计时（逐秒递减、pending 样式、图标变 `mdi:reply`）→ 自动进垃圾桶；⑥ 倒计时中点同一按钮（撤销图标）撤销（条目保留、不再倒计时）；⑦ 垃圾桶视图还原（回列表且不影响计数，如果它之前被归档过也会正确回到列表）；⑧ 彻底删除单条（弹框 → 取消不删 → 确认才删）；⑨ 清空垃圾桶（空时按钮禁用，弹框带条数，取消/确认均正确）；⑩ 进垃圾桶后硬刷新仍在（`deletedAt` 持久化）；⑪ （旧功能「清除已完成」已改为「归档已完成」，见后面的【归档链路】）；⑫ 重开后数据仍在；⑬ 长列表（含多行描述）可滚到底；⑭ 每条任务显示创建时间，状态变更后时间实时更新，旧数据显示「创建时间未知」；⑮ 点任务正文区弹详情（标题 / 描述全文 / 状态 / 四个时间正确），点勾选框不会误开详情；⑯ 详情弹窗底部只有「关闭」，点它关闭弹窗（列表内与垃圾桶内的条目都一样）；【编辑任务】列表行铅笔（`title`「编辑：xxx」）→ 详情弹窗以「编辑任务」为标题打开且标题 / 描述已预填 → 改标题与描述（含多行）→「保存」→ 列表项标题 / 描述即时更新、弹窗回到只读（headline 变新标题）；硬刷新后修改仍在（已落盘）；再次进入编辑后点「取消」→ 列表值不变（预填仍为当前值）；标题改成全空白 → 「保存」置灰；归档视图里的条目也能用同样的方式编辑（同理可删）；编辑不改分组、勾选状态与时间戳；【行尾操作区尺寸与观感】`.item-actions` 内两个按钮实测 34.3×34.3（图标 18.9×18.9），操作区总宽 70.6（原 92），与 `.body` 垂直居中对齐（无描述行 30/30、有描述行 40/40）；编辑按钮常态 `opacity 0.7`、删除按钮 1；倒计时行的两个按钮图标颜色变 `rgb(255,180,171)`（on-error-container）且编辑按钮恢复不透明；点铅笔仍能正常进入「编辑任务」弹窗（回归通过）。【归档链路】点**右上**的「归档已完成」（无已完成项时置灰；三个视图下均可见）→ 已完成条目从列表消失、`已归档 N` 徒标出现、统计与侧栏分组计数同步减少、「归档已完成」马上变禁用态；切到「已归档」→ 顶部有说明行、条目带归档图标与「归档于 … · 创建于 …」副标题、底部显示「已归档 N 项」；点正文开详情 → 状态「已归档（已完成）」且「归档时间」有值（未归档条目为 `—`）；点「取消归档」→ 回到列表与原分组（勾选状态保留）、徒标个数回落；在归档视图点删除 → 5 秒倒计时 → 进垃圾桶 → 在垃圾桶点「还原」→ 回到**列表**（而不是回归档箱，`archivedAt` 已清）；在某个分组下点「归档已完成」只归档该分组的已完成项，其它分组不受影响；硬刷新后归档状态与视图仍保持；【归档分组】归档视图内的子标签默认「全部归档」（选中态 `variant=filled`）且**无日期组头**（`.agroup-head` 计算值为 `display:none`）、条目平铺；点「按日期」→ 同一天的归档合成一组、组头「10-10 周六」+「2 项」（跨两天的数据成 3 组、最新的排最前、组内顺序不变）；点「按周」→ 组头「2026 年第 41 周 · 10-05 ~ 10-11」+「N 项」，同周的两条合成一组；切换后 `sessionStorage` 写入 `archiveGroup`，**硬刷新后仍停在「按周」且周分组照旧**。⑰ 分组（左栏）：点「新建分组」按钮 → 弹窗（空时「创建」禁用、输入后启用）→ 提交后侧栏出现新项并关弹窗（重名自动加序号）；点分组行右侧 ⋯ → 菜单弹出「重命名 / 删除」（默认分组的「删除」置灰）→「重命名」打开弹窗（标题「改名分组：「xxx」」、预填原名、按钮为「保存」），**且当前选中的分组不变（不因点行内按钮而切分组）**，「取消」不改名、提交后侧栏同步新名；「删除」→ 二次确认（标题 / 文案 / 条数正确）→ 确认后分组消失、列表回到「全部任务」；点分组名即选中高亮且只看该分组；在分组下添加的任务归入该分组（元信息与弹窗提示均正确），“全部任务”下添加则归默认；改名同步到侧栏与列表元信息；删除需二次确认（取消不删；确认后组内任务移入默认并落盘）；「默认」的「删除」置灰（点了无反应）、「全部任务」行没有行内菜单；底部统计随分组变化；「归档已完成」只归档当前分组范围；刷新后分组与归属仍正确；⑱ 侧栏宽度：在侧栏右边缘拖拽手柄（拖动 300→220px），松手后侧栏变窄、**任务区同步变宽（828→908px，吃满剩余宽度、右侧无多余空白）**、存储 `ui.sideWidth` 写入 220，硬刷新后宽度保持；⑲ AI 添加：打开添加弹窗 → 描述框为空时「AI 生成」禁用 → 输入一句话后点「AI 生成」（按钮变「AI 生成中…」并禁用）→ 成功后标题 / 描述回填到上方输入框且提示「AI 已生成…」→ 点「添加」后列表里的标题与描述分别是模型给的 title / desc（描述多行正确保留）→ 关弹窗重开，AI 区字段全部清空；AI 失败时弹窗内红字提示且不丢用户输入；⑳ 会话状态：在非默认分组（如「个人」）下刷新 → 仍是该分组；再切「已完成」刷新 → 分组与视图都保留、空状态文案正确；把 `sessionStorage` 里的 `groupFilter` 改成不存在的 id、`view` 改成 `trash` → 刷新后分组回落「全部任务」、视图仍为垃圾桶；清掉 `sessionStorage` 刷新 → 回到「全部任务」+「全部」；刷新过程无应用报错（装了 `error` / `unhandledrejection` 记录器验证）；㉑ 分组行点击区与对齐：四行（全部任务 / 默认 / 个人 / LINLEE）**行高均为 42px**、`.gname` 高 42px（与行等高等宽，即整行左半都是点击区），四处 `.gcount` 的 `right` **都在 269**（计数右边缘对齐，「全部任务」不再向右突出）；点行名切分组、点计数也切分组、点 ⋯ 按钮**不切分组**且菜单正常弹出 / 收起（关闭后菜单项宽回 0、无弹窗残留）；刷新后用户原有数据与侧栏宽度偏好不变（实测后将 `sessionStorage` 会话状态清空）。【拖拽排序】列表每行首位有 `mdi:drag-vertical` 手柄（实测 24×28、图标 20px、`opacity 0.45`、`touch-action: none`、`title`「按住拖动调整顺序：xxx」）；向手柄派发 `pointerdown` → 行变 `.item.dragging`（位置不动）/ `.shell` 变 `shell dragging`，此时**顺序未变、无落点提示**；向 `window` 派发 `pointermove` 到目标行 → **落点提示是目标行的边缘线**（实测：指针在第 2 行上半 → `class` 为 `item drop-before`，`::after` 计算值 `top -5px` / `height 2px` / 颜色主题色 `rgb(159,202,255)`、`::before` 9×9 圆点；指针在末行下半 → `drop-after`，线贴在该行下边缘），两行之间 8px 缝隙中线正落在行间距中点（行底 219 / 行顶 227，线在 222~224），而**拖动过程中列表顺序完全不变**；`pointerup` 后提示类全部消失、日志 `[drag] 已放下，xxx 移到第 N 位` + `[storage] 已保存待办`、顺序才互换；**硬刷新后新顺序仍在**；把被拖行拖回原位 → `[drag] 落点仍是原位，顺序不变`、不写盘；点手柄 / 拖手柄都**不会**误开详情弹窗；控制台无应用报错。【归档桶跟随分组】左栏选中某分组后：「已归档」「垃圾桶」两个视图只列该分组的条目（实测选「个人」时分组的垃圾项目在筛选内外都不出现，切换回「全部任务」才看到），切分组时视图标签数量 / 底栏计数 / 空状态文案同步变化（实测「工作」下垃圾桶 0 项、置灰「清空垃圾桶」且空状态为「「工作」的垃圾桶是空的」；「默认」下垃圾桶 1 项、按钮可用；「全部任务」下为全量 1 项）；「清空垃圾桶」在选中分组时只清该分组范围，确认框标题为「清空「默认」的垃圾桶？」、文案说明范围与条数，确认后其它分组的垃圾桶条目不受影响。

## 场景测试（`client/test/*.test.json`）

用宿主 preview 工具的 `action=run-tests` 跑（**新增 / 修改重要功能后必须跑到全绿**）；用例本身随功能一起维护。10 个用例一文件一主流程，文件名即功能名：

| 文件 | name | 覆盖内容 |
| ---- | ---- | -------- |
| `add-task.test.json` | 添加任务 | 多行输入解析标题/描述、空输入与 AI 描述为空时禁用、取消不新增且重开草稿为空、统计与侧栏计数、刷新持久化 |
| `delete-trash.test.json` | 删除倒计时 | pending 样式 / 逐秒文案 / 图标 `mdi:reply` / 仍计入统计、再点撤销、到点进垃圾桶、垃圾桶还原回列表、刷新落盘 |
| `drag-order.test.json` | 拖拽排序 | 落点语义（某行上半区插到该行之前、末行下半区追加末尾）、拖动中只给提示且顺序不变、松手才换位、原位不写盘、刷新保持 |
| `edit-task.test.json` | 编辑任务 | 铅笔进编辑、预填当前值、空白标题禁用保存、保存同步列表与详情、取消丢弃、不改完成状态与时间戳、刷新落盘 |
| `group-crud.test.json` | 分组管理 | 新建（空输入禁用、计数）、切换与任务归属、改名（预填原名、同步元信息）、删除二次确认且任务移入默认、默认分组删除置灰、刷新持久化 |
| `session-state.test.json` | 会话状态 | 切分组 / 切视图写入 `sessionStorage` 且刷新保留、非法分组回落「全部任务」、非法视图回落、清空后回默认 |
| `toggle-archive.test.json` | 归档链路 | 勾选完成/恢复、归档已完成只收当前分组范围、已归档视图与详情状态、取消归档回列表、归档项删除后从垃圾桶还原回列表、刷新持久化 |
| `trash-purge.test.json` | 垃圾桶清理 | 彻底删除二次确认（取消不删 / 确认才删）、清空垃圾桶（条数提示 / 取消 / 确认 / 空时禁用）、刷新落盘 |
| `archive-group.test.json` | 归档分组 | 默认「全部归档」无组头、按日期分组（同日一组 / 最新在前 / 组头带日期星期与条数 / 组内顺序不变）、按周分组（组头含年·周·起止 / 总条数不变）、查看方式写 `sessionStorage` 并刷新保持 |
| `group-scope-views.test.json` | 归档桶跟随分组 | 左栏选中分组后「已归档」「垃圾桶」只显示该分组条目（选「全部任务」才是全部）、视图标签数量 / 底栏计数 / 空状态文案同步跟随；「清空垃圾桶」只清当前分组范围（确认框标题带分组名），不动其它分组 |

### 用例写法约定（本项目）

- **`name` 用 ≤12 字的短功能名**，细节写进 `desc`；一文件一主流程。
- **第一步 wipe、最后一步 restore**：第一条 eval 定义 `T.wipe()`（先把 `todos` / `groups` / `ui` 备份到 `localStorage.__todo_test_backup_v1` 并置 `__todo_test_dirty = "1"`，再清空存储与 `sessionStorage` 的会话状态）后调用，接着 `reload`；收尾的 eval 从备份还原用户数据并清 dirty 标记。**wipe 开头会自愈上一次中断遗留的脏数据**（跑失败时 restore 不会执行，用户数据会短暂为空）。
- **辅助函数只定义一次、挂在共享上下文 `T` 上**（`T.q` / `T.tx` / `T.click` / `T.byText` / `T.btn` / `T.dlg` / `T.dlgBtn` / `T.items` / `T.need` / `T.setVal` / `T.addTask` / `T.toggle` / `T.del` / `T.view` / `T.pickGroup` / `T.groupAction` / `T.drag` …，`T.NL = String.fromCharCode(10)`）。**后续步骤不要重复定义**，直接用 `T.xxx(...)`。
- **`reload` 之后 `T` 随页面重置**：reload 之后的步骤一律用 `document.querySelector('o-page').shadowRoot` 直查元素（helper-free），不再依赖 `T`。
- **断言写在 eval 里**（抛错即失败），只保留 `expect.consoleErrors: 0` 交给宿主；**不要用 `expect.count` 数 `.item`**——宿主深查（`$`）会穿进 `st-menu` 等组件 shadow 命中同名 `.item`（踩坑 014）。
- **交互统一走 T 的辅助函数**：`st-button` 必须点到内部原生 button（踩坑 008），所以不用原始 `click` 步骤、也不写裸 `document.click()`；选择器都限定在页面 shadowRoot 内。
- **每个 `reload` 之后跟一个宿主侧数值等待 `{"wait": 1500}`**（让页面重载 + 调试代理重注入完成）：**不要把选择器 wait 紧跟在 `reload` 后面**——那时页面正在重载，指令投递会失败（宿主报 `ACK timeout after 4 retries`）或条件永远查不到（报 `wait 等待结果超时`）。长等待（倒计时 5–6 秒）也**单独占一个数值 wait 步骤**，不要与其它 eval 混在一条指令里（见踩坑 019）。
- **就绪轮询写在 eval 里、锚点用常驻节点**：`T.ready(sel, ms)` 在页面侧轮询（间隔 100ms），锚点选渲染后必然存在的容器——本项目用 `.shell`；**不要用 `.item` / `.gitem.active` 这类依赖数据的节点做就绪锚点**（已归档 / 垃圾桶 / 清空后列表合法为空，这种守卫永远不会满足）。需要"等某个数据节点出现"时，先用 `.shell` 等就绪再断言数据。
- **断言失败 / 超时中断时尾部的 restore 不会执行**：跑完必须核对 `localStorage.__todo_test_dirty` 已清、存储里用户数据已回来（用例开头的 wipe 会先复原遗留的脏备份，所以重跑一次即可自愈）。
- **宿主未注入 run-tests 通道时**（`action=run-tests` 报「宿主未注入预览通道」，但 status / eval 正常）：用 `test/_driver.js` 按同一套步骤语义本地回放（支持 `run(file, from, to)` 分片，因为单条 eval 不能超过 30s、`reload` 必须单独一次调用）——步骤与坑见 `pitfalls/018`。

## 踩坑索引

> 一坑一文件收在 `pitfalls/` 目录（命名与格式见 `pitfalls/README.md`）；本表只放索引，禁止把坑的正文写进本表。使用方式：按标题判断与本回合任务是否相关，命中才精读对应文件。

| 编号 | 标题 | 文件 |
| ---- | ---- | ---- |
| 001 | 页面 `:host` 没做成滚动容器，长列表被裁掉且无法滚动 | `pitfalls/001-host-must-be-scroll-container.md` |
| 002 | 预览通道两个验证陷阱：增量刷新不重置页面状态、应用首帧日志捕获不到 | `pitfalls/002-preview-channel-verification-traps.md` |
| 003 | 重构时删了 proto 方法、模板仍在调用，报 `function "xxx" not found` | `pitfalls/003-template-callback-must-exist.md` |
| 004 | 给 `st-input` 覆盖 `display` 会让真实可输入区缩成 156px；后台标签页里弹窗动画被冻结，rect 量出的尺寸是缩放假象 | `pitfalls/004-st-input-display-override-and-frozen-anim.md` |
| 005 | `st-dialog` 内部 `{{$host.xxx()}}` 静默渲染为空（弹窗里 `$host` 不指向页面） | `pitfalls/005-host-in-dialog-not-page.md` |
| 006 | 页面根级绑定里写 `$host.xxx()` 会报 `Error evaluating element expression`（根级要用裸方法名） | `pitfalls/006-host-in-root-level-binding.md` |
| 007 | 用 `preview eval` 取证的两个错觉：`o-page` 上读不到页面 data（改数据不驱动渲染）、`st-dialog` 打开状态要看 `hasAttribute('open')` | `pitfalls/007-page-data-and-dialog-open-introspection.md` |
| 008 | 实测 `st-button` 要点到内部原生 button：点宿主元素不触发 `on:click` 绑定（看起来像绑定坏了） | `pitfalls/008-st-button-click-must-hit-inner-button.md` |
| 009 | `n-icon` 放进 `st-icon-button` 时不要写 `width`/`height`/`font-size`：会与组件自带的 `::slotted { font-size:1.571em }` 叠加，把图标撑出按钮 | `pitfalls/009-n-icon-inside-st-icon-button-sizing.md` |
| 010 | `st-menu` 自测的三个错觉：trigger 是 toggle、关着的菜单项照样能点、悬停显隐在后台标签页量不出来 | `pitfalls/010-st-menu-self-test-traps.md` |
| 011 | 裸读 IndexedDB 核对持久化会静默超时：NoneOS 存储的库名是 `nos-storage-<id>`、仓库名是 `main` | `pitfalls/011-nos-storage-indexeddb-shape.md` |
| 012 | 自测侧栏拖拽宽度的三个注意点：`resizing` 类挂在 `.shell` 上、拖拽要用 `PointerEvent` 且派发到 `window`、拖完记得把宽度改回用户原值 | `pitfalls/012-sidebar-resize-self-test-traps.md` |
| 013 | 两列布局下重复定义 `.main` 的旧规则会静默覆盖新规则（改 `max-width` 不生效） | `pitfalls/013-duplicate-css-rule-silent-override.md` |
| 014 | `preview eval` 里调 `location.reload()` 会让该次调用 30s 超时；`$deep('.item')` 会穿进组件 shadow 命中同名类 | `pitfalls/014-preview-eval-reload-and-deep-selector-traps.md` |
| 015 | 预览域里的静态文件（CONTEXT.md 等）是「推送时快照」，改完文档立刻 fetch 会读到旧内容 | `pitfalls/015-preview-static-file-snapshot.md` |
| 016 | `<o-fill>` 是 `display: contents` 的元素，`getBoundingClientRect()` 全为 0——不能拿它当坐标参照（拖拽指示线跑偏的根因） | `pitfalls/016-o-fill-display-contents-rect-zero.md` |
| 017 | 用例断言要按实现的真实语义写：旧「拖拽排序」用例把落点语义写反（`after 某行` ≠ 往下挪一格） | `pitfalls/017-test-expectation-vs-drag-semantics.md` |
| 018 | 宿主未注入 run-tests 通道时如何本地回放 `.test.json`：动态 import 要用绝对 URL、单条指令 ≤30s、reload 必须单独一次调用 | `pitfalls/018-local-replay-tests-without-run-tests.md` |
| 019 | 用例步骤要「等页面复活」再动：reload 窗口里的选择器等不到（ACK timeout）、就绪锚点不能挑可能为空的节点（`.item` → 用 `.shell`） | `pitfalls/019-test-step-readiness-and-host-runner-failures.md` |
| 020 | `preview action=app` 报 ACK timeout 但推送其实已生效（先用 eval 判定，别反复重推） | `pitfalls/020-preview-app-push-ack-timeout-not-fatal.md` |
| 021 | 临时改预览数据时备份要挂 localStorage（挂 `window` 会被 reload 抹掉，`setItem(key, undefined)` 会清掉数据） | `pitfalls/021-temp-preview-data-backup-must-survive-reload.md` |
| 022 | 把过滤下沉到 getter 后，忘了同一视图的 `o-fill` 还绑着未过滤的旧数组（计数已过滤、列表却是全量） | `pitfalls/022-同一视图可能有两个数据源绑定.md` |
