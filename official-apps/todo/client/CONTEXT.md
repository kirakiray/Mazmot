# CONTEXT.md — 待办清单（todo）

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个单页的轻量待办清单：**左侧固定侧栏管理分组**（新建 / 改名 / 删除，宽度可拖拽 150–300px，选哪个分组就只看 / 创建哪个分组的任务）；右侧任务区**吃满剩余宽度**：添加（支持标题 + 多行描述，**还能带图片：选图或直接粘贴截图，压缩后随任务一起保存**；也能让 **AI 根据一句自然语言描述自动生成标题与描述**，**粘了图片时 AI 会改为识别图里的文字提取成任务，图里没有文字就把图片作为附件带入**）、勾选完成、**点任务打开「任务详情」弹窗（看信息与改标题 / 描述都在同一个窗口里，不用切换模式）**、**拖拽调整顺序（置顶项只能与置顶项互换、普通项只能与普通项互换）**、**置顶 / 取消置顶**（置顶项排在列表最前）、删除（5 秒倒计时后才进垃圾桶）、**按关键词搜索（任务区右侧的小搜索框，匹配标题或描述、忽略大小写，只过滤显示不动数据）**、按视图筛选（**全部 / 已归档 / 垃圾桶**，三个视图都跟随左栏选中分组）、右上「归档已完成」（把已完成的任务收进归档）；带一个可还原 / 可彻底删除的垃圾桶（彻底删除需二次确认）和一个可「取消归档」的归档箱——归档箱内还能按「**全部归档 / 按完成日 / 按完成周**」切换查看方式（按任务的**完成时间**分组：按完成日按本地日期、按完成周按 ISO 周）。每条任务记录并展示创建时间与最近一次状态变更时间。数据保存在本机（NoneOS 存储），关掉再回来还在。

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
   - **图片附件（同弹窗中部）**：一条虚线区「点击选择图片，或直接粘贴（Ctrl/⌘ + V）」（`label.img-drop` 里藏着 `input.img-input[type=file][accept=image/*][multiple]`，点它即打开系统文件选择；也能直接在弹窗里粘贴截图——粘贴监听挂在 `document` 上，只在添加弹窗开着时接图）。图片经 canvas 等比压到最长边 1280px、转 JPEG（质量 0.82，先铺白底，透明 PNG 不会变黑块）后进草稿；弹窗里以 64px 缩略图展示、右上角小圆按钮（`mdi:close`）移除当张，下方提示「已添加 N 张图片（最多 4 张）」。单条任务最多 4 张（`MAX_IMAGES`），超出的忽略并提示「有 N 张未能加入」。点「添加」时草稿里的图片原样写进任务的 `images`。
   - **AI 识别图片（同一弹窗下半部分，有图时自动启用）**：上面粘了 / 选了图片时，AI 按钮自动换成「AI 识别图片」（`mdi:image-search`），且不需要文字描述也能点。它以多模态消息把 `[文字, 图片…]` 一起发给模型，由模型判断：图里有可提取的文字（清单 / 聊天记录 / 便条 / 文档截图 / 手写内容）→ 整理成 `title` + `desc` 回填，提示「已从图片文字里提取任务…（图片会一起附上）」；图里没有文字（风景 / 人物 / 实物照片）→ 模型返回 `kind: "image"` 并给一句短语作标题，提示「图片里没有可提取的文字，已作为图片附件带入」。识别中按钮为「AI 识别中…」并禁用；图片压缩中按钮也禁用（避免图还没进草稿就发起识别）。
   - **AI 添加（同一个弹窗的下半部分）**：用一句自然语言描述要做的事（如「明天下午三点和客户开会，记得先准备报价单」）→ 点「AI 生成」（前置 `mdi:creation` 图标）→ 调平台 AI（`/mz/ai/main.js`）让模型输出 `{title, desc}`，**自动回填到上面的多行输入框**（标题首行 + 描述在后），用户改一改再点「添加」；描述框为空时按钮禁用，请求中按钮变「AI 生成中…」并禁用，成功后提示「AI 已生成，确认或改一改再点「添加」」，失败则在弹窗内红字显示原因且输入内容不丢。若弹窗里已经有图片，同一个按钮会换成「AI 识别图片」并走多模态识别，见下一条。
6. **视图筛选与搜索（同一行 `.toolbar`）**：左侧是 `全部 / 已归档 / 垃圾桶` 按钮组（已归档前置 `mdi:archive-arrow-down`、垃圾桶前置 `mdi:delete-outline` 图标，后两个标签带数量），与左栏分组叠加生效；**最右侧是紧凑的小搜索框**（190px 宽、13px 字号、前置 `mdi:magnify`、placeholder「搜索任务…」）。
   - **搜索口径**：关键词去掉首尾空白、转小写后与任务的**标题（`text`）或描述（`desc`）**做子串匹配（不区分大小写），任一命中即算匹配；输入即过滤（`sync:value` + `on:change` 打日志）。
   - **作用范围 = 当前分组 + 当前视图**：三个视图（全部 / 已归档 / 垃圾桶）都被搜索过滤；归档视图的「按完成日 / 按完成周」分组在过滤后的集合上重新分桶。
   - **只在显示层过滤**：统计「N 项未完成 · 共 M 项」、侧栏分组计数、视图标签数量、「归档已完成」的作用范围、归档底栏计数都**不受搜索影响**（它们读 `scoped*`，搜索只改 `searched*`），所以“搜到 1 条但底栏仍写共 3 项”是预期行为。
   - 搜索中在搜索框右侧显示「找到 N 项」与清除按钮（`mdi:close`，`title`「清除搜索」）；无匹配时列表为空并显示「没有符合「xxx」的任务，换个关键词试试」。
   - **搜索期间隐藏拖拽手柄**（`.drag-handle` 带 `class:hidden="$host.searching"`）：过滤后的可见顺序与 `todos` 槽位不再一一对应，`commitDragDrop()` 的槽位回写会算错位置，因此干脆不给拖。
   - 搜索词**不进存储、也不进会话状态**：刷新后回到空（未搜索），这是有意的（避免“打开应用只剩几条”的困惑）。
   - **全部**：列表（未归档、未删除的条目，含已完成与未完成两种）。
   - **已归档**：任务在这个视图里「收起来」——**不在列表显示、不计入统计与侧栏分组计数**，但数据没被删。每条可「取消归档」（回到原分组，勾选状态保留，由 `unarchiveTodo()`）或删除（走列表同款的 5 秒倒计时 → 垃圾桶）。**归档视图跟随左栏分组**（与列表视图同一口径）：左栏选中某分组时只显示该分组的归档，选「全部任务」时才是所有分组的归档。
     - **顶部说明行是一行短文案 + 末尾一个「?」图标**（`p.trash-tip.archive-tip` + `st-tooltip`）：可见文案只有「归档的任务不计入统计，也不在列表里显示」，完整的细则（取消归档 / 删除 / 跟随分组 / 按完成时间划分）放在 `st-tooltip` 的 `content` 里，悬浮或键盘聚焦「?」时弹出。**改回一整段长文案会被用户再抱怨一次**（原版 3 行长段落占掉一大块版面，用户反馈「太繁琐」）；短文案已覆盖最关键的语义，提示只是补充，因此触屏无悬停也不丢关键信息。
   - **归档视图内的查看方式（子标签）**：说明行下方是 `全部归档 / 按完成日 / 按完成周` 三个子标签，**默认「全部归档」**（平铺、无日期组头，等价于原来的样子）。
     - **分组基准是「任务完成时刻」**（`statusChangedAt`，见 `completedAt()`），**不是归档时刻**：归档往往比完成晚很久（“归档已完成”是攒着一起点的），按完成日 / 完成周归组才能对上「哪天做完的」这个直觉。条目副标题上显示的是**完成时间**（按它分组），**不再显示归档时间**——归档时刻在点开任务的详情里能看到，副标题因此短了一截。
     - **按完成日**：按完成时刻的**本地日期**分组（用本机时区切分，不用 UTC），**最新的一组排最前**；组头形如「**10-10 周六**」+ 右侧「N 项」（跨年时补 `YYYY-` 前缀）。
     - **按完成周**：按 **ISO 周**分组（周一为一周起点、取该周周四所在年份与周序号，跨年周不会算错），组头形如「**2026 年第 41 周 · 10-05 ~ 10-11**」+ 右侧「N 项」，同样最新的一组排最前。
     - 两种分组模式下**不带日期组头的那一档仍保持原顺序**（组内顺序 = `archivedTodos` 顺序，即 `todos` 里的顺序）；老数据既无完成时间也无归档时间时单独兜底一组「完成时间未知」，因为 key 前缀最小而**排在最后**。
     - 选中哪个子标签会写进 `sessionStorage` 会话状态（键 `archiveGroup`），刷新后仍停在原查看方式；关标签页 / 新窗口回落到「全部归档」。
     - 子标签切换**不筛数据、不改数据**，只改渲染方式（与筛选视图的「已归档」是两级：先选视图，再选组内呈现）。
   - **垃圾桶**：**同样跟随左栏分组**——左栏选中某分组时只显示该分组的垃圾桶条目，选「全部任务」时是全部；底部「清空垃圾桶」也只在当前分组范围内生效（确认框标题与文案都会写明分组名，不会误清其它分组）。
   - **当前筛选与选中分组会被记住**：切换分组 / 筛选时写入 `sessionStorage`，**刷新（F5）后仍停在原来的分组与视图**；关闭标签页或新开窗口则回到默认（「全部任务」+「全部」）。如果记住的分组已被删除，启动时自动回落到「全部任务」。
7. **拖拽排序**：每条任务最左侧有一个拖拽手柄（`mdi:drag-vertical` 图标，平时半透明 opacity 0.45、鼠标悬停到该行时变亮，`title` 为「按住拖动调整顺序：xxx」）。
   - **拖动过程只给引导，不改位**：按住手柄开始拖后，被拖的行原地变淡（`opacity 0.4` + 细描边，作为“源”标记），指针所在位置用**目标行的边缘线**提示落点——`class:drop-before`（插到这行之前，主题色 2px 线画在该行**上边**）+ `class:drop-after`（插到下一行之前 / 末尾，线画在该行**下边**），线左端带一个 9px 圆点；**松手时条目才真正插到指示线位置**并写入存储。按下后未移动就松手、或落点就是原位置时**不动数据也不写盘**。
   - 指示线**不使用坐标计算**：它由行自己的伪元素（`.item.drop-before::after` / `::before`）画在行边缘上（线在行外 5px、恰落在 8px 行间距的中间），所以永远与行对齐——**不要改回“算一个 `top` 再定位浮层”的写法**（那样会因为参照物取错而跑偏，见踩坑 016）。
   - 手柄**只在「全部」视图出现**（归档 / 垃圾桶视图不提供排序）；在某个分组下也能拖，但只能在当前分组可见的条目之间调（其它分组的条目相对顺序不变，任务的 `groupId` 不会被改）。
   - **同类才能互换（置顶约束）**：置顶项只能在**置顶区**内换位、普通项只能在**普通区**内换位。做法不是禁用拖拽，而是把落点**夹回被拖项的同类区间**——指针哪怕停在另一类的行上，落点线也会贴回同类区的首 / 末行（实测：把置顶项拖到普通行上时，线出现在置顶行自己的下边缘），松手后它仍在置顶区里（只是同类区内的位置可能变化）。实现见「页面骨架」与 `dragDropPosition()`。
   - 拖拽的**显示序基准是 `listTodos`（置顶在前）**：拖动过程中不改数据，松手时按显示序 splice 换位、再把新显示序写回 `todos` 的槽位（其它分组 / 归档 / 垃圾桶条目原地不动）。
   - 实现要点（详情见「页面骨架」）：手柄 `touch-action: none`、pointerdown 后监听挂 `window`、**落点判定用逐行 `getBoundingClientRect()` 比较**（不用 `elementFromPoint`，它穿不过页面 shadow；找列表容器用 `closest('.list')`，**不能用 `parentElement`**——它是 rect 全 0 的 `<o-fill>`，见踩坑 016），每个 `.item` 带 `attr:data-id` 供反查。
   - 拖拽**不会自动碌动列表**（长列表要先把目标区域滚进视口再拖）。
8. **勾选 / 置顶 / 删除（倒计时）**：左侧 `st-checkbox`（22px）勾选完成（文字加删除线变灰）；行尾操作区 `.item-actions` 里是**置顶 + 删除两个图标按钮**（各 **34px**，与侧栏分组行 ⋯ 同规格）——**行上的铅笔编辑按钮已去掉**（编辑并入「任务详情」弹窗，点正文区即可改，见第 9 条）。
   - **置顶 / 取消置顶**（行尾**第一个**按钮）：图标 `mdi:pin-outline` ↔ `mdi:pin`，`title` 为「置顶（置顶的排在列表最前，且只能在置顶项之间拖动排序）」/「取消置顶」。置顶后该行排到**列表最前**（置顶区），行左侧出现一条**主题色竖条**（`.item.pinned`）作为状态标记；取消置顶后它落到**普通区的最前**，按钮图标与 title 复原。状态与顺序都落盘，刷新后保持。**只有「全部」列表视图提供置顶按钮**（归档 / 垃圾桶视图不提供，归档 / 垃圾桶里也不需要）。多个置顶项之间是「**最近置顶的在最上**」（置顶时该条被挪到数组头部，而显示序取置顶项的数组顺序）。
   - **删除**（行尾**第二个**按钮）：点一下（关闭图标 `mdi:close`）开始 **5 秒倒计时**（整行变错误容器色、副标题逐秒倒计时、图标变撤销图标 `mdi:reply`），倒计时中再点即撤销，倒计时结束自动进垃圾桶。
