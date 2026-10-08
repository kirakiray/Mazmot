# MEMORY.md — 待办清单（todo）

项目记忆体：每回合**有改动**就在下方顶部追加一条（日期 / 改了什么 / 为什么 / 验证结论），最新在最上；纯讨论不记。容量上限 50 条：满 50 先把最旧 20 条压缩成 3–4 条（只留仍生效的决策与约束、用户偏好、未解决待办）。完整规则见 AGENTS.md「记忆体规则」。

## 记录

### 2026-10-08 · 编辑按钮的 emoji 换成 NoneOS Core 的 n-icon

- **改了什么**：`pages/home.html`——引入 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`；分组行编辑按钮内容由 `✏️` 改为 `<n-icon icon="mdi:pencil"></n-icon>`；CSS 删掉原先给 `n-icon` 写的 `width/height: 1.571em`，只保留 `display: inline-flex`（尺寸/颜色交给 `st-icon-button` 的 `::slotted` 规则）。
- **为什么**：用户要求“你看看 noneos-core 的 n-icon，改了那个 emoji 的编辑按钮”——emoji 在不同平台字形/字号不一致且不受主题色控制，Iconify 图标能继承 `currentColor`。
- **验证结论**（预览实测）：`/nos/n-icon/n-icon.html` 可加载（等价于 `core.noneos.com` 源，fetch 200）；`n-icon` 实测 18.9×18.9（按钮 34.3×34.3，`inside_btn: true`）、内部 svg 已渲染（`mdi:pencil` 的 path）、`color` 与按钮 `computedStyle.color` 完全一致；页面里已无 `✏️` 残留；点该按钮 → 日志 `[group] 打开改名弹窗 default 默认`、弹窗标题「改名分组：「默认」」且预填，**点击前后 active 分组未变**；取消后无弹窗残留；硬刷新后图标 ~100ms 出图（IndexedDB 缓存 `getStorage("n-icon")`），无未捕获错误。
- **踩到的坑（已沉淀 `pitfalls/009`）**：最初按“图标 1.571em”给 `n-icon` 写了 `width/height: 1.571em`，结果图标变成 **30px**（`1.571 × n-icon 自身 18.85px 字号`，两层 em 相乘），撑得按钮很挤——正确做法是**什么都不设**，让它吃 `st-icon-button` 自带的 `::slotted { font-size: 1.571em }`。
- **遗留**：页内其它图标仍是 emoji（标题 ✅、「＋ 添加任务 / 新建分组」的 ＋、删除 ✕/↩、垃圾桶 🗑）；用户本次只要求改编辑按钮，若后续要求统一，需一并替换并保留 `title` 无障碍名称。

### 2026-10-08 · 行内 ✏️ 换成「⋯」下拉菜单（重命名 + 删除），并改成悬停 / 选中时显现（用户说“都换了”）

- **改了什么**：`pages/home.html`——分组行右侧的单个编辑按钮换成 **`st-menu` 下拉菜单**：trigger 为 `st-icon-button.gmenu`（图标 `<n-icon icon="mdi:dots-horizontal">`），菜单项「重命名」→ `openRenameGroup($data.id)`、「删除」→ `requestDeleteGroup($data.id)`（`attr:disabled="$host.isDefaultGroup($data.id)"` 让默认分组的删除置灰）；新增 `mdi` 依赖 `<l-m src="/gh/ofajs/senti-ui@latest/packages/menu/menu.html">`；**删掉侧栏底部的 `.side-actions`（改名/删除按钮块）与其 CSS、去掉 `canModifyGroup` getter**（删除已收进行内菜单）；`renameGroupTitle(name)` → `groupMenuTitle(name)`，新增 `isDefaultGroup(id)`；CSS：`.gitem st-menu { flex: none }`、`.gitem .gmenu { font-size: 12px; opacity: 0; transition: opacity .15s }` + `.gitem:hover/.active/:focus-within .gmenu { opacity: 1 }` + `@media (hover: none) { opacity: 1 }`。
- **为什么**：上一回合我把一个单功能按钮直接摆在行上，用户答复“都换了”（即接受我提的两条：平时隐藏、换成 ⋯ 菜单里放改名 + 删除）。
- **验证结论**（预览实测）：菜单渲染正常（默认行两个菜单项，默认分组的「删除」`disabled: true`、临时分组为 `false`）；点 trigger → 面板打开（菜单项 rect 90×37@108,187，而关闭态为 0×0，不会占用行内布局）；点「重命名」→ 弹窗标题「改名分组：「默认」」、预填「默认」、按钮「取消 / 保存」，**点击前后选中分组未变**；点「删除」（临时组「菜单测试组」）→ 二次确认「删除分组「菜单测试组」？」→ 确认后分组消失、列表回到「全部任务」；尺寸：按钮 34.3×34.3、n-icon 18.9×18.9（全部在按钮内）、颜色 `rgb(195,198,207)` 继承 currentColor；遗留引用检查：`canModifyGroup` / `side-actions` / `renameGroupTitle` / `gedit` 均已不在页面中；最终数据只剩「默认」分组 + 用户原任务 `111111`，硬刷新一致，控制台无应用报错。
- **无法实测的点**：`.gitem:hover` 的悬停淡入**量不到**——预览标签页在后台，浏览器不更新指针 hover 状态（`computedStyle.opacity` 始终 0，即使面板已开）。旁证：选择器路径通（`font-size: 12px` 已生效→ 按钮 34.3px），触屏有 `@media (hover: none)` 兜底；**需用户在前台用鼠标确认**，已沉淀 `pitfalls/010`。
- **文档**：CONTEXT（使用指南左栏 1–3 重排、右栏重编号为 4–10、getter/方法表、页面骨架、关键流程、核心链路 ⑰）已同步；新增 `pitfalls/010`（st-menu 自测陷阱）并登记索引；顺手把 AGENTS.md 引用了但仓库里缺失的 `pitfalls/009`（n-icon 在 st-icon-button 里的尺寸规则）补成真实文件。
- **发现并纠正的文档/代码漂移**：本回合读文件时发现页面里的行内按钮已被改成 `n-icon`（`mdi:pencil`）而 MEMORY 里没记录（上一回合落盘后的后续改动），本次已一并核对并写进文档（图标统一用 `n-icon`、不要给它写 width/height）。

### 2026-10-08 · （已被同日上一条取代：行内按钮后来换成了 ⋯ 菜单）分组行右侧加 ✏️ 编辑按钮，底部只留「删除分组」

- **改了什么**：`pages/home.html`——`o-fill` 的分组行结构改为 `.gname` + `.gcount` + **`st-icon-button.gedit`（✏️）**；**分组行的 `on:click` 从整行 `.gitem` 移到 `.gname` 上**（「全部任务」行同样处理），这样点 ✏️ 不会顺带切分组（不依赖 `stopPropagation`）；底部 `.side-actions` 删掉「改名」按钮，只留「删除分组」；新增 proto 方法 `renameGroupTitle(name)` 给 ✏️ 提供 `title`（图标按钮必须有无障碍名称）；CSS：`.gitem` 改 `padding: 4px 4px 4px 10px` + 不再整行 `cursor: pointer`（改由 `.gname` 承担），新增 `.gitem .gedit { flex: none; font-size: 12px }`（em 尺寸等比缩到 34px）。
- **为什么**：用户要求“在左侧 item 上，右侧地方添加一个 edit button，点击后 dialog 修改分组名”。
- **设计决策**：只给真实分组加 ✏️（「全部任务」是虚拟项，无名字可改）；改名弹窗/方法完全复用上一轮的 `openRenameGroup(id)` + `groupDialogOpen`，没有新增表单逻辑；把点击目标下沉到 `.gname` 是**为了避开“行内按钮也会触发行点击”**（不用 stopPropagation，理由见踩坑 006 同类问题）。
- **验证结论**（预览实测）：每行 ✏️ 为 34×34、右边缘 202（未超出侧栏 206）；点 ✏️（内层 button）→ 弹窗标题「改名分组：「默认」」、输入框预填「默认」、按钮「取消 / 保存」，且**点击前后 active 分组未变（仍为「全部任务」）** → 确认不会误切分组；改名保存后侧栏同步，**测试后已把分组名改回「默认」**；点 `.gname` 切分组正常（active 切到「默认」），此时底部出现「删除分组(禁用)」（默认分组不可删）→ 与规则一致；新建「临时组」→ 行内也有 ✏️，选中后「删除分组」可用 → 二次确认「删除分组「临时组」？」→ 确认后分组消失、回到「全部任务」。**测试数据已全部清理**（只剩「默认」分组 + 用户原任务 `111111`），硬刷新后一致，控制台无应用报错。
- **数据保护**：本轮唯一改动过用户现有数据的地方是「默认」分组临时改名，测试完已改回原名并核对通过。

### 2026-10-08 · 新建 / 改名分组改为「列表下方 ＋ 按钮 + 弹窗」（用户反馈侧栏顶部输入框难用）

- **改了什么**：`pages/home.html`——删掉侧栏顶部的常驻 `st-input` + 「新建/取消」按钮 + 「正在改名」提示（连同 `.new-actions` 样式与 `editingGroupName` getter）；分组列表 `.glist` **下方**新增「＋ 新建分组」按钮 `.add-group-btn`；新增第四个 `st-dialog`（`sync:open="groupDialogOpen"`、`auto-close`）承载**新建与改名**两种模式：标题 `{{groupDialogTitle}}`（「新建分组」/「改名分组：「xxx」」）、输入框 `.dialog-input`（`sync:value="groupDraft"` + `on:change="submitGroup"` 回车提交）、按钮「取消」/`{{groupSubmitLabel}}`（「创建」/「保存」，空输入时禁用）。方法：`startEditGroup` / `cancelEditGroup` 删除，改为 `openAddGroup` / `openRenameGroup(id)` / `closeGroupDialog`；`submitGroup` 成功分支追加关弹窗与清 `editingGroupId`（返回值仍为无，直接读 `groupDraft`）；`.side-actions` 的「改名」改调 `openRenameGroup(groupFilter)`。data 新增 `groupDialogOpen`。
- **为什么**：用户反馈“左侧的新建分组太难用了，应该在 item 的下方添加一个加号按钮，点击后 dialog 中新建分组”。
- **设计决策**：新建与改名**复用同一个弹窗**（只靠 `editingGroupId` 区分），避免两套表单；弹窗内只用 data 字段（不调 `$host.xxx()`，见踩坑 005）；侧栏不再有常驻输入框，CSS 里的 `st-input` 选择器改挂到 `.dialog-input`（只给 `width`，不碰 `display`，见踩坑 004）。
- **验证结论**（预览实测）：侧栏 `st-input` 数量 = **0**、按钮仅「＋ 新建分组」且位于分组行下方（y=139 > glist bottom）；点它（内层 button）→ 弹窗 headline「新建分组」、placeholder 正常、输入框 440px（内部原生 410px）、按钮「取消 / 创建(禁用)」；输入后「创建」启用 → 提交 → 弹窗关闭、侧栏出现「临时测试组 0 项」；选中该组 → 「改名」→ 弹窗标题「改名分组：「临时测试组」」且输入框预填，**取消**后名字未变、**保存**后变「临时改名后」；再改名时直接派发 `change`（等价回车）→ 弹窗关闭且名字变「回车改名」；「删除」→ 二次确认弹窗（标题/文案/条数正确）→ 确认后分组消失、列表回到「全部任务」。**测试数据已全部清理**（末尾只剩「默认」分组，用户原有任务 `111111` 完好），硬刷新后侧栏仍为「全部任务 1 项 / 默认 1 项」、无报错；控制台 `errors: 0`（仅 `[bridge-link]` 噪声）。居中布局未受影响（`.main` 中心 = 视口中心）。
- **踩到的坑（已沉淀 `pitfalls/008`）**：`preview action=click` 点 `.add-group-btn` 与程序 `host.click()` 都不触发 `on:click`，一度以为绑定写错——实际必须点到 `st-button` **内部的原生 button**（`btn.shadowRoot.querySelector('button').click()`）；同理测 `st-input` 要在内部 input 上设值并派发 `input`/`change`。
- **截图说明**：本次 `screenshot` 因屏幕授权被取消而未生成，效果以 `dom` / `eval` 实测数据为准。

### 2026-10-08 · 布局定为三列网格：侧栏贴左 + 任务区居中（用户反馈：中间的得居中）

- **改了什么**：`pages/home.html` 样式——`.shell` 由 flex 行改为 **grid 三列** `190px minmax(0,1fr) 190px`（左列侧栏 / 中列任务区 / 右列等宽留白，靠右侧留白把中列推到视口正中）；`.side` 去掉 `flex: none`，加 `grid-column: 1` 与 `max-height: calc(100vh - 56px); overflow-y: auto`（分组多了自身可滚）；`.main` 改 `grid-column: 2; width: 100%; max-width: 880px; margin: 0 auto`；媒体查询新增 `≤1100px` 去掉右侧留白列、`≤620px` 改单列（`.side` 取消 sticky / 限高 / overflow）。
- **为什么**：用户反馈“你中间的得居中布局啊，只要左侧分组才一直在左边”——上一回合的 flex 方案（侧栏贴左 + 任务区占剩余宽度）会把任务区推到「侧栏右侧剩余区域」的中心，而不是**屏幕**中心；留白列使中列两侧对称，两者同时成立。
- **验证结论**（预览实测，硬刷新后取数）：视口 1512 → `.side` x=16（贴左）、`.main` x=316 宽 880、**中列中心 = 756 = 视口中心 756（偏移 0）**、两栏无重叠；滚动实测（往 `.list` 注入 40 个填充节点，测完 `location.reload()` 复原）：`scrollHeight 3064 / clientHeight 882`，`scrollTop` 到底 2182，滚动后侧栏 y=28 仍可见（sticky 生效）、末条 bottom=757 在视口内；媒体规则从 shadowRoot 的 `style` 文本核出（`@media (max-width: 1100px)` / `620px` 均在，注意页面模块的 `style` 有 2 个，要挑含 `.shell` 的那个）；交互实测：点「＋ 添加任务」→ 弹窗 headline「添加任务」、提示「将加入分组：「默认」」、textarea 440x121、空输入时「添加」禁用，点「取消」→ 无弹窗残留；硬刷新后列表仍为用户原有 1 条（`111111`），未被测试污染；控制台 `errors: 0`。
- **遗留 / 注意**：窄屏（≤1100 / ≤620px）分支无法在本机预览窗口（固定 1512x882）实测，只能从 `style` 文本核对规则已写入 + 代码审查；以后若要在窄屏上验证，需用 windows 找到移动设备窗口后再定向取证。

### 2026-10-08 · （已被同日下一条取代）侧栏改为贴着屏幕左边缘 + 修正 CONTEXT.md 踩坑索引漏项

- **改了什么**：① `pages/home.html` 样式——`.shell` 去掉 `max-width: 900px` + `margin: 0 auto`，改为 `width: 100%`（整宽 flex 行，不再整体居中）；行宽限制下移到 `.main` 的 `max-width: 880px`。② 文档——`CONTEXT.md`「踩坑索引」表补上漏登记的 `005` 行（`pitfalls/005-host-in-dialog-not-page.md`，正文与其它章节早已引用，仅索引表从 004 直接跳到 006），并在「使用指南」「组件与页面骨架」两处同步新的宽度/对齐规则。功能逻辑零改动。
- **为什么**：用户反馈“我想要左侧的分组列表，始终靠着屏幕左侧，而不是现在这样，在正中间的左侧”——根因是 `.shell` 的 `max-width: 900px` + `margin: 0 auto` 在 1512px 视口下把整个两栏容器居中，侧栏被挤到 x=306。用户同时选择了“保持现状，先不改功能”，故本回合不做任何功能新增。
- **验证结论**（预览实测，硬刷新后取数）：`preview action=app` 推送后 `status` 在线、`errors: 0`；`dom` 读 shadowRoot——`.shell` 改为 16,28 1480 宽、`.side` x=16（贴着屏幕左边缘）、`.main` x=226 宽 880，两栏无重叠；**滚动实测**（临时往 `.list` 注入 40 个填充节点，测完 `location.reload()` 复原）：`scrollHeight 3064 / clientHeight 882`，`scrollTop` 设为 99999 后实际到底 2182（= max），侧栏滚动后仍在 y=28 可见（sticky 生效），末条 bottom=757 在视口 882 内；**交互实测**：`click` 任务正文 → 控制台 `[detail] 打开详情 muz96kuhaul3 111111` 且 `st-dialog[open]` 的 headline 为「111111」，再 `click` 弹窗内「关闭」→ `[detail] 关闭详情` 且无 `[open]` 弹窗残留；硬刷新首帧日志为 `[group] 已读取分组，共 1 个` / `[storage] 已读取待办，共 2 项`，用户原有数据未被测试污染；控制台全程无应用报错。
- **验证坑（已沉淀 `pitfalls/007`）**：`o-page` 元素上**读不到页面 data**（`page.detail` 为 `undefined`，实例只有 `__xhear__`）——直接 `page.todos = [...]` 只会挂一个普通属性、**不会驱动 `o-fill` 重渲染**（实测改成 40 条后 `.item` 仍为 1 个）；要构造长列表请往 shadowRoot 里的 `.list` 注入 DOM 节点再刷新页面；判断 `st-dialog` 是否打开也要看 **`hasAttribute('open')`**，`d.open` 恒为 `undefined`。

### 2026-10-08 · 分组改成左侧固定侧栏（用户反馈原方案难用）

- **改了什么**：`pages/home.html`——布局改为左右两栏 `.shell`（左栏 `.side` 190px + `sticky`，右栏 `.main`）；侧栏常驻：分组名列表（「全部任务」+ 各分组，行内带计数，点选切换、选中 `primary-container` 高亮）、顶部新建输入框（回车 / 「新建」）、选中具体分组时底部出现「改名 / 删除」（改名会把顶部输入框切为改名模式：预填原名 + 按钮变「保存」+ 取消 + 「正在改名：xxx」提示）；删除原页面内的「分组栏 chips」与「⚙ 管理分组」展开式管理区，以及 `groupsEditing` / `groupManageLabel` / `toggleGroupManage` / `groupChipVariant`；新增 `isGroupActive` / `allCountText` / `canModifyGroup` / `editingGroupName`；窄屏（≤620px）侧栏改为顶部横向条。
- **为什么**：用户反馈“分组柔和在一起我搞不懂，不需要特别把分组弄出来，就在屏幕左侧固定一个 list 用于创建与切换分组，选择分组后就是在这个分组上的任务创建”。
- **验证结论**（预览实测）：左栏 190px 固定在 x=141、右栏在 x=351，无重叠；新建「公司」「私人」成功且落盘；点分组高亮切换（「全部任务* → 默认*」）；在分组下添加的任务归入该分组（弹窗提示「将加入分组：「公司」」、元信息`公司 · 创建于 …`）；分组内改名同步到侧栏与列表元信息；删除分组二次确认（取消不删、确认后任务移入默认并回到「全部任务」）；选中「默认」时删除键禁用（opacity 0.38）、选中「全部任务」时底部无改名/删除；底部统计随分组变化；硬刷新后分组持久化；控制台无报错。
- **踩到的坑（已沉淀 `pitfalls/006`）**：根级元素写 `class:active="$host.isGroupActive('all')"` 报 `Error evaluating element expression` 且高亮不生效（`$host` 只在 `o-fill`/`o-if` 等子作用域可用，根级要用裸方法名）；已修正为 `class:active="isGroupActive('all')"` / `on:click="setGroup('all')"` 并重测高亮正常。
- **数据说明**：测试数据已清理，存储恢复为用户原有 2 条（`111111` 默认分组未完成；`22222` 默认分组且已在垃圾桶），`groups` 仅保留默认分组。

### 2026-10-08 · 新增任务分组（公司 / 私人 等）

- **改了什么**：`pages/home.html`——新增存储键 `groups`（`Array<{id,name}>`，首项固定默认分组，常量 `DEFAULT_GROUP_ID` / `DEFAULT_GROUP_NAME`）与 `loadGroups` / `persistGroups`；任务新增 `groupId` 字段（旧数据补 `default`）；新增分组栏（全部 + 各分组 + 管理）、页面内分组管理区（新建 / 改名 / 删除，默认分组不可删，删除走二次确认）、`scopedActiveTodos` 计算属性（列表 / 统计 / 清除已完成按当前分组范围）、统一确认入口 `confirmAction`（按 `confirmKind` 分发彻底删除与删除分组）、添加弹窗里的「将加入分组」提示（`addGroupHint`）；列表元信息与详情弹窗都显示分组名。
- **为什么**：用户要求分组功能（公司任务 / 私人任务清单）。
- **设计决策**：分组单独一个存储键（与任务解耦，删除分组不需遍历结构）；新任务**跟随当前浏览的分组**（在「全部分组」下则归默认），不另设“无分组”状态；垃圾桶视图**忽略分组过滤**并隐藏分组栏（避免“分组栏选了 A 却看到全部垃圾桶条目”的歧义）；管理区**放页面内而非弹窗**（管理需要 `o-fill` 循环并在行内传 `$data.id`，而弹窗内 `$host`/`$data` 不可靠，见踩坑 005）；删除分组采用「任务移入默认分组」而非连任务一起删。
- **验证结论**（预览实测）：分组栏渲染与选中态正确；新建「公司」「私人」成功（重名自动加序号）；点分组过滤正确且空状态文案带分组名（「「公司」里还没有任务…」）；在分组下添加的任务确实归入该分组，弹窗提示正确；分组内改名后分组栏与列表元信息同步；删除分组先弹确认（文案含“N 项任务会移入「默认」”），取消不删、确认后任务真实移到默认分组并落盘；默认分组删除按钮禁用；底部统计随分组变化；「清除已完成」在默认视图下未动公司分组的已完成项，切到公司视图清除时只删该分组的；硬刷新后 `groups` 与任务归属仍在；控制台无应用报错。
- **本回合修掉的遗漏 bug**：底部栏「共 M 项」原用 `activeTodos.length`（全量），未随分组过滤 → 改为 `scopedActiveTodos.length`（症状：切到空分组时列表为空但显示“共 1 项”）。
- **数据说明**：测试数据已清理，存储恢复为用户原有 2 条（`111111` 在默认分组且未完成；`22222` 在垃圾桶），`groups` 只保留默认分组。

### 2026-10-08 · 详情弹窗简化为只读（底部只留「关闭」）

- **改了什么**：`pages/home.html`——详情弹窗 `slot="actions"` 删掉「标记为已完成/未完成」「删除」「还原」「彻底删除」四个按钮，只剩「关闭」；连带删除因此不再使用的方法 `toggleDetailDone` / `deleteFromDetail` / `restoreFromDetail` / `purgeFromDetail`，以及 `detail` 快照里的 `id` / `done` / `inTrash` / `doneLabel` 字段（`buildDetail` 同步精简）。
- **为什么**：用户要求“dialog 内的下面按钮只需要关闭即可”。
- **验证结论**（预览实测）：列表条目与垃圾桶条目的详情弹窗底部都只有「关闭」；弹窗内容完整（标题/描述/状态/三个时间）；点「关闭」弹窗关闭；控制台无应用报错。增删改仍可从列表操作（勾选框 / ✕ 倒计时删除 / 垃圾桶的还原与彻底删除）。

### 2026-10-08 · 添加支持多行（标题 + 描述）、点任务看详情弹窗

- **改了什么**：`pages/home.html`——添加弹窗内 `st-input` 换成 `st-textarea`（`rows=4` + `.dialog-field { width:100%; min-height:7.5em }`，实测高 121px）；新增 `parseDraft(raw)`：**第一个非空行 = 标题，其后所有行（含内部换行）= 描述**；数据模型新增 `desc` 字段（旧数据补 `""`）；列表项在标题与时间行之间显示描述摘要（`-webkit-line-clamp: 2` 截断）；任务 `.body` 加 `on:click` 打开详情弹窗，新增 data `detailOpen` / `detail` 快照与方法 `buildDetail` / `openDetail` / `closeDetail` / `toggleDetailDone` / `deleteFromDetail` / `restoreFromDetail` / `purgeFromDetail`，详情弹窗展示完整标题、描述（`pre-wrap`）、状态、创建 / 状态变更 / 删除时间，并按 `inTrash` 用 `class:hidden` 切换操作按钮（列表内：标记完成/未完成 + 删除；垃圾桶内：还原 + 彻底删除）。
- **为什么**：用户要求“添加和输入任务那里高一点、可换行，有换行则首行 title 其余为描述；单独点击任务可弹 dialog 看更多内容”。
- **设计决策**：多行输入中回车 = 换行，所以**取消回车提交**，改为只点「添加」按钮（旧 placeholder「回车即可添加」已改）；点击触发只绑在 `.body`（**不用行级 click + stopPropagation**，避开 ofa 事件委托可能忽略 stopPropagation 的风险），因此点勾选框/删除按钮不会误开详情；详情操件全部转调已有方法，不复制业务逻辑。
- **验证结论**（预览实测）：多行解析正确（标题「多行测试标题」/ 描述两行）；textarea 高 121px、原生输入区撑满 93%；点正文弹详情且标题/描述全文/状态/三个时间正确；点勾选框不弹详情且能正常切换完成态；详情内「标记为已完成」即时刷新状态与按钮文案（同时列表出现删除线与「完成于 …」）；详情内「删除」→ 关详情 + 开始倒计时；进垃圾桶后详情显示「已在垃圾桶」+ 删除时间，且只显「还原 / 彻底删除」；详情内「彻底删除」→ 关详情 +弹二次确认（取消不删）；详情内「还原」→ 移出垃圾桶；30 条带描述的长列表可滚到底（末条与底栏在视口内）；控制台无应用报错。测试数据已清理，用户 2 条数据字段恢复原样（`111111` 的 `statusChangedAt` 已回 `null`；`22222` 仍在垃圾桶）。
- **踩到的坑（已沉淀 `pitfalls/005`）**：`st-dialog` 内 `{{$host.xxx()}}` 不渲染（弹窗里 `$host` 不指向页面），同图里 `{{detail.desc}}` 这种属性访问却正常，极易误判为数据没准备好；改为打开弹窗时把文案/标志预计算进 `detail` 快照。

### 2026-10-08 · 添加任务改为「按钮 + 弹窗输入」

- **改了什么**：`pages/home.html`——删掉页面中央常驻的 `.add-row` 输入条，改为标题栏 `.top`（左标题 + 右「＋ 添加任务」`st-button`，space-between）；新增「添加任务」`st-dialog`（`sync:open="addOpen"` + `auto-close`，内嵌 `st-input`，回车与「添加」按钮都走 `submitAdd`）；data 新增 `addOpen`；新增 proto 方法 `openAdd` / `closeAdd` / `submitAdd`，`addTodo` 改成返回布尔（成功才关弹窗）。
- **为什么**：用户要求“不要这么正中央的显示，给个按钮，点击后 dialog 显示，在对话框内输入内容然后添加”。
- **设计决策**：`addTodo` 返回布尔而不是内部直接关弹窗，便于弹窗与任何其他入口复用；`openAdd` / `closeAdd` 都清空 `draft`（但取消关闭不保留半成品草稿，下次干净开始）。
- **验证结论**（预览实测）：点按钮弹窗打开、原位置输入条已无（`.add-row` 数量 0）；空输入时「添加」禁用，输入后启用；回车提交与点「添加」提交都新增成功且弹窗自动关闭、`draft` 清空；点「取消」关闭且不新增，重开弹窗草稿为空；新增条目带创建时间（`创建于 10-08 17:03`），计数同步；标题栏布局实测 rect 正常（左 247px 标题块 / 右侧 116x40 primary 按钮）；控制台无 error。测试条目已从存储删除，用户数据（列表 `111111`；垃圾桶 `22222`，删除于 10-08 16:50）保持原样。
- **踩到的坑（已沉淀 `pitfalls/004`）**：给弹窗内 `st-input` 写 `display: block` 覆盖了组件默认 `inline-flex`，外框依然 440px 但真实可输入区只剩 156px（肉眼看不出来）；改成 `width: 100%` 后内部原生 input 410px 撑满。另：预览标签页在后台时 `st-dialog` 开场动画被冻结，rect 会量到缩放一半的假尺寸，判尺寸应看 `getComputedStyle`。

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