9. **查看与编辑是同一个弹窗（「任务详情」）**：点任务正文区（标题/描述/缩略图/时间那块）打开弹窗——**信息与编辑在同一个窗口里，不再有「只读 ↔ 编辑」两副面孔来回切**。弹窗自上而下：**编辑区是一个多行编辑区**（与「添加任务」同一套口径：第一个非空行是标题、换行后的内容是描述，**但编辑区里不做任何行级样式**——所有行都是普通正文，见下）→ **任务图片（大图，右上角可移除，立即落盘）** → 只读元信息（分组、状态、创建 / 状态变更 / **归档** / 删除时间）；底部只有「关闭」+「**保存**」。列表里的描述只显两行摘要。
   - **「添加任务」与「任务详情」两个弹窗已放大**：两个 `st-dialog` 各挂 `.dialog-lg` 类，用 `.dialog-lg::part(panel) { width: min(760px, 100%) }` 把面板从默认 ≈480px 加宽到 760px（内容多的两个弹窗才放大；分组弹窗 / 二次确认弹窗保持默认宽度）。添加弹窗输入框 `min-height` 提到 `11em`（≈154px）、编辑区 `.rt-box` 提到 `11em` / 内部 `.rt-editor` `9em`（≈154px / 126px）。面板在 shadow 里，**只能用 `::part(panel)` 覆盖宽度**（不能写 `st-dialog { width }`）。
   - **图片在列表与详情里的呈现**：带图的任务在列表行的描述下方显示 **40px 缩略图**（`.thumb-sm`，横向排列，它们就在 `.body` 里，点缩略图同样打开详情弹窗）；详情弹窗里每张图展开为**等比缩到弹窗宽度内的大图**（`.dimg img`，`max-height: 220px`），右上角同样有小圆按钮可**移除这张图**（`removeDetailImage`，立即落盘，列表缩略图与空态同步更新）；归档行 / 垃圾桶行同样显示缩略图。不含图片的任务不显示这块（`class:hidden="!$data.images.length"` / `class:hidden="!detail.images.length"`）。
   - **编辑区是一个自制的多行编辑区**（`.rt-box > .rt-editor[contenteditable]`）：**每行一个 `.rt-line` 块，所有行样式完全一致**（14px / 400）。**历史坑：曾经给「第一个非空行」在框内加粗加大（`.rt-line.rt-title`，实测 20px / 700），因「什么时候算有第二行内容」的判定与光标 / 输入法边界情形太多、bug 不断，已整体去掉**——`applyEditorTitleClass()` 已删除，换成只维护空态的 `applyEditorEmptyClass()`；**不要再加回 `.rt-title` 那套**。原生 `textarea` 无法只给某一行换样式，所以才用 `contenteditable` 自己管行结构（现在只为「回车拆行 / 粘贴只取纯文本 / 空态保留可编辑空行」服务）。
   - **键盘行为与编辑区一致**：回车**自己拆行**（不靠浏览器插 `<div>/<br>`，行结构才能始终可控），光标落在新行开头；**粘贴只取纯文本**（不让外部 HTML 混进来），文本里带换行就拆成多行；输入法组合期间（`isComposing`）不重排 DOM、不拦回车（不打断中文录入）；点编辑框内边距（`.rt-box` 空白处）也会把光标放回编辑区末尾。内容被删光时会**自动补回一个可编辑空行**（否则光标无处可放、打不进字），空态显示占位提示。
   - **编辑就在这个弹窗里**：打开时编辑区已预填当前内容（首行标题 + 其余描述），直接在框里改 → 「保存」把多行拆回 `text` / `desc` 并**关闭弹窗**（列表与副标题实时同步）、「关闭」丢弃未保存的修改。**没有非空行时不能保存**（「保存」置灰）；保存只改这两项，不影响分组、勾选状态与各时间戳。**三个视图（列表 / 已归档 / 垃圾桶）的条目都走同一个弹窗**，点正文即可看可改（行上已无铅笔入口）。
   - **完成时间可直接改（已完成任务）**：已勾选完成（含已归档、且不在垃圾桶 / 倒计时中）的任务，详情弹窗里多一行「完成时间」编辑行（**原生 `input[type=datetime-local]`**，值由 JS 写入而非 `attr:value` 绑定），改动（`change`）即时写回 `statusChangedAt` 并落盘；**留空 / 清空一律不改数据、把输入框恢复成原值**（编辑时按退格也会触发 `change`，若直接写 `null` 就会把原记录静默弄丢——用户明确要求“不能把原来的完成时间弄丢”）。行尾常驻一条小字提示：有值时「改动即时保存；留空不会删除原时间」，原本就没有记录时「原数据未记录，可在此补填」（旧数据里有不少 `done=true` 但无时间戳的条目）。归档视图「按完成日 / 按完成周」的分组基准就是它，改完后归档分组与条目副标题的「完成于 …」即时重算。未完成 / 垃圾桶任务不显示这一行（`class:hidden`）。
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
└── test/            # 场景测试（防迭代回归）：13 个 *.test.json 用例 + 可选本地回放驱动 _driver.js
```

（`pitfalls/` 为踩坑库，`backup/` 为系统自动备份目录，均不属于运行时资源。）

## 数据模型

### 持久化（NoneOS 存储）

- 存储空间：`getStorage(STORE_ID)`，默认 `"conjure-todo-app"`；键三个：`"todos"`（任务）、`"groups"`（分组）、`"ui"`（界面偏好）。
  - **STORE_ID 可被测试临时切换**：模块顶部的 `STORE_ID` 先看 `sessionStorage.__todo_store_id`（值 `{ id, exp }`，`exp` 为过期时间戳、10 分钟有效），有效则改用那个隔离空间并打日志。这是**场景测试的钩子**——用例开跑前把数据空间切到 `conjure-todo-app-test`，于是测试永远不会碰用户真实数据（缘由见 `pitfalls/023`）；不在测试里就什么都不写，应用行为不变。

> 另有**会话状态**（当前筛选 + 选中分组）不进 NoneOS 存储，而是存在浏览器的 `sessionStorage` 键 `"todo-ui-state"`（值 `{ view, groupFilter, archiveGroup }`，其中 `archiveGroup` 是归档视图的查看方式，见 `archiveGroupMode`）。这是经用户明确要求的**豁免**（项目约定数据一律进 `/nos/storage`）：`sessionStorage` 的会话语义正好是「刷新保留、关标签页重置」。详见 MEMORY.md 的豁免记录，**不要把它「修正」回 `/nos/storage`**——那会变成关掉再打开也留在旧分组（超出用户预期）。
- 图片附件常量：`MAX_IMAGES = 4`（单条任务的图片数上限）、`IMAGE_MAX_SIDE = 1280`（压缩后最长边 px）、`IMAGE_QUALITY = 0.82`（转 JPEG 的质量）。
- `ui` 值：`{ sideWidth: number }` —— 分组侧栏宽度（px）。读取时用 `clampSideWidth()` 收敛到 150–300（非法 / 缺失回默认 190）；常量 `SIDE_MIN_W = 150` / `SIDE_MAX_W = 300` / `SIDE_DEFAULT_W = 190`。
- `groups` 值：`Array<{ id: string, name: string }>`，**首项固定为默认分组** `{ id: "default", name: "默认" }`；常量 `DEFAULT_GROUP_ID = "default"` / `DEFAULT_GROUP_NAME = "默认"`。新分组 id 为 `"g" + Date.now().toString(36) + random`。读取时过滤掉非法项；若不含 `default` 则自动在头部补上（旧数据没有 `groups` 键时也走这条，于是开局就有一个「默认」分组）。
- `todos` 值：`Array<Todo>`，`Todo = { id, text, desc, groupId, done, createdAt, statusChangedAt, archivedAt, pinnedAt, deletedAt, pendingDeleteAt, images }`（时间字段均为 `number|null`），新增项置于数组首位。
- **数组顺序 ≠ 显示顺序**（自「置顶」功能起）：`todos` 是**存储顺序**，列表视图的**显示序**由 getter `listTodos` 给出（置顶项在前、普通项在后，各自内部保持数组顺序）。两者靠「拖拽提交时按显示序换位、再写回槽位」保持同步（见 `commitDragDrop()`），所以**不要假设 `todos` 的先后就是眼睛看到的先后**；归档 / 垃圾桶视图仍直接用 `todos` 顺序。
- `archivedAt`：归档时刻；非空 = 已归档（不在列表显示、不计入统计与分组计数、不参与「全部」视图，但仍属于原分组，`groupId` 不变）。旧数据没有该字段，读取时补 `null`。条目只在「已归档」视图可见，取消归档则置回 `null`。**归档与垃圾桶是两个互斥维度**（`archivedAt` / `deletedAt` 可先后置位）：归档项可再被删入垃圾桶，从垃圾桶还原时 `restoreTodo` 会**一并清掉 `archivedAt`**，让它回到列表而不是回归档箱。
- `pinnedAt`：置顶时刻；非空 = 已置顶。置顶项在列表里排在普通项之前（`listTodos`），并且拖拽排序时只能在置顶项之间换位。旧数据没有该字段 → 读取时补 `null`。**置顶不是分组、也不改变 `groupId`**，只是列表内的一段排序区；归档 / 垃圾桶视图忽略它（那两处不显示置顶按钮）。
- `groupId`：任务所属分组 id；旧数据没有则归入 `"default"`（不存在「无分组」状态）。删除分组时组内任务的 `groupId` 改回 `"default"`。
- `text`：标题（多行输入的第一个非空行）。`desc`：描述（标题之后的所有行，保留内部换行；无描述为空字符串），旧数据读取时补 `""`。
- `id` 生成：`Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`。
- `createdAt`：创建时刻的 `Date.now()` 毫秒时间戳，添加时写入，之后不再变。
- `statusChangedAt`：最近一次切换完成态的时刻；未切换过为 `null`；勾选与取消勾选都会刷新（是否为「完成」由 `done` 推断，不另存操作类型）。
- `pendingDeleteAt`：点删除后开始倒计时的时刻；非空 = 正处于倒计时（仍在列表、仍计入统计）。倒计时时长常量 `TRASH_DELAY_MS = 5000`，轮询步长 `TICK_MS = 200`。**该字段不跨刷新恢复**（`loadTodos` 一律置 `null`），避免隔天打开时被“补刀”删掉。
- `deletedAt`：进入垃圾桶的时刻；非空 = 已在垃圾桶，不计入列表统计也不参与筛选（只在垃圾桶视图可见）。
- `images`：图片附件 `Array<{ id: string, dataUrl: string }>`，`dataUrl` 形如 `data:image/jpeg;base64,…`（压缩在入草稿时完成，见「关键流程」）。旧数据没有该字段 → `[]`。读取时逐张校验（**非 `data:image/` 开头一律丢弃**）并截断到 `MAX_IMAGES`；`id` 缺失时补一个随机 id（`o-fill` 的 `fill-key` 要求唯一）。
- 读取时做一次规范化（`String(id)` / `String(text || "")` / `!!done`，时间字段非 number 时一律置 `null`）；**旧数据没有时间字段，显示为「创建时间未知」而不伪造时间**。非数组或读取异常时保持空列表并 `console.error`。

### 页面状态（data）

| 字段 | 含义 | 初始值 |
| ---- | ---- | ------ |
| `draft` | 输入框草稿（`sync:value` 双向绑定） | `""` |
| `view` | 当前视图：`all` / `archived` / `trash` | `"all"` |
| `archiveGroupMode` | 「已归档」视图内的查看方式：`all`（全部归档，平铺）/ `day`（按**完成日期**分组）/ `week`（按**完成周**即 ISO 周分组） | `"all"` |
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
| `draftImages` | 添加弹窗里的图片草稿 `Array<{id,dataUrl,w,h}>`（粘贴 / 选图后压缩而来，点「添加」时原样写进任务 `images`） | `[]` |
| `imgBusy` | 是否正在压缩图片（压缩中禁用 AI 按钮，避免图还没进草稿就发起识别） | `false` |
| `imgNote` | 图片区提示（「已添加 N 张图片（最多 4 张）」等，空串时整行隐藏） | `""` |
| `searchText` | 搜索关键词（`sync:value` 双向绑定）；空串 = 未搜索 | `""` |
| ~~`emptyText`~~ | **已从 data 改成 proto getter**（见下面「计算属性」表）：搜索词 / 视图 / 分组一变文案就要变，靠手动调 `updateEmptyText()` 容易漏 | — |
| `nowTick` | 倒计时刷新用的当前时间戳；每次 tick 写入以驱动界面重算剩余秒数 | `0` |
| `confirmOpen` | 二次确认对话框 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `confirmTitle` / `confirmText` | 确认框标题与正文 | `""` |
| `purgeTarget` | 待彻底删除的目标：条目 `id` 或 `"ALL"`（清空垃圾桶） | `null` |
| `confirmKind` | 确认框类型：`"purge"`（彻底删除） / `"deleteGroup"`（删除分组） | `"purge"` |
| `confirmGroupId` | 待删除的分组 id（`confirmKind = "deleteGroup"` 时用） | `null` |
| `addOpen` | 「添加任务」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detailOpen` | 「任务详情」弹窗 `st-dialog` 的 `sync:open` 绑定 | `false` |
| `detailId` | 详情弹窗当前展示的任务 id（保存时据此定位条目） | `null` |
| `editDraft` | 详情弹窗编辑区的**多行文本**（视觉行以换行拼接；`openDetail` / `fillEditor` 预填，输入时由 `syncEditorDraft()` 同步）——DOM 里的行结构才是真正的编辑内容，`editDraft` 是它的数据镜像 | `""` |
| `detail` | 详情弹窗的**只读元信息**快照（字段见下），打开时用 `buildDetail(todo)` 算好 | 空对象（各字段为空串） |
| `detail.doneEditable` / `detail.doneAtValue` / `detail.doneAtHint` | 详情弹窗「完成时间」编辑行的开关 / 预填值（`datetime-local` 本地时区值）/ 行尾提示文案；仅 `done && !deletedAt && !pendingDeleteAt` 时可编辑 | `false` / `""` / `""` |

`detail` 快照字段（**文案全部预计算**，模板只读字段，原因见踩坑 005）：`{ images, groupText, statusText, createdText, statusChangedText, archivedText, deletedText }`（归档时间未归档时为 `—`；`images` 是 `Array<{id,dataUrl}>` 的拷贝，供详情弹窗渲染大图）。**标题 / 描述不在快照里**——它们是编辑区里的可编辑内容，数据镜像在 `editDraft`（快照只负责只读那半边）。

另有非响应式实例属性 `_tickId`（倒计时轮询的定时器句柄，见「关键流程」）、`_assistant`（`/mz/ai/main.js` 的 Assistant 实例缓存，首次点「AI 生成」时懒加载，见「关键流程」）与 `_editorComposing`（输入法是否正在组合中，组合期间 `onEditorInput` 不重建 DOM）。

### 计算属性（proto getter）

| getter | 含义 |
| ------ | ---- |
| `inTrashView` / `inArchiveView` / `inListView` | 当前视图是否为 `trash` / `archived` / `all`；模板用它们切换列表与底部栏（三套 `o-if`） |
| `activeTodos` | `todos` 中 `!deletedAt && !archivedAt` 的（含倒计时中的），统计、分组计数与「全部」视图都基于它 |
| `archivedTodos` | `!deletedAt && !!archivedAt` 的，即已归档条目 |
| `trashTodos` | `todos` 中 `deletedAt` 非空的 |
| `scopedArchivedTodos` / `scopedTrashTodos` | 归档 / 垃圾桶条目按当前选中分组过滤后的结果（`groupFilter = "all"` 时等于 `archivedTodos` / `trashTodos`），两个视图的列表、底栏计数、标签数量都基于它们 |
| `trashBadge` / `archiveBadge` | 垃圾桶 / 已归档标签上的数量后缀（取 `scopedTrashTodos` / `scopedArchivedTodos` 的长度，0 时为空串，因此**跟着分组变**） |
| `archiveGroups` | 「已归档」视图的渲染数据：`all` 模式返回**一组** `{ key:"all", showHead:false, todos: scopedArchivedTodos }`（组头隐藏 → 等价平铺）；`day` / `week` 模式按 **`archiveBucket(completedAt(t))`**（即完成时刻）分组、**最新一组在前**，每组 `{ key, label, showHead:true, countText:"N 项", todos }`。两种模式共用同一个 `o-fill`，不必维护两套条目模板 |
| `scopedActiveTodos` | 当前分组范围内的列表条目（`groupFilter = "all"` 时等于 `activeTodos`），列表 / 统计 / **归档已完成**都基于它 |
| `listTodos` | **列表视图的显示序**：`scopedActiveTodos` 里置顶项在前、普通项在后，各自内部保持数组顺序（稳定排序；没有置顶项时原样返回同一个数组）。拖拽排序的落点 / 换位都以它为基准 |
| `visibleTodos` | 当前视图要渲染的列表：`trash` → `searchedTrashTodos`、`archived` → `searchedArchivedTodos`、其余 → `searchedActiveTodos`（**三个视图统一跟随分组 + 搜索关键词**） |
| `searchKeyword` / `searching` | 关键词（去首尾空白 + 转小写）/ 是否处于搜索中（驱动「找到 N 项」、清除按钮、拖拽手柄隐藏） |
| `searchedActiveTodos` / `searchedArchivedTodos` / `searchedTrashTodos` | 列表 / 归档 / 垃圾桶三份数据在 `listTodos` / `scopedArchivedTodos` / `scopedTrashTodos` 基础上叠加 `matchKeyword()` 过滤的结果（未搜索时原样返回） |
| `searchHint` | 搜索区里的文字「找到 N 项」（N = `visibleTodos.length`） |
| `emptyText` | 空状态文案（**getter**，不再是 data 字段）：处于搜索中 → 「没有符合「xxx」的任务，换个关键词试试」；否则按 `view` + `groupFilter` 输出原来的文案（垃圾桶空 / 归档箱空 / 分组空 / 首屏提示） |
| `remaining` | `scopedActiveTodos` 中未完成数量 |
| `doneCount` | `scopedActiveTodos` 中已完成数量（同时决定「归档已完成」是否禁用） |
| `draftGroupId` | 新任务将归入的分组：浏览某分组时即该分组，否则默认分组 |
| `allCountText` | 侧栏「全部任务」的计数文案（不含垃圾桶） |
| `groupDialogTitle` | 分组弹窗标题：新建时为「新建分组」，改名时为「改名分组：「xxx」」 |
| `groupSubmitLabel` | 分组弹窗提交按钮文案：「创建」/「保存」（改名时） |
| `isListEmpty` | `visibleTodos.length === 0`，控制 `o-if` 空状态 |
| `aiDisabled` | AI 按钮是否禁用：正在请求 **或正在压缩图片** 或（描述框为空 **且** 没有图片）（模板 `attr:disabled="aiDisabled"`） |
| `aiButtonLabel` | AI 按钮文案：有图片时是「AI 识别图片」/「AI 识别中…」，无图片时是「AI 生成」/「AI 生成中…」 |
| `aiButtonIcon` | AI 按钮的 prefix 图标名：有图片时 `mdi:image-search`，否则 `mdi:creation` |
| `editParsed` | 编辑区的解析结果（`parseDraft(editDraft)`：首行标题 / 其余描述）；全空白时 `null` |
| `editCanSave` | 编辑区里至少有一个非空行才能保存（对应「保存」按钮的禁用态；与添加弹窗的「添加」同一口径） |

### 组件与页面骨架

- 页面结构自上而下：**两列网格 `.shell`**（左列 = 侧栏 `auto`（宽度由 `sideWidth` 决定）/ 右列 = 任务区 `minmax(0,1fr)`） → 左列 `<aside class="side">`（标题 → 分组列表 `.glist`（「全部任务」+ `o-fill :value="groups"`，每个真实分组行 = `.gname` + `.gcount` + ⋯ 菜单（`st-menu`：trigger `.gmenu` + 两个带 `prefix` 图标的 `st-menu-item`））→ 「＋ 新建分组」按钮 `.add-group-btn`）；右栏 `<div class="main">`（标题栏 `.top`（左侧 h1 + 副标题；右侧 `.top-actions` = 「归档已完成」`st-button` + 「＋ 添加任务」）→ 视图筛选按钮组 → **三套互斥的列表 + 底部栏（`o-if` 按 `inListView` / `inArchiveView` / `inTrashView` 切换）** → 共用的空状态）→ 四个 `st-dialog`（**添加任务**、**新建 / 改名分组**、**任务详情 / 编辑**、**统一二次确认**）。
- **任务详情弹窗只有一个视图（查看 + 编辑合一）**：自顶向下是 `.detail` 里的 **`.rt-box > .rt-editor[contenteditable="true"]`**（多行编辑区，行结构：每行一个 `div.rt-line`，空行内放一个 `<br>` 占位；**所有行样式一致，不做首行强调**）→ `.detail-images` 图片大图块 → 分组 / 状态 / 四个时间行（`.detail-row`）。`.rt-box` 只给 `width` / `min-height`（`11em`）边框（`focus-within` 变主题色）并提供 `data-placeholder`；`.rt-editor` 是 `position: relative` 的编辑区本体（`min-height: 9em`）。**行结构由页面自己维护，不能改用 `o-fill` 渲染行**（contenteditable 里的框架节点会与用户输入互相覆盖）。`slot="actions"` 只有一组（关闭 / 保存，保存用 `attr:disabled="!editCanSave"`）；headline 是静态文案「任务详情」，只读元信息全部来自 `detail` 快照。弹窗内**读 data 字段 / getter 的表达式可用**，不可用的只是 `$host.方法()`（踩坑 005）。**弹窗面板已放大**：该 `st-dialog` 挂 `.dialog-lg`（`::part(panel) { width: min(760px, 100%) }`），`.detail` 的 `max-width` 同步改为 `100%`。
- **多行编辑区（`.rt-*`）的七条实现要点**（改这块前先读完）：① **普通打字不重建 DOM**——`onEditorInput → syncEditorDraft()` 只同步 `editDraft` 与 `is-empty` 空态；仅当「行被删光」或「结构被浏览器改乱（出现非 `.rt-line` 子元素 / 行内非 `<br>` 元素）」时才 `renderEditor()` 重建，并先记下 `caretInfo()` 再 `focusEditor()` 放回光标（重建会丢光标、也会打断输入法）。② **回车自己处理**（`preventDefault` + 按行内偏移拆行），`ev.isComposing` 时不拦（输入法里回车是确认候选）。③ **粘贴只取 `text/plain`** 并按换行拆行，不让外部 HTML 进来。④ **空态必须留一个可编辑空行**：删空后若无行，光标无处可放、打不进字；且占位提示用 `::before` **叠在空行上**（`position: absolute`），**不能把空行 `display: none` 掉**。⑤ `caretInfo()` / `focusEditor()` 用「第几行 + 行内第几个字符」表示光标（行的 DOM 位置不靠 `parentElement` 猜，而是 `closest('.rt-line')`）；`focusEditor()` 内部先设 range 再 `focus()`。⑥ 编辑区元素通过 `editorEl()`（`document.querySelector('o-page').shadowRoot.querySelector('.rt-editor')`）取，弹窗刚开时可能还没渲染，`fillEditor()` 会用 `requestAnimationFrame` 最多重试 3 次。**⑦（新）编辑区不做任何行级样式**：`.rt-title` 及 `applyEditorTitleClass()` 已整体移除，只剩 `applyEditorEmptyClass()` 管空态；新增行级样式等于把 bug 多多的「首行判定」重新引入，不要做。
- **添加弹窗内分三段**：上半是任务输入（`st-textarea.dialog-field`，`min-height: 11em` ≈ 154px，比默认更高更长），中部是 **图片区 `.img-box`**（`label.img-drop`（内含隐藏的 `input.img-input[type=file]`，点 label 即选图）→ `.img-grid` → `o-fill :value="draftImages" fill-key="id"` 渲染 `.thumb`（64px 图 + `.thumb-del` 移除按钮）→ `.img-note` 提示行），其下是「将加入分组」提示，下半是虚线分隔的 **AI 区 `.ai-box`**（说明行 `.ai-head`（`n-icon mdi:auto-fix`）→ 描述框 `st-textarea.ai-field` → 右对齐的「AI 生成」`st-button`（`prefix` 槽放 `mdi:creation`）→ `.ai-note` / `.ai-error` 两行提示）。因为弹窗内容处在页面**根级**（不在 `o-fill` / `o-if` 内），绑定一律写裸方法名 / data 字段（`on:click="generateWithAi"`、`attr:disabled="aiDisabled"`），调用的也是 data 字段与 proto getter（踩坑 005 / 006）。AI 提示行与描述框的样式都在 `.ai-*` 类下，`.ai-field` 只给 `width` / `min-height`，**不覆盖 `st-textarea` 的 `display`**（踩坑 004）。
- **图片附件的三个实现要点**：① **粘贴监听挂在 `document` 上**（`ready()` 里 `document.addEventListener("paste", …)`）——弹窗里的 textarea 在页面 shadow 内，粘贴事件需 `composed` 冒出到 document 才收得到；回调里用 `this.addOpen` 门控，不弹窗时不插手。② 缩略图右上角的移除按钮用**原生 `<button>`**，不用 `st-icon-button`——组件自带 40px 尺寸体系，在 64px 缩略图上喧宾夺主（两者都行时，小尺寸浮层按钮优先用原生元素 + `n-icon`）。③ 压缩只在**入草稿时**做一次（`compressImage`），`addTodo` 只把草稿 `slice()` 拷贝进任务——图片只压缩一次，也不会因草稿被清空而丢图。
- **侧栏没有常驻输入框**（旧方案的顶部输入框已删）：新建分组走列表下方的「＋ 新建分组」按钮 → 弹窗；改名走**分组行右侧的 ⋯ →「重命名」** → 同一个弹窗（`editingGroupId` 区分模式）。原因：常驻输入框占位、与分组列表混在一起不易理解，用户反馈难用。侧栏 CSS 里 `st-input` 的选择器已改为 `.dialog-input`（弹窗内单行输入框只给 `width`）。
- **分组行的 `on:click` 绑在 `.gname` 与 `.gcount` 上而不是整行 `.gitem` 上**：这样行内的 ⋯ 菜单点下去不会顺带切分组，**不需要依赖 `stopPropagation`**（ofa 事件委托对 stopPropagation 不可靠）。行名区够大（`.gname` 撑满行高、含上下留白）+ 计数也接受点击，已经覆盖了行的整个左半部分；只剩右侧 34px 的 ⋯ 按钮区（它就是按钮本身，本就不该切分组）与「全部任务」行同位置的 `.gmenu-ghost` 占位点不动。后续若还想把点击区域扩到整行，必须处理“点行内按钮又切分组”的副作用，不要直接改回去。
- **行内四列结构**（从「全部任务」行与 `o-fill` 分组行两处对照看）：`.gname`（flex:1、可点）→ `.gcount`（可点）→ **第三列**：真实分组是 `st-menu > st-icon-button.gmenu`（34×34，平时 opacity 0 / 悬停与选中淡入），「全部任务」行是等宽的 `.gmenu-ghost`（34×34、不可点，只为对齐）。**改任一处宽度时两边要一起改**，否则计数会再次错位。
- **行内 ⋯ 的尺寸与显隐**：`st-icon-button` 只给 `font-size: 12px`（em 等比缩到 34px，实测 34.3×34.3），图标用 `n-icon` 且**不给它写 width/height**（见踩坑 009）；显隐靠 `.gitem:hover .gmenu` / `.gitem.active .gmenu` / `.gitem:focus-within .gmenu` 淡入，外加 `@media (hover: none)` 兜底（后台标签页量不到 `:hover`，见踩坑 010）。
- **行内菜单用 `st-menu`**：`<st-menu><st-icon-button slot="trigger" …></st-icon-button><st-menu-item>…</st-menu-item></st-menu>`；`st-menu-item` 在 light DOM，所以 `o-fill` 里的 `$host.方法($data.id)` 绑定正常（实测「重命名」/「删除」都命中正确分组）。`open` 是 ofa data 不是标签属性；面板关闭时菜单项仍在 light DOM（rect 为 0）——自测陷阱见踩坑 010。
- **页面内功能图标已全部走 NoneOS Core 的 `n-icon`**（`<l-m src="/nos/n-icon/n-icon.html"></l-m>`，Iconify 集名语法如 `mdi:pencil`），不用 emoji：颜色自动继承 `currentColor`、可随主题变化。落位：h1 前置 `mdi:check-circle-outline`（`h1 n-icon { font-size: 1em; color: var(--md-sys-color-primary) }`）；「添加任务」「新建分组」用 `st-button` 的 `prefix` 槽放 `mdi:plus`、筛选栏垃圾桶用 `mdi:delete-outline`（统一 `st-button n-icon { font-size: 1.15em }` 与 14px 文字齐高，实测 16.1px）；分组行 ⋯ 菜单的两个 `st-menu-item` 也用 `prefix` 槽放图标（`mdi:pencil` / `mdi:delete-outline`，`st-menu-item n-icon { font-size: 1.15em }`，实测 16.1px、菜单项 106×37）；列表删除按钮的图标名由 `deleteButtonIconName()` 给（`mdi:close` / `mdi:reply`）、垃圾桶「彻底删除」用 `mdi:delete-outline`；图片相关图标：选图区 `mdi:image-plus`、AI 识别按钮 `mdi:image-search`（由 `aiButtonIcon` getter 给）、缩略图移除按钮 `mdi:close`（该按钮是原生 `<button>`，所以 `n-icon` 需写 `font-size: 14px`，不受 `st-icon-button` 的 `::slotted` 规则约束）。仍是 emoji 的只剩**文案**里的装饰（空状态提示 🎉 等），不是功能图标。**放进 `st-icon-button` 时不要给 `n-icon` 写 `width/height/font-size`**——它会吃组件自带的 `::slotted { font-size: 1.571em }`，再叠加就撑出按钮（见踩坑 009）。图标按需从 `api.iconify.design` 取并持久化缓存在 `getStorage("n-icon")`（本环境实测可直连、硬刷新约 100ms 出图）。
- **拖拽排序（引导式，松手才换位）**：`.item` 首位是手柄 `.drag-handle`（`font-size: 20px`、图标 `mdi:drag-vertical`、`touch-action: none` 防触屏拖动变成滚页、`cursor: grab`；`opacity: 0.45` → `.item:hover` 时 1，`@media (hover: none)` 常显 0.8）。手柄 `on:pointerdown="$host.startDrag($event, $data.id)"`（模板里用 `$event` 传事件对象）。**拖动中不改 `todos`**，只写两个 data 字段驱动引导：`dropBeforeId` / `dropAfterId`（对应模板 `class:drop-before` / `class:drop-after`）；被拖行靠 `.item.dragging`（`opacity 0.4` + `inset` 描边，**位置不动**）标识。**换位只在 pointerup 时发生**（`commitDragDrop()` 一次 splice + 落盘）。手柄在 `.body` 之外，所以点 / 拖手柄都不会误开详情弹窗。
- **拖拽的显示序基准是 `listTodos`、并且受置顶约束**：`todos` 是存储序，眼睛看到的先后是 `listTodos`（置顶在前）。因此 `dragDropPosition()` 先用指针位置算出**显示序里的插入下标**，再用 `classList.contains('pinned')` 找出行里的同类区间把它夹回去（置顶项只能在置顶项之间、普通项同理）；`commitDragDrop()` 也在 `listTodos` 上 splice，最后把新显示序按**槽位**写回 `todos`（`new Set(ids)` + 队列 `shift()` 逐个替换，其它分组 / 归档 / 垃圾桶条目原地不动）。**不要再改回“在 `todos` 上按 beforeId/afterId 绝对下标换算”的写法**（置顶后它与显示序不再一致）。
- **落点指示线画在行自己的边缘上（不用坐标）**：`.item { position: relative }`，`.item.drop-before::after` / `.item.drop-after::after` 是 `left: 8px; right: 0; height: 2px` 的主题色线（`top: -5px` / `bottom: -5px`，恰好落在 8px 行间距的中间），`:before` 是左端 9px 圆点（`top: -8.5px` / `bottom: -8.5px`）。这样指示线与行**几何上永远对齐**，不存在坐标系错位（曾经的“算 top 再定位浮层”写法因参照物取错而跑偏，见踩坑 016）。
- **拖拽落点判定不能用 `elementFromPoint`，也不能用 `parentElement`**：前者从 `document` 出发只能命中 `<o-page>` 宿主（穿不过页面 shadow）；后者拿到的是 `display: contents` 的 `<o-fill>`（rect 全为 0，详情见踩坑 016）。正确做法是本项目 `dragDropPosition()`：`handleEl.closest('.item').closest('.list')` 拿列表容器，再 `querySelectorAll('.item')` 逐行比 `getBoundingClientRect()`，看指针 `clientY` 落在哪行的上半 / 下半区——**上半区 → 插到该行前、下半区 → 插到下一行前**（最后一行下半区则追加到列表末尾），**最后再把这个下标 `clamp` 进被拖项的同类区间**（置顶 / 普通）。行上的待办 id 从 `attr:data-id="$data.id"` 读，同类标记从 `classList.contains('pinned')` 读。
- **换位索引换算（沿用）**：`commitDragDrop(id, insertIdx)` 先把被拖条目从 `listTodos` `splice` 出来，再把**原插入下标换算到“抽掉自己之后”的下标**（`insertIdx > from` 则 -1）；换算后等于 `from` 说明落点就是原位，直接返回不写盘。这样拖拽不会“自己把自己插到错位”。**注意基准是 `listTodos`（显示序）而不是 `todos`**（置顶后两者不一致），写回 `todos` 时才用槽位映射。
- **侧栏放页面内而非弹窗里**：侧栏需要 `o-fill` 循环分组并在行内传 `$data.id` 调方法，而弹窗内 `$host` / `$data` 的行为不可靠（踩坑 005）。
- **绑定写法要区分层级（踩坑 006）**：页面**根级**元素用裸方法名 / data 字段（`class:active="isGroupActive('all')"`、`on:click="setGroup('all')"`）；**`o-fill` / `o-if` 内部**用 `$host.方法($data.id)`。根级写 `$host.xxx()` 会报 `Error evaluating element expression` 且绑定静默失效。
- 媒体查询只有两条：`@media (max-width: 620px)`（`.shell` 变单列、`.side` 不再 sticky 也不限高而是通栏（`width: auto !important` 压过行内宽度）、`.glist` 改横向 wrap、`.resizer` 隐藏）与 `@media (hover: none)`（触屏上行内 ⋯ 菜单常驻可见）。**已不存在 ≤1100px 那条**（两列布局没有右侧留白列可去）。
- **宽度与空间利用**：`.shell` 只设 `width: 100%`（**不设 `max-width` / `margin: 0 auto`**，否则超宽屏上侧栏会被居中容器一起推到屏幕中间）；布局用两列 grid（左栏 `auto` + 右列 `minmax(0,1fr)`），`.side` 写行内 `width: sideWidth`、`.main` 写 `width: 100%` ——**任务区把剩余宽度吃满，侧栏拖多宽都不会在右侧浪费空间**；行宽上限（`max-width: 1200px` + `margin: 0 auto`）只加在 `.main` 上。上面提到的 `.spacer` 留白列已删除（曾为“任务区居中”而存在，会浪费空间）。
- **可拖拽的侧栏宽度**：`.side` 写 `:style.width = sideWidth + 'px'`；手柄 `.resizer` 是**绝对定位在侧栏右边缘间隙中间**的独立元素（`left = sideWidth + 10 + 'px'`，`transform: translateX(-50%)`），不参与网格排版，所以不会被侧栏的 `overflow` 裁剪；`pointerdown` 起手后监听挂在 `window`（`startResize`），拖动结束才落盘。改宽度时**只改 `data.sideWidth` 一处**，侧栏与手柄都会跟随（任务区是 `1fr`，自动吃满剩余宽度）。
- `st-dialog` 用法统一为：`sync:open="xxxOpen"` + `auto-close`，`slot="headline"` 放标题、`slot="actions"` 放按钮；需更宽面板时在宿主上加 `.dialog-lg`（见上一节）。`st-dialog` 内直接 `querySelectorAll('st-button')` 能拿到两个操作按钮（`slot="actions"` 里的 div 不影响）。
- `.dialog-field { width: 100%; min-height: 11em; }`：弹窗内输入框只改宽度与最小高度，**不覆盖 `st-input` / `st-textarea` 的 `display`**（原因见踩坑 004）。
- **两个大弹窗的面板宽度靠 `::part(panel)`**：`st-dialog` 的面板在 shadow 内（`part="panel"`），默认宽 `min(34.29em, 100%)`（≈480px）；给需要更宽面板的弹窗挂 `.dialog-lg` 类，用 `.dialog-lg::part(panel) { width: min(760px, 100%) }` 覆盖。**当前挂了这个类的是「添加任务」与「任务详情」**（内容多），分组弹窗 / 二次确认弹窗保持默认 480px。写 `st-dialog { width }` 是无效的，必须用 `::part`。
- **右上操作区 `.top-actions`**：`display: flex; align-items: center; gap: 8px; flex: none`，内容依次是「归档已完成」（`variant="text"`，与主按钮「添加任务」区分主次）与「添加任务」。实测任务区右边缘贴齐视口（归档按钮 x=898 / 添加按钮 x=1042、右边缘 1164 = 视口 1180 - 16 padding）。窄屏（≤620px）在媒体查询里给 `.top` 加 `flex-wrap: wrap`，放不下时按钮组整块换行，不把标题挤扁。
- **行尾操作区 `.item-actions`**：`flex: none; display: flex; gap: 2px`，列表行里是「置顶 + 删除」两个 `st-icon-button`（**编辑按钮已随“查看 / 编辑合并”删除**，改由点正文开弹窗；归档行 / 垃圾桶行的操作区里仍只有各自的删除类按钮）。按钮 **34px**（给 `st-icon-button` 设 `font-size: 12px`，em 等比缩放，图标 18.9px；不要给 `n-icon` 写尺寸，见踩坑 009）。置顶态下置顶按钮的**宿主** color 换主题色（`.item.pinned .pin-btn`），普通态是 `on-surface-variant`。倒计时（`.item.pending`，错误容器底色）下按钮的**宿主** color 换成 `on-error-container`（实测 255,180,171）。注意必须直接命中 `st-icon-button` 宿主：它自带 `color: on-surface-variant`，父容器上写 `color` 会被组件自声明盖掉。
- **置顶行的视觉用 `inset` box-shadow、不用伪元素**：`.item.pinned { box-shadow: inset 3px 0 0 0 var(--md-sys-color-primary) }` 画左侧主题色竖条。`::before` / `::after` 已被拖拽落点指示线占用（`.item.drop-before::before` 是圆点、`::after` 是线），再加一层伪元素会与落点线互相覆盖。
- **「已归档」视图内是两层容器 + 嵌套 `o-fill`**：说明行 `.archive-tip` → 子标签 `st-button-group.archive-tabs`（`全部归档 / 按完成日 / 按完成周`）→ `.agroups` → `o-fill :value="archiveGroups" fill-key="key"`（每组一个 `.agroup`，组内是 `.agroup-head`（`label` + `countText`）+ `.list` → 内层 `o-fill :value="$data.todos" fill-key="id"` 渲染条目）。**嵌套 `o-fill` 里的 `$data` 分别指向两层数据**（外层是组、内层是任务），内层条目上的回调仍旧用 `$host.xxx($data.id)`；`fill-key` 两层都要给（外层 `key`、内层 `id`）。
- **「全部归档」不用单独一套模板**：`archiveGroups` 在 `all` 模式下返回「一组 + `showHead:false`」，组头用 `class:hidden="!$data.showHead"` 隐藏，条目模板与分组模式完全共用（少维护一套一模一样的行结构）。
- **说明行用 `st-tooltip` 收纳长文案**（引入 `<l-m src="/gh/ofajs/senti-ui@latest/packages/tooltip/tooltip.html"></l-m>`）：可见的只有一行短文案，末尾的 `span.help-btn`（`n-icon mdi:help-circle-outline`、`tabindex="0"`、`role="img"` + `aria-label`）是提示触发器，完整说明放在 `st-tooltip` 的 `content` 属性里（内容是**静态字符串，不涉及任何绑定**，因此放在 `o-if` 里也没有 $host 相关的坑）。
  尺寸上：**气泡的 padding / 字号 / max-width 全是 em**，直接给 `st-tooltip` 打 `font-size: 14px` 把气泡正文提到 12px（默认继承说明行的 12px → 气泡只有 10.28px、宽 206px，读长句太憋）；触发图标用 `1.07em` 折回 15px 与 12px 文案齐高。组件 shadow 里没有 `part`，只能这样从宿主缩放，**别用 `::part`**——样式不会生效。改触发器 / 验证提示时的两个陷阱见踩坑 024。
- **筛选按钮组与搜索区同处一行 `.toolbar`**（`display:flex; justify-content:space-between; flex-wrap:wrap`）：左侧 `st-button-group`（三个视图按钮），右侧 `.search-bar`（`margin-left:auto`；内含 `st-input.search-field`（**190px 宽 / 13px 字号，只给 width / min-width / font-size**，不覆盖组件的 `display`，见踩坑 004，`prefix` 槽放 `mdi:magnify`）+ `.search-count`（「找到 N 项」，`!searching` 时 `class:hidden`）+ 清除 `st-icon-button`（`font-size: 12px`））。**不要改回单独占一整行的通栏搜索框**（用户明确要求“做小一点、放到垃圾桶那一排的最右侧”；实测小搜索框 190×37、真实输入区 140px、与按钮组 top 差 1.4px、右边缘与 `.main` 齐）。
- **搜索只在显示层过滤**：数据层仍只有 `todos`；`searchedActiveTodos` / `searchedArchivedTodos` / `searchedTrashTodos` 三个 getter 在 `listTodos` / `scoped*` 之上叠 `matchKeyword()`，`visibleTodos` 与 `archiveGroups` 改读它们。**统计 / 分组计数 / 标签徒标 / 「归档已完成」范围一律仍读 `scoped*`**（否则搜索会改掉它们语义，同踩坑 022 那类“同一视图两个数据源”的陷阱，改这里时两边一起看）。
- **搜索期间禁用拖拽**：`.drag-handle` 带 `class:hidden="$host.searching"`——过滤后的可见序与 `todos` 槽位不再一一对应，`commitDragDrop()` 的槽位回写会错位。
- **`emptyText` 是 getter 而不是 data 字段**：以前靠 `setView` / `setGroup` / `deleteGroup` / `restoreSessionState` 手动调 `updateEmptyText()`，加搜索后容易漏调；改成 getter 后搜索词一变文案自动响应。**`updateEmptyText()` 已删除，不要再加回来**。
- **三个视图的模板结构**：`全部`（`.item`：拖拽手柄 `.drag-handle` + `st-checkbox` + `.body` + `.item-actions`（**置顶 + 删除**两个按钮））——**三个视图的 `.body` 内部结构一致**：`.text`（标题）→ `.desc`（描述摘要）→ `.thumbs`（`o-fill :value="$data.images"` 渲染 40px 缩略图 `.thumb-sm`）→ `.meta`（时间副标题），缩略图块用 `class:hidden="!$data.images.length"` 控显隐、`已归档`（`.item.archived`：用 `.arch` 包一个 `n-icon icon="mdi:archive-arrow-down"` 占住勾选框位置（行高与其它视图一致）+ `.body` + 「取消归档」`st-button` + `.item-actions`）、`垃圾桶`（`.item.trash`：`.body` + 「还原」+ 彻底删除）。**三套列表各自一个 `o-fill`**，且**都绑过滤后的 getter**：列表视图 `visibleTodos`、归档视图 `archiveGroups`（内部用 `scopedArchivedTodos`）、垃圾桶视图 `scopedTrashTodos`。改数据范围时要三处一起看——本项目就漏过垃圾桶那一处（底栏计数已过滤、列表还是全量，见踩坑 022）。共用 `.list` / `.item` 基础样式；空状态 `isListEmpty` 与 `{{emptyText}}` 在三套之外只写一次（数组成空就显一个，不会重叠）。

### 时间显示（proto 方法）

| 方法 | 作用 |
| ---- | ---- |
| `formatTime(ts)` | 时间戳 → `MM-DD HH:mm`；跨年补为 `YYYY-MM-DD HH:mm`；非 number / 非法值返回「未知」 |
| `timeMeta(todo)` | 列表项副标题，按优先级：倒计时中 → `N 秒后移入垃圾桶（点撤销按钮可撤销）`；已在垃圾桶 → `删除于 … · 创建于 …`；**已归档 → `完成于 … · 创建于 …`**（**不显示归档时间**：归档时刻点开详情可见，副标题保持简短；完成时间缺失时省略那一段）；其余 → `创建于 …`（+ 有 `statusChangedAt` 时追加 ` · 完成于 …` / ` · 恢复于 …`） |
| `isPending(todo)` / `pendingSeconds(todo)` | 是否处于倒计时 / 剩余秒数（用 `nowTick` 与 `TRASH_DELAY_MS` 算，向上取整）；列表与归档视图都用它 |
| `deleteButtonIconName(todo)` / `deleteButtonTitle(todo)` | 同一个按钮的状态化外观：倒计时中图标名为 `mdi:reply` +「撤销删除」，否则为 `mdi:close` +「删除（5 秒后移入垃圾桶）」 |
| `isPinned(todo)` / `pinButtonIconName(todo)` / `pinButtonTitle(todo)` | 是否已置顶 / 置顶按钮的图标名（`mdi:pin-outline` ↔ `mdi:pin`）/ 按钮 `title` 文案 |
| `togglePin(id)` | 置顶 / 取消置顶（注意不要和 ofa 内置名冲突，叫 `togglePin`）：**置顶**时把该条挪到 `todos` 数组头部（于是它成为置顶区里最上面的一条）并写 `pinnedAt = now`；**取消置顶**只清 `pinnedAt`（它留在数组头部 → 成为普通区的最前一条）；两者都 `persistTodos()` |
| `startDrag(ev, id)` | 拖拽手柄 `pointerdown` 入口（写 `$host.startDrag($event, $data.id)`）：置 `draggingId`，把 `pointermove` / `pointerup` / `pointercancel` 挂到 `window`；移动时只更新 `dropBeforeId` / `dropAfterId`（视觉）与闭包里的 `dropInsertIdx`（显示序里的插入下标），**不动 `todos`**；松手时清视觉态，**真移动过才调 `commitDragDrop()`** |
| `dragDropPosition(clientY, handleEl)` | 由手柄 `closest('.item')` → `closest('.list')`（**不能 `parentElement`，见踩坑 016**）拿到列表容器，逐行比 `getBoundingClientRect()`，返回 `{ insertIdx, beforeId, afterId }`——**不产生任何坐标**。三步：① 按指针在行的上 / 下半区算出显示序里的插入下标（上半区 → 该行之前；下半区 → 下一行之前；末尾下方 → 追加末尾）；② **把下标夹回被拖项的同类区间**（置顶项 `[第一置顶行, 最后置顶行+1]`，普通项同理，行上的同类标记从 `classList.contains('pinned')` 读）；③ 落点线仍按同类区间内的行边缘给出 `beforeId` / `afterId` |
| `commitDragDrop(id, insertIdx)` | 松手提交：以 **`listTodos`（显示序）**为基准 splice 出被拖条目 → 原下标换算（`insertIdx > from` 则 -1）→ 插回 → **把新显示序写回 `todos` 里“当前范围列表条目”所占的槽位**（`Map` 逐个替换，其它分组 / 归档 / 垃圾桶条目原地不动）→ `persistTodos()`；落点即原位时不动数据、不写盘 |
| `isDragging(id)` / `isDropBefore(id)` / `isDropAfter(id)` / `dragHandleTitle(todo)` | 该行是否被拖（`.item.dragging`） / 落点线画在该行上边 / 下边 / 手柄 `title` 文案 |
| `isPinned` / `pinButton*` / `togglePin` | 见上（置顶相关）；模板里行尾置顶按钮用 `attr:title="$host.pinButtonTitle($data)"` + `attr:icon="$host.pinButtonIconName($data)"` |
| `openAdd()` / `closeAdd()` | 打开 / 关闭添加弹窗（两者都会重置 `draft` 为空，并清空 AI 区的 `aiDraft` / `aiNote` / `aiError` **与图片区的 `draftImages` / `imgNote` / `imgBusy`**；`openAdd` 不给残留草稿） |
| `submitAdd()` | 弹窗内提交入口：调 `addTodo()`，**成功才关弹窗**（多行输入回车 = 换行，所以只有按钮会调它） |
| `parseDraft(raw)` | 多行文本 → `{ title, desc }`：第一个非空行作标题，其后全部行（含内部换行）作描述；无任何非空行返回 `null` |
| `getAssistant()` | 懒加载 `/mz/ai/main.js` 并缓存 `getAssistant()` 实例到 `this._assistant`（模块顶层不能 import，必须用工厂注入的 `load`） |
| `onPickImages(ev)` | file input 的 `change` 入口：取出 `files`、**先清空 input.value**（否则同一张图选第二次不触发 change）→ 交给 `attachImages()` |
| `handlePaste(ev)` | `document` 级 `paste` 监听（在 `ready()` 里挂上）：仅在 `addOpen` 为真时接图，从 `clipboardData.items` 里挑 `kind === "file"` 且 `type` 以 `image/` 开头的项取 File → `attachImages()`；**没图就不动**，且剪贴板里同时有 `text/plain` 时不 `preventDefault`（否则从网页复制图文会丢掉文字） |
| `attachImages(files)` | 把 File 列表逐张交给 `compressImage()` 并挂到 `draftImages`；受 `MAX_IMAGES` 限制，超出的计入 `skipped`；结束后写 `imgNote`（「已添加 N 张图片（最多 4 张）」+ 未能加入的张数）；单张失败只 `console.error` 并计入 skipped，不影响其它图 |
| `compressImage(file)` | File → `{ dataUrl, w, h }`：`URL.createObjectURL` + `Image` 解码 → canvas **等比缩到最长边 `IMAGE_MAX_SIDE`** → 先铺白底再 `drawImage`（透明 PNG 转 JPEG 不会出黑块）→ `toDataURL("image/jpeg", IMAGE_QUALITY)`；无论成败都 `revokeObjectURL` |
| `removeDraftImage(id)` | 从草稿里移除一张（缩略图右上角按钮）并刷新 `imgNote` |
| `removeDetailImage(id)` | 移除**已保存任务**的一张图（详情弹窗大图右上角）：改 `todos` → 重算 `detail` 快照 → `persistTodos()`，列表缩略图与详情同步更新 |
| `parseAiReply(content)` | 模型回复 → `{ kind, title, desc }`：先剥掉可能的 ```json 围栏、取首个 `{` 到末个 `}` 做 `JSON.parse`（兼容 `name` / `description` 字段名；`kind` 只认 `"image"`，其余一律当 `"task"`），失败则把整段回复交给 `parseDraft` 兜底 |
| `generateWithAi()` | AI 按钮入口（一套逻辑两种形态）：**无图**时按 `AI_SYSTEM_PROMPT` 把文字整理成 JSON；**有图**时改用 `AI_IMAGE_SYSTEM_PROMPT` 并把 user 消息的 `content` 换成 `[{type:"text"}, {type:"image_url", image_url:{url: dataUrl}} …]` 多模态数组（没文字时默认提示语「请识别图片里的内容，整理成待办任务。」）。成功后把 `title + "\n" + desc` 回填 `draft`（保持“首行标题”格式），并按「无图 / 识图文字 / 图片无文字」三种情况写 `aiNote`；失败写入 `aiError`，`finally` 复位 loading |
| `buildDetail(todo)` | 生成详情弹窗的**只读元信息**对象（图片快照 `images` / 分组 / 状态 / **四个**时间文案均在此算好；状态优先级：倒计时中 → 已在垃圾桶 → 已归档 → 已完成 → 未完成）；另算 `doneEditable`（已完成且不在垃圾桶 / 倒计时）与 `doneAtValue`（`toDatetimeLocal(statusChangedAt)`） |
| `toDatetimeLocal(ts)` | 时间戳 → `datetime-local` 控件的本地时区 value（`YYYY-MM-DDTHH:mm`）；非法值空串 |
| `doneAtInputEl()` / `syncDoneAtInput(value, tries)` | 取「完成时间」输入框元素（查页面 shadowRoot，未渲染时 `requestAnimationFrame` 重试 3 次）/ 把值写进输入框。**必须用 JS 设 `property`，不能靠 `attr:value` 绑定**：input 的 value 被 JS 改过之后再改 attribute 不再同步到 property，换一条任务打开会残留上一条的值（见 `pitfalls/027`） |
| `onDoneAtChange(ev)` | 详情弹窗里修改完成时间：解析 `datetime-local` 值并写回 `statusChangedAt` → 重算 `detail` 快照 → 立即落盘；**空值 / 无法解析 / 与原值相同一律不写数据，只把输入框恢复成原值**（避免误清空丢掉原完成时间） |
| `openDetail(id)` / `closeDetail()` | 打开详情（生成只读元信息快照 + 记 `detailId` + `fillEditor()` 把多行编辑区预填成“首行标题 + 其余描述”） / 关闭详情（清 `detailId`、清 `editDraft` 并把编辑区重置为一个空行，未保存的修改即丢弃） |
| `submitEditDetail()` | 保存：先用 `syncEditorDraft()` 对齐真实内容，再用 `parseDraft()` 把编辑区拆回 `text` / `desc`（全空不生效），只改这两项（不动分组、`done` 与各时间戳），写回后**关闭弹窗**并 `persistTodos()` |
| `editorEl()` | 取编辑区元素（`document.querySelector('o-page').shadowRoot.querySelector('.rt-editor')`）——页面里只有一个页面实例，所以直接查宿主；弹窗未渲染时返回 `null` |
| `editorLines()` | 从 `innerText` 读「视觉行」（按 `\n` 拆，块级边界即换行）——**不依赖 DOM 是否规范**，所以浏览器自作主张插入的块 / `<br>` 也能正确读出 |
| `editorStructureOk()` | 行结构是否规整（子元素全是 `div.rt-line`，行内除文本只有 `<br>`）；只有不规整或行被删光时才会重建 DOM。**行样式不在判定范围内**（已无行级样式） |
| `renderEditor(lines)` | 行数组 → DOM（每行一个 `.rt-line`，空行内放 `<br>`），同时调 `applyEditorEmptyClass()` 切 `is-empty` 空态；**只在填充 / 拆行 / 粘贴 / 结构异常时调**，普通打字不调 |
| `applyEditorEmptyClass(lines)` | 所有行都空白时给编辑区加 `is-empty`（占位提示靠它显示）。**曾经的 `applyEditorTitleClass()`（首行加粗加大）已整体删除**，不要再加回 |
| `fillEditor(text, tries)` | 把多行文本填进编辑区（同步 `editDraft` + `renderEditor`）；元素还没渲染时用 `requestAnimationFrame` 最多重试 3 次 |
| `syncEditorDraft()` | 输入后回写：`editDraft = editorLines().join("\n")`、维护 `is-empty` 空态；仅在「行被删光 / 结构不规整」时重建并恢复光标 |
| `caretInfo()` | 当前光标 → `{ lineIndex, offset }`（行内字符偏移）；不在编辑区内 / 取不到选区时返回 `null` / `lineIndex: -1` |
| `focusEditor(lineIndex, offset)` | 把光标放到指定行指定字符处（先设 `Range` 再 `el.focus()`）；行内没有文本节点（空行）时落到行末 |
| `onEditorInput()` / `onEditorCompositionStart()` / `onEditorCompositionEnd()` | 输入同步入口 / 输入法组合期间**不重建 DOM**（标记 `_editorComposing`，避免打断中文录入）/ 组合结束后再 `syncEditorDraft()` |
| `onEditorKeydown(ev)` | 回车 → `preventDefault` 并按当前光标位置拆行（新行插入到当前行之后、光标落到新行开头）；`ev.isComposing` / `keyCode === 229`（输入法）时不拦 |
| `onEditorPaste(ev)` | 粘贴只取 `text/plain`（挡住外部 HTML），多行则按换行拆成多行插入到光标处 |
| `onEditorBoxClick(ev)` | 点 `.rt-box` 的内边距等空白处时，把光标放回编辑区末尾（点编辑区内部时交回浏览器默认行为） |
| `groupName(id)` / `groupCountText(id)` / `isGroupActive(id)` | 分组名（找不到回「默认」） / 分组内任务数（**归档与垃圾桶都不计**，与统计口径一致） / 是否为当前选中分组（供侧栏高亮） |
| `setGroup(id)` | 切换选中分组（重算空状态文案 + 保存会话状态） |
| `openAddGroup()` / `openRenameGroup(id)` / `closeGroupDialog()` | 打开「新建分组」弹窗（清空草稿） / 打开「改名」弹窗（预填原名） / 取消关闭（清空草稿与编辑态） |
| `groupMenuTitle(name)` | 分组行 ⋯ 按钮的 `title` 文案（图标按钮无文字，必须给无障碍名称） |
| `isDefaultGroup(id)` | 是否为默认分组（行内菜单的「删除」据此置灰，`requestDeleteGroup` 内部也会再拦一道） |
| `submitGroup()` | 分组弹窗提交入口（回车与按钮都走它）：按 `editingGroupId` 分支新建或保存改名，**成功才关弹窗**并落盘 |
| `archiveDone()` | 「归档已完成」入口：把当前分组范围内**未归档、未删、未在倒计时**的已完成项打上 `archivedAt = now`（一条条改字段，不删数据）；无变化时不写盘 |
| `unarchiveTodo(id)` | 取消归档（`archivedAt = null`），条目回列表与原分组，`done` 与各时间戳保留 |
| `setArchiveGroupMode(mode)` | 切换归档查看方式（只接受 `all` / `day` / `week`，非法值忽略），写会话状态；`day` / `week` 均按完成时刻分组 |
| `completedAt(todo)` | 一条归档项的**完成时刻**：`statusChangedAt`（勾选完成就是最后一次状态变更）→ 回退 `archivedAt` → 都没有则 `null`。归档分组的唯一基准 |
| `dateKey(ts)` / `monthDayText(d)` | 本地日期 key（`YYYY-MM-DD`）/ `MM-DD` 文案；分组 key 一律用它们拼（key 前缀 `d` / `w` 后跟 `YYYY-MM-DD`，**字典序即时间序**，倒序排序即最新在前） |
| `archiveBucket(ts)` | 一个**完成时刻**（由 `completedAt()` 给出）归到哪个分组 → `{ key, label }`：`day` 模式 `key="dYYYY-MM-DD"`、label「10-10 周六」；`week` 模式 `key="wYYYY-MM-DD"`（该周周一）、label「2026 年第 41 周 · 10-05 ~ 10-11」；`ts` 非数字时返回 `{ key:"0-unknown", label:"完成时间未知" }`（排在最后） |
| `isoWeek(ts)` | ISO 周序号：取该周**周四**所在的年份 + `Math.ceil` 出的周数（跨年周不至于算错） |
| `requestDeleteGroup(id)` / `deleteGroup(id)` | 删除分组：前者弹二次确认，后者真正执行（任务移入默认分组并落盘） |
| `updateEmptyText()` | **已删除**（空状态文案已改成 `emptyText` getter，搜索词 / 视图 / 分组一变自动重算） |
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

- **AI 添加 / AI 识别图片**：弹窗内输入 `aiDraft`（和 / 或粘入图片）→ `generateWithAi()`（置 `aiLoading`、清 `aiError`）→ `getAssistant()` 懒加载 `/mz/ai/main.js` 并 `getAssistant()` → **无图**：`assistant.chat({ messages: [系统提示 AI_SYSTEM_PROMPT, 用户描述] })`；**有图**：改传 `AI_IMAGE_SYSTEM_PROMPT`，user 消息的 `content` 换成 `[{type:"text"}, {type:"image_url",image_url:{url:dataUrl}} …]`（多模态，图片用草稿里已压缩的 dataURL）→ `parseAiReply()` 解出 `{ kind, title, desc }`（JSON 优先，失败回退多行文本）→ 回填 `draft` 并提示成功；任何异常（无可用 key、模型报错、解析失败）写进 `aiError` 红字提示，`finally` 复位 `aiLoading`。**AI 只负责生成内容，落盘始终由用户点「添加」走 `submitAdd()`**——保持单一写入路径。模型名 / 推理档位不由应用指定（用宿主当前配置），因此 `chat()` 不传 `model` / `thinking`（`kimi-k3` 传 `thinking` 会报错）。
- **添加**：页面上的「＋ 添加任务」→ `openAdd()`（清空 `draft`、AI 区与图片区、`addOpen = true`）→ 弹窗内 `st-textarea` 输入（可再选图 / 粘图）→ 「添加」按钮调 `submitAdd()` → `parseDraft()` 把多行文本拆成标题 / 描述 → `addTodo()` 返回布尔，**只在成功时**由 `submitAdd()` 关闭弹窗；`addTodo()` 往 `todos` 头部插入带 `createdAt` 与 **`images`（草稿 `slice()` 拷贝）** 的新条目并 `persistTodos()`。
- **图片附件**：两条入图路径——① **选图**：点 `.img-drop`（label）→ 系统选文件 → `input` 的 `change` → `onPickImages()`；② **粘贴**：在弹窗里 Ctrl/⌘+V → `document` 的 `paste` → `handlePaste()`（只在 `addOpen` 时接图，无图时不拦截）。两条路都汇到 `attachImages(files)`：逐张 `compressImage()`（等比缩到最长边 1280px、铺白底、转 JPEG）→ 挂进 `draftImages` → 刷新 `imgNote`。草稿里的图片在点「添加」时随 `addTodo()` 落盘；已保存任务的图片在详情弹窗里用 `removeDetailImage(id)` 删除并立即落盘。
- **查看详情 / 编辑任务（同一个弹窗）**：点任务 `.body`（含其中的缩略图）→ `openDetail(id)`：用 `buildDetail(todo)` 生成只读元信息快照（含 `images`），同时 `fillEditor(text + "\n" + desc)` 把编辑区预填好（无描述时只有标题），然后打开弹窗（弹窗内展示文案均预计算，见踩坑 005）；直接在编辑区里改（`onEditorInput` → `syncEditorDraft()` 实时同步 `editDraft` 与 `is-empty` 空态）→ 「保存」走 `submitEditDetail()`（`parseDraft()` 拆回 `text` / `desc`）写回、落盘并关闭弹窗；「关闭」走 `closeDetail()`，未保存的修改丢弃。
- **启动**：`index.html` 加载 ofa.js / router / st-boot → `o-app` 按 `app-config.js` 载入 `pages/home.html` → 页面工厂里 `load("/nos/storage/main.js")`、`getStorage("conjure-todo-app")` → **`ready()` 是 async，依次 `await loadUi()` / `await loadGroups()` / `await loadTodos()`**（界面偏好与分组都要先就位，列表渲染时才能按宽度排版、显示分组名），最后 `restoreSessionState()` 恢复上次的筛选与分组（它要校验分组是否存在，所以必须排在 `loadGroups()` 之后）→ **挂上 `document` 级的 `paste` 监听（图片粘贴）** → 渲染 `o-fill`。
- **会话状态**：`setGroup()` / `setView()` / `deleteGroup()` 末尾调 `saveSessionState()` 写 `sessionStorage`；启动时 `restoreSessionState()` 读回并校验（`view` 只接受 `"all"` / `"archived"` / `"trash"`——**旧会话里存的 `active` / `done` 会被忽略并回落到「全部」**；已不存在的分组回落为 `"all"`；`archiveGroup` 只接受 `"all"` / `"day"` / `"week"`，非法 / 缺失均为「全部归档」）。
- **归档**：`archiveDone()`（右上「归档已完成」按钮）只把**当前分组范围**内已完成的条目打上 `archivedAt`（一条条改字段、不删数据），于是它们同时从 `activeTodos` / 分组计数 / 统计里消失，只出现在「已归档」视图（`archivedTodos`）；`unarchiveTodo(id)` 清 `archivedAt` 让条目回列表（`done` 与各时间戳不变）；从垃圾桶还原时 `restoreTodo()` 一并清 `archivedAt`。
- **归档查看方式**：子标签 `on:click="setArchiveGroupMode('day')"` → 只改 `archiveGroupMode`（`archiveGroups` 随之重算、写会话状态），不动任何数据；分组 key 由 `archiveBucket(completedAt(todo))` 得出——`completedAt()` 首选 `statusChangedAt`（完成时刻）、缺失回退 `archivedAt`，所以取消归档 / 删除归档项后组内条数即时重算。
- **侧栏宽度**：`startResize(ev)` 记下起始 `sideWidth`，`pointermove` 时写 `sideWidth = clampSideWidth(...)`（驱动侧栏宽度与手柄位置，任务区按 `1fr` 自动变宽 / 变窄），`pointerup` / `pointercancel` 移除监听、置 `resizing = false` 并 `saveUi()` 落盘。
- **分组**：`loadGroups()` / `persistGroups()` 读写 `groups` 键；`setGroup(id)` 切侧栏选中项并重算空状态；新建走 `openAddGroup()` → 弹窗输入 → `submitGroup()`，改名走行内菜单「重命名」→ `openRenameGroup(id)` → 同一个 `submitGroup()`（看 `editingGroupId` 分支），两者成功后都关弹窗并 `persistGroups()`；删除走行内菜单「删除」→ `requestDeleteGroup(id)` → `confirmAction()` → `deleteGroup()`（任务 `groupId` 改回 `default`、若正在浏览该分组则回到 `all`）。
- **改动数据**：`addTodo` / `toggleTodo` / `togglePin` / `archiveDone` / `unarchiveTodo` / `restoreTodo` / `commitDragDrop` / `confirmAction` / `deleteGroup` 都会重建 `this.todos` 后调 `persistTodos()` 写回存储；模板由 ofa 响应式更新。`startPendingDelete` / `cancelPendingDelete` / 倒计时到点也会落盘（`pendingDeleteAt` 不跨刷新恢复，但 `deletedAt` 会）。
- **拖拽排序**：按住某行手柄 `pointerdown` → `startDrag(ev, id)` 置 `draggingId` 并把 `pointermove` / `pointerup` / `pointercancel` 挂到 `window`；每次 `pointermove` 调 `dragDropPosition(clientY, 手柄元素)` 算出落点（显示序插入下标 + 夹回同类区间），**只更新 `dropBeforeId` / `dropAfterId`（行边缘的指示线）并把下标存进闭包**——`todos` 在整个拖动过程中不变；`pointerup` / `pointercancel` 时移除监听、清掉落点提示，**真的移动过才** 调 `commitDragDrop(id, insertIdx)`（在 `listTodos` 上 splice 提出来、插回去、写回槽位、`persistTodos()`）；落点即原位则只打日志、不动数据。
- **置顶 / 取消置顶**：行尾置顶按钮 `on:click="$host.togglePin($data.id)"` → `togglePin()`：置顶时把该条挪到 `todos` 头部并写 `pinnedAt = now`（于是它成为置顶区最上面一条），取消置顶只清 `pinnedAt`（它留在数组头部 → 成为普通区最前一条）→ `persistTodos()`；列表视图的显示序由 `listTodos` 重算，行上的 `.item.pinned` 竖条与按钮图标 / `title` 随 `$data.pinnedAt` 响应式更新。
- **筛选与搜索**：`setView(value)` / `setGroup(id)` 只改 `view` / `groupFilter`（空状态文案由 `emptyText` getter 自动重算）；搜索框 `sync:value="searchText"` → `searchKeyword`（trim + 小写）→ `searched*` 系列 getter → `visibleTodos` / `archiveGroups` → 列表重渲染；清除按钮走 `clearSearch()`。搜索**不写存储、不写会话状态**，也不改 `todos` 里的任何字段。三个视图的数据源都过 `scopeByGroup()`，所以**切换分组会同时改变三个视图的内容**（列表、归档、垃圾桶的计数 / 徒标 / 底栏 / 空状态都跟着变）。
- **删除倒计时（核心机制）**：`handleDeleteClick(id)` 判分支——无 `pendingDeleteAt` 则 `startPendingDelete`（写入 `pendingDeleteAt`、写一次 `nowTick`、`startTicker()`），已有则 `cancelPendingDelete`（置 `null`）。`startTicker()` 用自终止的 `setTimeout` 链（`_tickId`，步长 `TICK_MS`）：每步写 `nowTick` 驱动界面刷新剩余秒数，把 `now - pendingDeleteAt >= TRASH_DELAY_MS` 的条目改为 `deletedAt = Date.now()` 并落盘；**没有倒计时条目时不再调度下一步**，不会留下常驻定时器。
- **彻底删除 / 删除分组**：`purgeTodo(id)` / `emptyTrash()` / `requestDeleteGroup(id)` 都只设置 `confirmKind` + 目标（`purgeTarget` 或 `confirmGroupId`）与确认文案、打开 `st-dialog`（此阶段不删任何东西）；只有 `confirmAction()` 才真正执行并落盘，`closeConfirm()` 则取消。
- **时间记录**：`addTodo` 写入 `createdAt`；`toggleTodo` 每次切换写入 `statusChangedAt`；两者都随 `persistTodos()` 落盘。

**核心链路（实测清单，功能演进时同步扩充）**（①–㉑ 为主线流程；【任务详情编辑】【行尾操作区尺寸与观感】【归档链路】【拖拽排序】【置顶】【图片附件】是后加功能的专题链路，未重排编号）：① 打开应用渲染列表与计数；② 点「添加任务」按钮弹窗（空输入时「添加」禁用）→ 多行输入提交后标题 / 描述分别正确、弹窗关闭、草稿清空；点「取消」关掉不新增，重开弹窗草稿为空；③ 勾选/取消勾选（删除线 + 计数变化 + 副标题出现「完成于/恢复于 …」）；④ 三个视图（全部 / 已归档 / 垃圾桶）切换与空状态文案；⑤ 点删除按钮（关闭图标）后 5 秒倒计时（逐秒递减、pending 样式、图标变 `mdi:reply`）→ 自动进垃圾桶；⑥ 倒计时中点同一按钮（撤销图标）撤销（条目保留、不再倒计时）；⑦ 垃圾桶视图还原（回列表且不影响计数，如果它之前被归档过也会正确回到列表）；⑧ 彻底删除单条（弹框 → 取消不删 → 确认才删）；⑨ 清空垃圾桶（空时按钮禁用，弹框带条数，取消/确认均正确）；⑩ 进垃圾桶后硬刷新仍在（`deletedAt` 持久化）；⑪ （旧功能「清除已完成」已改为「归档已完成」，见后面的【归档链路】）；⑫ 重开后数据仍在；⑬ 长列表（含多行描述）可滚到底；⑭ 每条任务显示创建时间，状态变更后时间实时更新，旧数据显示「创建时间未知」；⑮ 点任务正文区打开「任务详情」弹窗（标题 / 描述已预填在**可直接编辑**的输入框里，状态 / 分组 / 四个时间正确），点勾选框不会误开详情；⑯ 详情弹窗底部是「关闭」+「保存」：点「关闭」关闭弹窗且不保存（列表内、归档内与垃圾桶内的条目都一样），点「保存」写回并关闭弹窗；【任务详情编辑】列表行**已无铅笔按钮**（实测 `.edit-btn` 数量 0、每个 `.item-actions` 只剩 1 个按钮）→ 点正文打开弹窗，headline 为「任务详情」，**编辑区是 `.rt-editor[contenteditable]` 多行区**（不是 textarea，框内也没有下方的预览行——实测 `.edit-preview` 数量 0）；弹窗面板实测 **760px** 宽（`.dialog-lg::part(panel)`）、编辑区盒子 720×154、内部 `.rt-editor` 最小高 126px；打开时预填 `写周报 / 本周总结 / 下周计划` 三行，**所有行样式完全一致**（实测每行 `400/14px`、`.rt-title` 数量 **0**），同屏还能看到只读元信息（分组 / 状态 / 创建时间…）；**空态**：全部清空 → 编辑区带 `is-empty`（占位提示可见）、**自动保留一个可编辑空行**、「保存」置灰；**回车**：光标放在首行第 3 个字符处敲回车（真实 `keydown`）→ 拆成 3 行且光标落在新行开头；**点 `.rt-box` 空白处** → 光标回到最后一行末尾（可继续真实输入）；点「保存」→ 弹窗关闭、列表标题与描述拆解正确、存储 `text` / `desc` 同样正确（旧标题不残留）；重开弹窗预填回原内容；把内容改成「不该保存」后点「关闭」→ 弹窗关闭、列表值不变、描述也未被清掉（未保存的修改丢弃）；勾选完成后再进详情改成单行「标题甲（终）」保存 → 完成状态、分组、创建 / 完成时间戳均不变，描述行从列表消失（`.desc` 计算值 `display:none`）；归档行与垃圾桶行的详情同样可看可改（归档行只剩「取消归档」+ 删除按钮，垃圾桶行只剩「还原」+ 彻底删除）；硬刷新后修改仍在、行上仍无编辑按钮；【行尾操作区尺寸与观感】`.item-actions` 内两个按钮实测 34.3×34.3（图标 18.9×18.9），操作区总宽 70.6（原 92），与 `.body` 垂直居中对齐（无描述行 30/30、有描述行 40/40）；编辑按钮常态 `opacity 0.7`、删除按钮 1；倒计时行的两个按钮图标颜色变 `rgb(255,180,171)`（on-error-container）且编辑按钮恢复不透明；点铅笔仍能正常进入「编辑任务」弹窗（回归通过）。【归档链路】点**右上**的「归档已完成」（无已完成项时置灰；三个视图下均可见）→ 已完成条目从列表消失、`已归档 N` 徒标出现、统计与侧栏分组计数同步减少、「归档已完成」马上变禁用态；切到「已归档」→ 顶部有说明行、条目带归档图标与「完成于 … · 创建于 …」副标题（不再显示归档时间，归档时刻点详情可见）、底部显示「已归档 N 项」；点正文开详情 → 状态「已归档（已完成）」且「归档时间」有值（未归档条目为 `—`）；点「取消归档」→ 回到列表与原分组（勾选状态保留）、徒标个数回落；在归档视图点删除 → 5 秒倒计时 → 进垃圾桶 → 在垃圾桶点「还原」→ 回到**列表**（而不是回归档箱，`archivedAt` 已清）；在某个分组下点「归档已完成」只归档该分组的已完成项，其它分组不受影响；硬刷新后归档状态与视图仍保持；【归档分组】归档视图内的子标签默认「全部归档」（选中态 `variant=filled`）且**无日期组头**（`.agroup-head` 计算值为 `display:none`）、条目平铺，条目副标题只显示「完成于 … · 创建于 …」（不含归档时间）；点「按完成日」→ 按任务的**完成时刻**聚类（用例里 4 条全是「今天归档」但完成时间跨 3 天 → 成 3 组，组头「今天 / 昨天 / 9 天前」+「2 项 / 1 项 / 1 项」、最新的排最前、组内顺序不变——**旧版按归档日期分组时这 4 条会全归到一天**，可以此区分两种语义）；点「按完成周」→ 同周完成的合成一组、组头「2026 年第 41 周 · 10-05 ~ 10-11」+「N 项」；切换后 `sessionStorage` 写入 `archiveGroup`，**硬刷新后仍停在「按完成周」且周分组照旧**。⑰ 分组（左栏）：点「新建分组」按钮 → 弹窗（空时「创建」禁用、输入后启用）→ 提交后侧栏出现新项并关弹窗（重名自动加序号）；点分组行右侧 ⋯ → 菜单弹出「重命名 / 删除」（默认分组的「删除」置灰）→「重命名」打开弹窗（标题「改名分组：「xxx」」、预填原名、按钮为「保存」），**且当前选中的分组不变（不因点行内按钮而切分组）**，「取消」不改名、提交后侧栏同步新名；「删除」→ 二次确认（标题 / 文案 / 条数正确）→ 确认后分组消失、列表回到「全部任务」；点分组名即选中高亮且只看该分组；在分组下添加的任务归入该分组（元信息与弹窗提示均正确），“全部任务”下添加则归默认；改名同步到侧栏与列表元信息；删除需二次确认（取消不删；确认后组内任务移入默认并落盘）；「默认」的「删除」置灰（点了无反应）、「全部任务」行没有行内菜单；底部统计随分组变化；「归档已完成」只归档当前分组范围；刷新后分组与归属仍正确；⑱ 侧栏宽度：在侧栏右边缘拖拽手柄（拖动 300→220px），松手后侧栏变窄、**任务区同步变宽（828→908px，吃满剩余宽度、右侧无多余空白）**、存储 `ui.sideWidth` 写入 220，硬刷新后宽度保持；⑲ AI 添加：打开添加弹窗 → 描述框为空时「AI 生成」禁用 → 输入一句话后点「AI 生成」（按钮变「AI 生成中…」并禁用）→ 成功后标题 / 描述回填到上方输入框且提示「AI 已生成…」→ 点「添加」后列表里的标题与描述分别是模型给的 title / desc（描述多行正确保留）→ 关弹窗重开，AI 区字段全部清空；AI 失败时弹窗内红字提示且不丢用户输入；⑳ 会话状态：在非默认分组（如「个人」）下刷新 → 仍是该分组；再切「已完成」刷新 → 分组与视图都保留、空状态文案正确；把 `sessionStorage` 里的 `groupFilter` 改成不存在的 id、`view` 改成 `trash` → 刷新后分组回落「全部任务」、视图仍为垃圾桶；清掉 `sessionStorage` 刷新 → 回到「全部任务」+「全部」；刷新过程无应用报错（装了 `error` / `unhandledrejection` 记录器验证）；㉑ 分组行点击区与对齐：四行（全部任务 / 默认 / 个人 / LINLEE）**行高均为 42px**、`.gname` 高 42px（与行等高等宽，即整行左半都是点击区），四处 `.gcount` 的 `right` **都在 269**（计数右边缘对齐，「全部任务」不再向右突出）；点行名切分组、点计数也切分组、点 ⋯ 按钮**不切分组**且菜单正常弹出 / 收起（关闭后菜单项宽回 0、无弹窗残留）；刷新后用户原有数据与侧栏宽度偏好不变（实测后将 `sessionStorage` 会话状态清空）。【拖拽排序】列表每行首位有 `mdi:drag-vertical` 手柄（实测 24×28、图标 20px、`opacity 0.45`、`touch-action: none`、`title`「按住拖动调整顺序：xxx」）；向手柄派发 `pointerdown` → 行变 `.item.dragging`（位置不动）/ `.shell` 变 `shell dragging`，此时**顺序未变、无落点提示**；向 `window` 派发 `pointermove` 到目标行 → **落点提示是目标行的边缘线**（实测：指针在第 2 行上半 → `class` 为 `item drop-before`，`::after` 计算值 `top -5px` / `height 2px` / 颜色主题色 `rgb(159,202,255)`、`::before` 9×9 圆点；指针在末行下半 → `drop-after`，线贴在该行下边缘），两行之间 8px 缝隙中线正落在行间距中点（行底 219 / 行顶 227，线在 222~224），而**拖动过程中列表顺序完全不变**；`pointerup` 后提示类全部消失、日志 `[drag] 已放下，xxx 移到第 N 位` + `[storage] 已保存待办`、顺序才互换；**硬刷新后新顺序仍在**；把被拖行拖回原位 → `[drag] 落点仍是原位，顺序不变`、不写盘；点手柄 / 拖手柄都**不会**误开详情弹窗；控制台无应用报错。【归档桶跟随分组】左栏选中某分组后：「已归档」「垃圾桶」两个视图只列该分组的条目（实测选「个人」时分组的垃圾项目在筛选内外都不出现，切换回「全部任务」才看到），切分组时视图标签数量 / 底栏计数 / 空状态文案同步变化（实测「工作」下垃圾桶 0 项、置灰「清空垃圾桶」且空状态为「「工作」的垃圾桶是空的」；「默认」下垃圾桶 1 项、按钮可用；「全部任务」下为全量 1 项）；「清空垃圾桶」在选中分组时只清该分组范围，确认框标题为「清空「默认」的垃圾桶？」、文案说明范围与条数，确认后其它分组的垃圾桶条目不受影响。【图片附件】添加弹窗里有选图区（`.img-drop` 文案「点击选择图片，或直接粘贴」）与隐藏的 `input.img-input[type=file][accept=image/*][multiple]`；**在弹窗里派发带 `clipboardData`（含一张 PNG file）的 `paste` 事件** → 缩略图出现（实测 64×64、移除按钮 20×20、`src` 是 `data:image/jpeg;base64,…`、提示「已添加 1 张图片（最多 4 张）」）；同时 AI 按钮从「AI 生成」变成 **「AI 识别图片」** 且不再因描述为空而禁用；通过 file input 再加 2 张（共 3 张）→ 点缩略图右上角移除一张 → 剩 2 张、提示同步为「2 张」；粘贴 6 张 → **只收 4 张**并提示「有 2 张未能加入」（`MAX_IMAGES` 生效）；点「添加」后任务落到列表：**行内显示 2 张 40px 缩略图**（`.thumb-sm`，`src` 同为 `data:image/jpeg`）、统计不变；**硬刷新后 2 张图仍在**（存储里 `images.length === 2` 且 `dataUrl` 以 `data:image/` 开头）；点正文开详情 → **2 张大图**（`.dimg img`，`max-height` 220px）→ 点大图右上角移除一张 → 详情剩 1 张、**列表缩略图同步降到 1 张**、存储里也只剩 1 张（立即落盘）；**AI 识图实测**（本地生成一张写有「1. 买牛奶 / 2. 给妈妈打电话 / 3. 交水电费」的 PNG 粘入弹窗 → 点「AI 识别图片」）→ 回填标题「买牛奶、给妈妈打电话、交水电费」+ 描述逐条列出，提示「已从图片文字里提取任务…（图片会一起附上）」；换成一张纯色渐变 + 红圆的抽象图 → 提示「图片里没有可提取的文字，已作为图片附件带入」，标题为模型给的一句短语（实测「蓝黄渐变背景上的红圆」），**图片仍随任务保存**。归档 / 垃圾桶行的 `.body` 也带 `.thumbs` 块（结构一致，`class:hidden="!$data.images.length"` 控显隐）。【置顶】列表行行尾有两个图标按钮（置顶 `mdi:pin-outline` / 删除 `mdi:close`，各 34.3×34.3）；点置顶 → 该行跳到**列表最前**、`class` 多出 `pinned`、语义竖条为 `rgb(159,202,255) 3px 0px 0px 0px inset`（主题色）、图标变 `mdi:pin` 且颜色变主题色、title 变「取消置顶」；再置顶另一条 → 它排到置顶区最前（3 条置顶 + 1 条普通的实测顺序 `C,B,D,A`），置顶区内可用拖拽调整先后（`C` 与 `B` 互换都正常）；**跨区拖拽被夹回同类区间**：拖置顶项到普通项上时，落点线出现在**置顶行自己的下边缘**（`item pinned dragging drop-after`）、普通行上没有任何 `drop-*` 类，松手后该条仍在置顶区（顺序 `B,C,D,A`，置顶项数仍为 2）；拖普通项到置顶区上时，落点线夹到**普通区第一行**（`drop-before` 在 D 上）、松手后普通项只在自己区内换位（`B,C,A,D`）且不会被置顶；点已置顶项的按钮 → 取消置顶（`pinned` 类消失、落到普通区最前 `C,B,A,D`）；硬刷新后置顶项（`C`）仍在最前、顺序与置顶数保持；控制台无应用报错。

## 场景测试（`client/test/*.test.json`）

用宿主 preview 工具的 `action=run-tests` 跑（**新增 / 修改重要功能后必须跑到全绿**）；用例本身随功能一起维护。13 个用例一文件一主流程，文件名即功能名（注：本机宿主会忽略 `files` 参数跑全套，报告里随机一条 reload 后超时 / 断言失败属已知抖动，重跑即绿）：

| 文件 | name | 覆盖内容 |
| ---- | ---- | -------- |
| `add-task.test.json` | 添加任务 | 多行输入解析标题/描述、空输入与 AI 描述为空时禁用、取消不新增且重开草稿为空、统计与侧栏计数、**添加弹窗面板已放大（`.dialog-lg`，面板 ≥700px、输入框 `min-height` ≥140px）**、刷新持久化 |
| `delete-trash.test.json` | 删除倒计时 | pending 样式 / 逐秒文案 / 图标 `mdi:reply` / 仍计入统计、再点撤销、到点进垃圾桶、垃圾桶还原回列表、刷新落盘 |
| `drag-order.test.json` | 拖拽排序 | 落点语义（某行上半区插到该行之前、末行下半区追加末尾）、拖动中只给提示且顺序不变、松手才换位、原位不写盘、刷新保持 |
| `pin-top.test.json` | 置顶与拖拽约束 | 行尾可置顶（排到最前、`.item.pinned` 竖条、图标 `mdi:pin` / title「取消置顶」）、多个置顶项之间可换位、**跨区拖拽时落点线被夹回同类区间且松手不换区**、普通项只能在普通区内换位且不会变成置顶项、取消置顶落到普通区最前、刷新后置顶状态与顺序落盘 |
| `edit-task.test.json` | 任务详情编辑 | 行上无铅笔按钮、点正文打开「任务详情」（**面板已放大 ≥700px**、编辑区是 **contenteditable 多行区**、预填首行标题 + 描述、只读元信息同屏、无框下预览行）、**编辑区不做任何行级样式（每行均 400/14px，`.rt-title` 数量为 0；首行加粗加大那套已去掉）**、空态保留可编辑空行并禁用保存、回车自己拆行且光标落在新行、点盒子空白回编辑区、保存拆回 text / desc 并关闭弹窗、关闭丢弃未保存修改、不改完成状态与分组与时间戳、描述可删空、刷新落盘 |
| `group-crud.test.json` | 分组管理 | 新建（空输入禁用、计数）、切换与任务归属、改名（预填原名、同步元信息）、删除二次确认且任务移入默认、默认分组删除置灰、刷新持久化 |
| `session-state.test.json` | 会话状态 | 切分组 / 切视图写入 `sessionStorage` 且刷新保留、非法分组回落「全部任务」、非法视图回落、清空后回默认 |
| `toggle-archive.test.json` | 归档链路 | 勾选完成/恢复、归档已完成只收当前分组范围、已归档视图与详情状态、取消归档回列表、归档项删除后从垃圾桶还原回列表、刷新持久化 |
| `trash-purge.test.json` | 垃圾桶清理 | 彻底删除二次确认（取消不删 / 确认才删）、清空垃圾桶（条数提示 / 取消 / 确认 / 空时禁用）、刷新落盘 |
| `archive-group.test.json` | 归档分组 | 说明行是一行短文案 + `st-tooltip`（完整说明在 content 里）且带「?」图标；默认「全部归档」无组头且条目副标题含「完成于」、**不含「归档于」**（归档时间只在详情里）、**按完成时间**分组（4 条同为今天归档、完成跨 3 天 → 3 组；组头带日期星期与条数 / 最新在前 / 组内顺序不变 / 「昨天」条的完成与归档时间对得上）、按完成周分组（组头含年·周·起止 / 总条数不变）、查看方式写 `sessionStorage` 并刷新保持 |
| `detail-done-at.test.json` | 修改完成时间 | 详情弹窗里已完成任务显示可编辑「完成时间」行（预填 `statusChangedAt`）、修改后立即写回存储与列表副标题、未完成 / 垃圾桶任务不显示该行、已归档任务同样可改并落盘、**清空输入框不会丢掉原完成时间（保留原值并回显）**、**老数据（已完成但无时间戳）显示“原数据未记录、可在此补填”且补填能落盘** |
| `image-attach.test.json` | 图片附件 | 添加弹窗选图 / 直接粘贴（canvas 压缩成 `data:image/jpeg` 的 64px 缩略图、可移除、上限 4 张）、有图时 AI 按钮变「AI 识别图片」且不靠文本即可点、任务落盘后列表显示 40px 缩略图、详情弹窗显示大图并可移除（立即落盘）、刷新后图片仍在 |
| `group-scope-views.test.json` | 归档桶跟随分组 | 左栏选中分组后「已归档」「垃圾桶」只显示该分组条目（选「全部任务」才是全部）、视图标签数量 / 底栏计数 / 空状态文案同步跟随；「清空垃圾桶」只清当前分组范围（确认框标题带分组名），不动其它分组 |
| `search-task.test.json` | 搜索任务 | 搜索框在筛选按钮同一行最右侧且是小尺寸（190px）；按标题 / 按描述 / 忽略大小写匹配；命中数提示与清除按钮的显隐；搜索时拖拽手柄隐藏、统计不受影响；无匹配的空状态文案；已归档与垃圾桶视图内搜索均生效且不改底栏计数 / 标签数量；刷新后搜索词不保留 |

### 用例写法约定（本项目）

- **`name` 用 ≤12 字的短功能名**，细节写进 `desc`；一文件一主流程。
- **用例跑在隔离数据空间，永不碰用户真实数据（硬性）**：wipe 第一步除了置脏标记，还要往 `sessionStorage.__todo_store_id` 写 `{ id: "conjure-todo-app-test", exp: Date.now() + 600000 }`（应用启动时据此切空间，见「数据模型 → 持久化」），随后的 `reload` 让应用改读这个空间；收尾的 eval 除了还原备份，还要 `sessionStorage.removeItem('__todo_store_id')` 把应用切回正式空间。**用例里所有直接读写存储的步骤（含 crafted 数据）也必须用 `conjure-todo-app-test`**。之所以这么做：以前用例直接清空 / 覆写正式空间、只靠 `localStorage` 备份回滚，一旦宿主并行跑多个用例，备份链会被互相覆盖（本项目真丢过用户数据，见 `pitfalls/023`）。
- **第一步 wipe、最后一步 restore**：第一条 eval 定义 `T.wipe()`（转入隔离空间、并把该空间的 `todos` / `groups` / `ui` 备份到 `localStorage.__todo_test_backup_v1`、置 `__todo_test_dirty = "1"`，再清空该空间与 `sessionStorage` 的会话状态）后调用，接着 `reload`；收尾的 eval 还原备份并清 dirty 标记。**wipe 开头会自愈上一次中断遗留的脏数据**。
- **辅助函数只定义一次、挂在共享上下文 `T` 上**（`T.q` / `T.tx` / `T.click` / `T.byText` / `T.btn` / `T.dlg` / `T.dlgBtn` / `T.items` / `T.need` / `T.setVal` / `T.addTask` / `T.toggle` / `T.del` / `T.view` / `T.pickGroup` / `T.groupAction` / `T.drag` …，`T.NL = String.fromCharCode(10)`）。**后续步骤不要重复定义**，直接用 `T.xxx(...)`。
- **`reload` 之后 `T` 随页面重置**：reload 之后的步骤一律用 `document.querySelector('o-page').shadowRoot` 直查元素（helper-free），不再依赖 `T`。
- **断言写在 eval 里**（抛错即失败），只保留 `expect.consoleErrors: 0` 交给宿主；**不要用 `expect.count` 数 `.item`**——宿主深查（`$`）会穿进 `st-menu` 等组件 shadow 命中同名 `.item`（踩坑 014）。
- **交互统一走 T 的辅助函数**：`st-button` 必须点到内部原生 button（踩坑 008），所以不用原始 `click` 步骤、也不写裸 `document.click()`；选择器都限定在页面 shadowRoot 内。
- **行内按钮一律用语义选择器，禁止用下标（`...[1]`）选，也不依赖“这个位置只有一个按钮”的假定**：本轮给行尾操作区加了一个置顶按钮，四个用例里 `T.del` 写的 `T.need(t).querySelector('.item-actions st-icon-button')`（首个匹配就是删除）立刻变成了点置顶按钮（不报错、行为错），edit-task 的 `length !== 1` 断言也挂了。统一写 `Array.from(row.querySelectorAll('.item-actions st-icon-button')).find((x) => (x.getAttribute('title') || '').indexOf('删除') !== -1)` 这类**按 `title` / 文案挑**的写法（见 `pitfalls/025`）。
- **断言不要写死元素结构 / 整块值**：编辑区从「两框」合并成「一个多行框」、后来再换成 contenteditable 富文本区，每换一次就有一个用例的旧断言挂掉（归档链路里 `tb.value !== '任务A'` 那条因该任务带描述而不成立）。规则：**断言只看语义，不看元素类型与整块文本**——编辑区首行就写 `ed.children[0].textContent.trim()`，要多行文本就 `Array.from(ed.children).map(...)`，不要用 `value` / `innerText` 的全等比较；需要「只有一行」的数据就自己构造（`T.addTask(t)` 不传第二参）。同源教训见 `pitfalls/025`。
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
| 023 | 测试直接清空 / 覆写正式数据空间 + 共享一个备份键 → 并行跑用例时把用户数据冲掉（改用隔离空间） | `pitfalls/023-场景测试必须跑在隔离数据空间.md` |
| 024 | `st-tooltip` 的三个要点：`pointerenter` 不冒泡（事件要派发到宿主）、气泡尺寸全用 em（靠宿主 font-size 缩放）、后台标签页验不了悬停 / 聚焦 | `pitfalls/024-st-tooltip-trigger-and-em-sizing.md` |
| 025 | 用例里的脆弱假定：用下标取行内按钮 / 依赖“这个容器里只有一个按钮”（UI 增删一个按钮就静默错位）、断言写死多行框的整块 `value` | `pitfalls/025-test-selector-by-index-breaks.md` |
| 026 | 自建 contenteditable 编辑区的四个坑：选区注入顺序、空态不能隐藏行、普通打字不要重建 DOM、行样式只能用 class 表达（本项目已据此**整体移除行级样式**） | `pitfalls/026-contenteditable-editor-traps.md` |
| 027 | `input[type=datetime-local]` 的值不能用 `attr:value` 绑定：value 被 JS 改过后 attribute 不再同步到 property，换一条数据打开会残留上一个值 | `pitfalls/027-input-value-attr-binding-stale.md` |
