# MEMORY.md — 待办清单（todo）

项目记忆体：每回合**有改动**就在下方顶部追加一条（日期 / 改了什么 / 为什么 / 验证结论），最新在最上；纯讨论不记。容量上限 50 条：满 50 先把最旧 20 条压缩成 3–4 条（只留仍生效的决策与约束、用户偏好、未解决待办）。完整规则见 AGENTS.md「记忆体规则」。

## 记录

### 2026-10-10 · 「已归档」「垃圾桶」两个视图改为跟随左栏分组（用户反馈）

- **用户需求**：「为什么已归档那里，没有按照我左边的分组进行显示？垃圾桶和已归档，都应该按照左侧的分组来」。
- **改了什么**（`pages/home.html`）：① 新增 proto 方法 `scopeByGroup(list)`（`groupFilter === 'all'` 时原样返回，否则按 `groupId` 过滤）与两个 getter `scopedArchivedTodos` / `scopedTrashTodos`；② `scopedActiveTodos` 改用 `scopeByGroup`，与归档 / 垃圾桶三个视图**同一口径**；③ `visibleTodos` 两个分支、`archiveGroups`（`all` 模式的 todos 与 `day` / `week` 的分组循环）均改为 scoped 数据；④ `trashBadge` / `archiveBadge` / 两个底栏计数 / 垃圾桶列表的 `o-fill` 全部改读 scoped 数据；⑤ `updateEmptyText()` 在选中分组时给出带分组名的空状态（「「工作」的垃圾桶是空的…」）并提示可切到「全部任务」看全部；⑥ `emptyTrash()` 改为**只清当前分组范围**（条数取 `scopedTrashTodos.length`，范围记在非响应式字段 `this._purgeScope`，`confirmAction()` 按它过滤；`closeConfirm()` 清空），确认框标题 / 文案在选中分组时带分组名；⑦ 两处视图说明文案（`.trash-tip`）写明“左栏选中某个分组时只显示该分组的条目”。
- **设计决策**：① **三个视图口径统一**：左栏分组是全局的“作用范围”，不分“归档 / 垃圾桶忽略分组”（旧行为是前者与后者不一致，正是用户困惑的来源）；② 筛选**只改显示**——`scopeByGroup` 是纯 filter，不动数据、不影响 `groupId` 与任何时间戳；③ **“清空垃圾桶”跟着缩到当前分组**：否则底栏写「垃圾桶 0 项」、旁边按钮却能一键清掉其它分组的条目，属硬伤；确认框文案带分组名作提示；④ 视图标签数量也跟着分组走，保证“标签数 = 里面能看到的条数”。
- **验证结论**（预览实测 + `action=run-tests`）：手工实测——选「个人」后垃圾桶显示 0 条、空状态「「个人」的垃圾桶是空的 🗑，切到「全部任务」可以看到所有分组的条目」、标签徒标消失、「清空垃圾桶」置灰；切「全部任务」后恢复 1 条 / 标签「垃圾桶 1」/ 按钮可用。**新增用例 `client/test/group-scope-views.test.json`（name「归档桶跟随分组」）跑到通过**；全套 10 个用例 `action=run-tests` **10 通过**；`action=status` 的 `errors: 0`；跑完核对 `__todo_test_dirty` 已清、用户数据与偏好均完好（3 条待办：`22222` 在垃圾桶 / `111111` / `222222`，`groups` = 默认 + 个人，`ui.sideWidth 239`，`sessionStorage` 已清）。
- **本回合踩的坑（已沉淀 `pitfalls/022`）**：改完 getter 后**只改了底栏 / 徒标 / 空状态，忘了垃圾桶列表的 `o-fill` 绑的是未过滤的 `trashTodos`** → 用例直接报「「工作」下的垃圾桶不应出现其它分组的条目，实际 默认项」，同一屏上“底栏 0 项”与“列表 1 条”并存。教训：改数据范围时先把模板里所有 `:value=` 扫一遍。
- **环境备注**：`action=app` 推送报 `ACK timeout` 但**推送已生效**（用 eval 读页面里的新说明文案佐证，见 `pitfalls/020`）；`action=run-tests` 本会话可用（不认 `files` 参数，会跑全套）；跑全套时「删除倒计时」出现过一次瞬时失败（`找不到任务：任务B`，重跑即绿，已确认非本次改动引入——该用例全流程在 `groupFilter = all` 下跑，与 scoped getter 行为等价）。

### 2026-10-10 · 已归档视图加子标签「全部归档 / 按日期 / 按周」（用户需求）

- **用户需求**：「已归档那里，下面再添加几个 tab，默认查看所有归档，可以按归档日期查看归档，按周查看归档（按周的话，归档也要简单的加一下日期分组）」。
- **改了什么**（`pages/home.html`）：① data 新增 `archiveGroupMode`（`"all"` 默认 / `"day"` / `"week"`）；② 新增 getter **`archiveGroups`**（`all` → 一组 `{key:"all", showHead:false, todos: archivedTodos}`；`day`/`week` → 按 `archiveBucket()` 分组、**最新一组在前**、每组带 `label` / `countText` / `showHead:true`）与方法 `setArchiveGroupMode` / `dateKey` / `monthDayText` / `archiveBucket` / `isoWeek`；③ 模板：归档视图说明行下方加子标签 `st-button-group.archive-tabs`，`archivedTodos` 的平铺列表改为 **`.agroups` → 外层 `o-fill :value="archiveGroups" fill-key="key"`（`.agroup` = `.agroup-head` + `.list` → 内层 `o-fill :value="$data.todos" fill-key="id"`）**，`showHead` 控制组头显隐；④ 样式新增 `.archive-tabs` / `.agroups`（组间 18px）/ `.agroup` / `.agroup-head`（13px 半粗 + 12px 条数）；⑤ 会话状态快照加 `archiveGroup`（`sessionSnapshot` / `restoreSessionState` 校验）。
- **设计决策**：① **不给「全部归档」另写一套平铺模板**——它在 `archiveGroups` 里就是「一组 + 组头隐藏」，与分组模式共用同一个 `o-fill` 与同一份行模板（以后改行结构只改一处）；② 分组只改**怎么显示**、不筛数据不改数据，`archiveBucket()` 只读 `archivedAt`（取消归档 / 删除后条数自动重算）；② key 一律「`d`/`w` + `YYYY-MM-DD`」→ **字典序即时间序**，排序简单且天然把「归档时间未知」的兜底组（`0-unknown`）排到最后；③ 按**本地时区**切日期（不用 UTC，避免凌晨归档被算到前一天），按周用 **ISO 周**（周一为一周起点、取该周周四所在年份与周序号，跨年周不错位）；④ 查看方式随会话记忆（写 `sessionStorage`，与「刷新保留、关标签页重置」的既有语义一致）。
- **验证结论**（预览实测）：**新写 `client/test/archive-group.test.json`（用 crafted `archivedAt`：今天两条 / 昨天一条 / 9 天前一条）+ 本地驱动分片回放全绿**——默认「全部归档」：`variant=filled`、4 条平铺、`.agroup-head` 计算值 `display:none`；「按日期」：3 组（`10-10 周六`+`10-09 周五`+`09-30 周三`，各带条数、组头 19px 单行、组前后 y 247/374）、各组条数 `2,1,1`、组内顺序不变、总条数仍 4；「按周」：同周两条合成一组、组头「2026 年第 41 周 · 10-05 ~ 10-11 2 项」、总条数不变、`sessionStorage.archiveGroup="week"`；**硬刷新后仍停在「按周」且周分组照旧**。**回归**：`toggle-archive`（归档视图结构改了，全链路 20 步全绿）与 `session-state`（快照加了字段，19 步含 4 次 reload 全绿）分片回放通过；控制台 `errors: 0`；跑完核对 `__todo_test_dirty` 已清、用户数据（3 条待办 / 2 个分组 / `ui.sideWidth 239`）与列表渲染（111111 / 222222、「1 项未完成 · 共 2 项」、垃圾桶徒标）均已回来。
- **环境限制**：本会话 `action=run-tests` 与 `action=windows` 都报「宿主未注入预览通道」（`status` / `eval` / `console` / `dom` 正常），测试仍走 `test/_driver.js` 分片回放；`action=app` 两次报 ACK timeout 但**推送其实已生效**（用 `eval` 查页面模板里的中文文案佐证），见 `pitfalls/020`。
- **本回合踩的坑（已沉淀两个文件并登记索引）**：`pitfalls/020`（`action=app` ACK timeout ≠ 推送失败）、`pitfalls/021`——**临时改预览数据时的备份挂在了 `window` 上，reload 后变 `undefined`，`setItem('todos', undefined)` 直接把用户 3 条待办抹掉**；已立即用 `localStorage.__todo_test_backup_v1` 完整还原（标题 / done / deletedAt / groups / sideWidth 全部核对一致）。教训：跨 reload 的临时状态一律存 `localStorage`，且还原前先判空。

### 2026-10-10 · 修「宿主跑测试报 ACK timeout / wait 超时」——reload 窗口与就绪锚点两个时序坑（用例重构引入）

- **症状**：宿主自动跑 `client/test/` 时报 6–7 条错误，名字正是上一回合重构后的短功能名：`添加任务 / 拖拽排序 / 分组管理 / 会话状态：调试指令投递失败（预览页无响应）：ACK timeout after 4 retries`；`删除倒计时 / 编辑任务：调试指令 wait 等待结果超时（25000ms）`。而同一套步骤在页面里手动回放（本地驱动）当时是全绿的 → 应用行为无问题，是**步骤与页面的时序**问题。
- **根因（本回合定位，两条都是上一回合重构时新引入的）**：① **重构把原来的 `{"wait": 900}`（宿主侧数值等待）换成了紧跟 `reload` 的选择器 wait** ——`reload` 会断开调试桥、重注入代理，紧跟的选择器 wait 需要投递指令，此时页面正在重载 → 投递失败重试 4 次（ACK timeout），或送达后在页面重建窗口里一直查不到（wait 超时）。旧版一直用数值等待并非随手写的，它不需投递所以不会撞这个窗口（实证：`action=wait` 带 `.add-group-btn`（页面 shadow 内）在页面就绪时 0ms 就满足，说明宿主 wait 本身能穿 shadow，不是选择器写法问题）。② 新加的 `await T.ready('.item')` 就绪守卫锚点选错了——`.item` 在**已归档 / 垃圾桶视图 / 列表清空后**合法地不存在，这种守卫永远不会满足（本地回放实测就在「归档项删除后去垃圾桶还原」那一步抛「页面就绪超时，找不到 .item」）。
- **改了什么**：8 个 `.test.json` 全部改为——① 每个用例首步加 `{"wait": 1500}`（让宿主推送后的页面先安定）、**每个 `reload` 后面跟 `{"wait": 1500}`**（宿主侧睡眠，不需投递），全库**已无任何选择器 wait 步骤**（校验：8 个文件 `hostSelectorWaits = 0`）；② 就绪轮询改为页面侧 `T.ready(sel, ms)`（间隔 100ms 轮询），**锚点统一用常驻节点 `.shell`**（修正了 4 处 `.item` 锚点：delete-trash、toggle-archive、trash-purge×2）；③ 倒计时的 5–6 秒等待从 eval 内部拆出、**单独占一个数值 wait 步骤**（`{"wait": 6000}`），避免单条指令页面侧耗时顶到调试桥 30s 上限；④ 新增 `T.q` 容错（`o-page` 的 shadowRoot 尚未就绪时返回 `[]` 而不是报错）。**应用代码零改动**。
- **验证结论**（预览实测，逐用例分片跑到 `done` + restore + 无控制台报错）：add-task(13 步) / delete-trash(17) / drag-order(14) / edit-task(15) / group-crud(18) / session-state(19，4 次 reload) / toggle-archive(20) / trash-purge(19) **全部通过**；`action=status` 的 `errors: 0`；跑完核对存储：`todos` 3 条（`22222` 垃圾桶 / `111111` 已完成 / `222222`）、`groups` = 默认 + 个人、`ui.sideWidth = 239`、`__todo_test_dirty` 已清、`sessionStorage` 已清，页面渲染 `111111` / `222222`、「1 项未完成 · 共 2 项」。
- **环境限制（未变）**：本会话 `preview action=run-tests` 仍不可用（宿主未注入通道），验证仍走 `test/_driver.js` 本地回放 + 分片；因此**无法直接复现宿主那套 runner**，上述修复是对症的两类根因（时序 + 锚点），已用「全库无选择器 wait / 锚点全为 `.shell`」的静态校验与完整回放双重佐证。
- **沉淀**：新建 `pitfalls/019`（reload 窗口与就绪锚点两个时序坑）并登记索引；CONTEXT.md「用例写法约定」补三条（reload 后数值等待、就绪锚点用常驻节点、长等待单独占步骤 + 跑完核对 dirty）；AGENTS.md「硬性约定」用例写法条 ⑤ 补充同一规则（原 ⑥⑦⑧ 顺延为 ⑦⑧⑨）。

### 2026-10-10 · 按场景测试规范重构 8 个用例（共享上下文 T / 短名 + desc），并做到全绿

- **改了什么**：`client/test/` 下 8 个 `.test.json` 全部重写——① 辅助函数统一挂在**共享上下文 `T`** 上（不再用 `window.__t` 那一大块整坨定义），同一用例内只定义一次；② `name` 改为 ≤12 字短功能名（添加任务 / 删除倒计时 / 拖拽排序 / 编辑任务 / 分组管理 / 会话状态 / 归档链路 / 垃圾桶清理），细节挪进新增的 `desc`；③ `reload` 之后的步骤改为 `document.querySelector('o-page').shadowRoot` 直查、不再依赖 `T`（reload 会重置 T）；④ 断言全部写进 eval（抛错即失败），`expect` 只保留 `consoleErrors: 0`（不再用 `expect.count .item`——宿主深查会穿进 `st-menu` 等组件 shadow 命中同名 `.item`，见踩坑 014）；⑤ 新增可选工具 `test/_driver.js`（宿主未注入 run-tests 通道时的本地回放驱动，`run(file, from, to)` 支持分片）。
- **为什么**：用户要求「按最新的场景测试规范重构 client/test/ 下的用例（用共享上下文 T 消除重复的辅助函数定义，name 改短名，细节挪到 desc）」。
- **验证结论**（预览实测，逐用例跑到 done + restore + 无控制台报错）：add-task(12 步) / delete-trash(14) / drag-order(13) / edit-task(14) / group-crud(17) / session-state(18，含 4 次 reload) / toggle-archive(17) / trash-purge(14，分 4 片跑) **全部通过**；`action=status` 的 `errors: 0`；跑完核对存储：`todos` 3 条（`22222` 在垃圾桶、`111111` 已完成、`222222`）、`groups` = 默认 + 个人、`ui.sideWidth = 239`、`__todo_test_dirty` 已清、`sessionStorage` 会话状态已清；再 reload 一次让页面重新显示用户数据（渲染 `111111` / `222222`、「1 项未完成 · 共 2 项」）。
- **发现并处理的数据事故**：开工时存储是**空的**、`__todo_test_dirty = "1"`——上一次会话的用例运行中断（收尾 restore 未执行），把用户 3 条待办留在了已清空状态。已按备份 `__todo_test_backup_v1` 完整恢复（todos / groups / ui 三项）。**教训：用例跑完必须核对 dirty 标记已清、用户数据已回来**；用例开头的 wipe 步骤设计成「先把 dirty 状态的备份还原、再备份并清空」，所以中断后重跑即可自愈。
- **修正的用例错误断言**：`drag-order` 原断言 `T.drag('A','C','after')` 后应为 `B,C,A` 是**错的**——实测真实语义是「指针落在某行下半区 → 插到下一行之前」，`after C` 得到 `C,A,B`（`C,B,A` 才是「插到 B 之后 / 追加末尾」）。已按真实语义重写该用例三处断言并在 `desc` 写明落点语义。
- **环境限制**：本会话 `preview action=run-tests` 报「宿主未注入预览通道」（而 status / eval 正常），因此用 `test/_driver.js` 做本地回放（动态 import 必须用基于 `location.href` 的绝对 URL；单条 eval ≤ 30s，长用例分片；`reload` 必须单独一次调用）。
- **沉淀**：新建 `pitfalls/017`（用例断言要按实现真实语义写）、`pitfalls/018`（本地回放与三条硬限制），均已登记索引；CONTEXT.md 新增「场景测试」节（用例表 + 用法约定）、目录结构补 `test/`；AGENTS.md「硬性约定」追加一条用例写法规则。

### 2026-10-09 · 修「拖拽落点指示线乱跑」（用户截图反馈）——根因是 `<o-fill>` 的 rect 全为 0

- **症状**：用户截图反馈「这条线是乱的」——指示线横穿某一行的文字、位置偏下一大截。
- **根因（实测定位）**：指示线是绝对定位在 `.list`（`position: relative`）里的浮层，我把 `top` 算成了「目标行视口坐标 − 列表容器视口坐标」，但取容器时写的是 `itemEl.parentElement`——**列表行的直接父节点不是 `.list`，而是 `<o-fill>`，它是 `display: contents`，`getBoundingClientRect()` 返回全 0**（实测 `parentRect {0,0,0,0}`、`display: contents`、`.list` 实际 `y=159`）。于是 `listTop` 恒为 0，算出的“相对偏移”其实是视口坐标，整个下移了 `.list` 的位置（约 159px）。
- **改了什么**：`pages/home.html`——**彻底放弃坐标计算**，改成把落点线画在**目标行自己的边缘**上：① 删掉 `.drop-line` 浮层元素、`data.dropLineTop` / `dropHoverId` 与 proto `isDropHover`，`.list` 恢复不带 `position: relative`；② `.item` 加 `position: relative`，新增 `.item.drop-before::after/::before`（线 + 圆点画在该行**上边**）与 `.item.drop-after::after/::before`（画在该行**下边**）——线 `left: 8px; right: 0; height: 2px`、`top/bottom: -5px`，恰好落在 8px 行间距的中间；③ data 改为 `dropBeforeId` / `dropAfterId`，proto 改为 `isDropBefore(id)` / `isDropAfter(id)`；④ `dragDropPosition()` 改为**只返回 `{ beforeId, afterId }`、不再产生任何坐标**，且取列表容器改用 `handleEl.closest('.item').closest('.list')`（不再用 `parentElement`）；⑤ 模板行改用 `class:drop-before` / `class:drop-after`。
- **验证结论**（预览实测）：指针在第 2 行上半 → `item drop-before`，`::after` 计算值 `top: -5px` / `height: 2px` / 主题色 `rgb(159,202,255)`，`::before` 9×9 圆点 → 线落在行间距中点（行底 219 / 行顶 227，线 222~224）；指针在末行下半 → `drop-after`，线贴在末行下边缘；指针在第 1 行上半 → 首行 `drop-before`（线在列表上方）；拖动全程**顺序不变**；松手后顺序才互换且提示类全部清空；**硬刷新后新顺序仍在**；拖回原位 → `[drag] 落点仍是原位，顺序不变` 且不写盘；点 / 拖手柄仍不会误开详情交互；控制台无应用报错。
- **数据保护**：测试中的顺序改动已全部拖回，预览存储里两条待办顺序与你原有的一致（`111111` / `222222`），无残留提示类。
- **沉淀**：新建 `pitfalls/016-o-fill-display-contents-rect-zero.md`（症状 / 根因 / 正确姿势，含“浮层位置不对就用「浮层 top + 浮层 rect + 参照容器 rect」三件套定位”）并登记索引；AGENTS.md「硬性约定」新增一条（`o-fill` / `o-if` 等框架节点会插在 DOM 中间且 rect 全 0——找布局容器用语义选择器，禁用 `parentElement`；能用元素自身边缘表达位置就不要算坐标）；CONTEXT.md 同步使用指南第 7 条、data 表、方法表、页面骨架、关键流程与【拖拽排序】实测链路。

### 2026-10-09 · 拖拽排序改为「引导式」：拖动只显示落点指示线，松手才换位（用户反馈）

- **改了什么**：`pages/home.html`——① **去掉拖动中的实时重排**（`dragTargetIdAt()` 删除），改为 `dragDropPosition(clientY, handleEl)` 只算落点 `{ y, beforeId, afterId, hoverId }`；② 新增 `commitDragDrop(id, beforeId, afterId)` 在 `pointerup` 时一次性 splice + 落盘（带 `remap()` 下标换算与「落点即原位则不写盘」）；③ 新增 data `dropLineTop` / `dropHoverId` 与 proto `isDropHover(id)`；④ 模板：列表容器 `.list` 加 `position: relative`，末尾新增落点指示线 `<div class="drop-line" class:hidden="!dropLineTop" :style.top="dropLineTop">`，行加 `class:drop-hover`；⑤ 样式：`.item.dragging` 由“抬起阴影”改为**原地降明度**（`opacity .4` + `inset` 描边），新增 `.drop-line`（2px 主题色横线 + 左端 9px 圆点、绝对定位、`pointer-events: none`）与 `.item.drop-hover`（2px 主题色 `inset` 描边）。
- **为什么**：用户反馈“这个拖拽立刻生效的吗？不是应该开始拖放到目标的时候，有个高亮之类的引导样式，放下的时候才真正换位置会更好”——原来的“边拖边跳”没有可预期的落点提示。
- **设计决策**：拖动过程**完全不改 `todos`**，松手才一次提交换位；指示线用绝对定位元素（不参与 flex 排版）；落点判定改为**按行上半 / 下半区**（上半→插到该行前，下半→插到下一行前，末行下半区 / 列表下方→追加末尾），比原来的“命中哪一行就换到哪一行”更符合直觉。
- **验证结论**（预览实测，派发 `PointerEvent`）：`pointerdown` 后行带 `dragging`（顺序不变、指示线仍隐藏）；`pointermove` 到目标行 → 指示线出现（`height 2px`、主题色 `rgb(159,202,255)`、`position: absolute`、移除 `hidden`）、目标行带 `drop-hover`，而**拖动中列表顺序完全不变**（实测仍是拖动前顺序）；`pointerup` 后指示线与描边消失、日志 `[drag] 已放下，xxx 移到第 N 位` + `[storage] 已保存待办`、顺序才互换并渲染正确；**硬刷新后新顺序仍在**；在自己行内上下微动后松手 → `[drag] 落点仍是原位，顺序不变`、不写盘；测试结束已把顺序还原为测试前的值，控制台无应用报错。
- **文档**：CONTEXT.md——使用指南第 7 条（重写为“拖动过程只给引导、松手才换位”含三条子说明）、data 表（`dropLineTop` / `dropHoverId`）、方法表（`dragDropPosition` / `commitDragDrop` / `isDropHover` 替换原 `dragTargetIdAt`）、页面骨架（新增落点判定与下标换算两条，`.list` 加 `position: relative`）、关键流程与【拖拽排序】实测链路全部重写。本回合未踩新坑。

### 2026-10-09 · 待办事项支持拖拽排序（用户需求）

- **改了什么**：`pages/home.html`——① 列表行 `.item` 首位新增拖拽手柄 `.drag-handle`（`n-icon mdi:drag-vertical`，`font-size: 20px`、`cursor: grab`、`touch-action: none`、常态 `opacity 0.45` / `.item:hover` 时 1 / `@media (hover: none)` 常显 0.8，`on:pointerdown="$host.startDrag($event, $data.id)"`）；② `.item` 加 `attr:data-id="$data.id"`（供拖拽反查）与 `class:dragging="$host.isDragging($data.id)"`；`.shell` 加 `class:dragging="!!draggingId"`；③ CSS 新增 `.item.dragging`（降透明 + 阴影）、`.shell.dragging { user-select: none }`、`.item.dragging .drag-handle { cursor: grabbing }`；④ data 新增 `draggingId`；proto 新增 `startDrag(ev, id)` / `dragTargetIdAt(clientY, handleEl)` / `isDragging(id)` / `dragHandleTitle(todo)`。
- **为什么**：用户要求“待办事项允许拖拽”。
- **实现方式**：拖动过程中**实时重排 `this.todos`**（数组顺序即显示顺序，`o-fill` 带 `fill-key="id"` 会正确复用节点），松手才 `persistTodos()`；**不对存储结构做任何改动**（不新增排序字段，重排只换数组元素位置）；不做自动滞动，也不改 `groupId`（拖不出分组）。手柄在 `.body` 之外，因此点 / 拖手柄不会误开详情弹窗。
- **验证结论**（预览实测，向手柄派发 `PointerEvent`）：手柄渲染正常（24×28、图标 20px、`touch-action: none`、title 正确）；`pointerdown → pointermove`到下一行 → 顺序实时由 `[222222, 111111]` 变 `[111111, 222222]`，拖动中 `.item.dragging` / `.shell dragging` 类到位；`pointerup` 后类名清空、日志 `[drag] 拖拽结束，已保存新顺序` + `[storage] 已保存待办`；**硬刷新后新顺序仍在**；反向拖回后复原为你原来的 `[222222, 111111]`；分组视图（默认）内拖拽同样生效；按下即松手（无移动）只打 `[drag] 未移动，顺序不变` 且**不写盘**；手柄 click 不会打开详情（回归：点正文仍能正常弹详情）；控制台无应用报错。
- **关键知识点（已写进 CONTEXT.md 骨架节）**：拖拽命中判定**不能用 `document.elementFromPoint`**（它从 document 出发只能命中 `<o-page>` 宿主，穿不过页面 shadow），本项目用 `dragTargetIdAt()` 逐行比 `getBoundingClientRect()` + 从 `attr:data-id` 读 id；模板里传事件对象用 `$event`（`on:pointerdown="$host.startDrag($event, $data.id)"`，已查 ofajs-docs 确认支持）。
- **文档**：CONTEXT.md——定位（加“拖拽调整顺序”）、使用指南新增第 7 条（拖拽排序，含三条子说明）并将后续条目重编号为 8–13、data 表（`draggingId`）、方法表（4 个新方法）、页面骨架（手柄样式 / 实时重排机制 / 为何不能用 `elementFromPoint`）、三视图模板结构（列表行多了手柄）、关键流程（拖拽排序）、核心链路新增【拖拽排序】专题；本回合未踩新坑（无新 pitfalls）。

### 2026-10-09 · 调行尾「编辑 / 删除」按钮尺寸与观感（用户反馈“太丑”）

- **改了什么**：`pages/home.html`——① 行尾两个图标按钮包进新容器 **`.item-actions`**（`flex:none; display:flex; align-items:center; gap:2px`，列表行与归档行两处模板都改）；② `.item-actions st-icon-button { font-size: 12px }` 把按钮从默认 40px 缩到 **34.3px**（与侧栏分组行 ⋯ 同规格，图标 18.9px）；③ 编辑按钮加 `.edit-btn` 类：常态 `opacity: .7`，`hover` / `focus-within` 变 `opacity: 1` + 主题色（带 transition）；④ 新增 `.item.pending .item-actions st-icon-button { color: var(--md-sys-color-on-error-container) }` + `.item.pending .item-actions .edit-btn { opacity: 1 }`。
- **为什么**：用户反馈“你这个编辑按钮加完太丑了，你适当调一下大小什么的，要调好看一点”——两个 40×40 按钮并排占 92px，在 60px 高的行里显得笨重。
- **验证结论**（预览实测）：操作区总宽 **70.6**（原 92）、两按钮均 34.3×34.3（图标 18.9）、与 `.body` 垂直居中（无描述行 30/30、有描述行 40/40）；编辑按钮 opacity 0.7 / 删除 1；倒计时行两个按钮图标颜色变 **rgb(255,180,171)**（on-error-container，红底上清晰）且编辑按钮恢复不透明；点铅笔仍正常进「编辑任务」弹窗（回归通过）；控制台无应用报错。
- **踩到的坑（写进 CONTEXT 与注释，未单独建 pitfalls）**：`.item.pending .item-actions { color: ... }` **不生效**——`st-icon-button` 自带 `color: on-surface-variant`，**继承打不过自声明**，必须直接命中宿主元素（`.item.pending .item-actions st-icon-button`）。同理想改已封装组件内的颜色时先看组件是否自己声明了 color。
- **无法实测的点**：`.edit-btn:hover` 的变色（转主题色）——预览标签页在后台，浏览器不更新指针状态，只能从 CSS 规则已生效（opacity 0.7 量得到）做旁证，需用户在前台用鼠标确认（同踩坑 010）。
- **数据保护**：测试中误触删除倒计时、导致 `222222` 真的进了垃圾桶（等得太久超过 5 秒），已从垃圾桶「还原」回列表（`222222` 标题与描述、`111111` 均完好，垃圾桶仍为用户原有 1 条 `22222`）。教训：**测倒计时类交互时操作完要立即撤销**，不要隔着多次 await 再收尾。
- **顺手补的文档漏误**：上一回合「归档按钮移到右上」的 CONTEXT 编辑曾因同批次的另一条 old_string 未命中而**整批被拒**，导致使用指南第 11 条没改到（仍写着“底栏 + 归档按钮”）；本次已改为 11（右上）+ 12（底部栏），并在核心链路开头注明「编号 ①–㉑ 为主线，【编辑任务】/【行尾操作区尺寸与观感】/【归档链路】为后加专题（未重排编号）」，以修正之前堆积的编号乱序。

### 2026-10-09 · 已有任务支持编辑标题 / 描述（用户需求）

- **改了什么**：`pages/home.html`——① 详情弹窗由“永远只读”改为**双模式**：只读区 `.detail` 与新增编辑区 `.detail-edit`（`.edit-title` = `st-input` + `.edit-desc` = `st-textarea`，用 `class:hidden="detailEditing"` 切换），`slot="actions"` 写两组（关闭 / 编辑；取消 / 保存）；headline 改 `{{detailEditing ? '编辑任务' : detail.title}}`；② 列表行与归档行在删除按钮前新增**铅笔 `st-icon-button`**（`mdi:pencil`，`title` 由 `editButtonTitle(todo)` 给「编辑：xxx」）；③ data 新增 `detailId` / `detailEditing` / `editTitle` / `editDesc`；proto 新增 `openEditDetail(id)` / `editButtonTitle(todo)` / `startEditDetail()` / `cancelEditDetail()` / `submitEditDetail()`，`openDetail()` / `closeDetail()` 同步复位编辑态。
- **为什么**：用户要求“已经录入的任务，允许编辑内容”。
- **设计决策**：① 编辑**复用详情弹窗**（不另建弹窗）：先看后改，改完回只读，列表即时同步；② 预填取 **`todos` 里的原始 `text` / `desc`**，不读 `detail` 快照——快照把空标题换成了「（无标题）」，拿它做初值会把占位字符写回存储；③ 只改 `text` / `desc`（分组、`done`、各时间戳不动，编辑不是状态变更，不刷 `statusChangedAt`）；④ 标题 `trim()` 后不能为空（「保存」置灰）；⑤ 归档视图也给了铅笔（归档内容同样可能要改）。
- **验证结论**（预览实测）：点行内铅笔 → 弹窗 headline「编辑任务」、两个输入框已预填当前标题与描述（440px 宽）、只读区隐藏、操作组为「取消 / 保存」；改标题 + 两行描述 → 「保存」→ 列表项标题/描述即时更新、弹窗回只读且 headline 变新标题；**硬刷新后修改仍在**（已落盘，`[detail] 已保存编辑 …` 与 `[storage] 已保存待办` 埋点成对出现）；重新进入编辑→「取消」→ 列表值不变（实测标题仍为当前值，预填正确）；把标题改成纯空白 → 「保存」置灰；归档视图里的铅笔同样可用（headline「编辑任务」、预填「111111」）；实测结束已把用户数据复原（`222222` 标题与描述、`111111` 均恢复原值，归档项已取消归档），控制台无应用报错。
- **文档**：CONTEXT.md——定位（加“编辑已有任务的标题与描述”）、使用指南第 8 条改为「查看详情 / 编辑」并新增编辑子条、第 7 条标题改「勾选 / 编辑 / 删除」、data 表（4 个新字段）、方法表（5 个新方法 + `openDetail`/`closeDetail` 补充）、页面骨架（详情弹窗双模式结构与边界）、三视图模板结构（列表 / 归档行多了铅笔按钮）、关键流程（详情 / 编辑流程重写）、核心链路新增 ㉓。

### 2026-10-09 · 「归档已完成」从右下底栏移到右上标题栏（用户要求）

- **改了什么**：`pages/home.html`——① 标题栏 `.top` 右侧新增包裹容器 **`.top-actions`**（`display:flex; align-items:center; gap:8px; flex:none`），里面依次是「归档已完成」`st-button`（`variant="text"` + `title` 提示作用范围）与原有的「添加任务」；② `全部` 视图底栏删掉归档按钮，只剩「N 项未完成 · 共 M 项」；③ 窄屏媒体查询给 `.top` 加 `flex-wrap: wrap`。
- **为什么**：用户要求“归档已完按钮现在是右下的，放到右上”。
- **设计决策**：按钮**不随视图切换隐藏**（它的作用范围是分组、不是视图，三个视图下都在）；禁用条件仍是 `doneCount === 0`（当前分组范围内无已完成项）——归档后按钮立即变灰。
- **验证结论**（预览实测）：右上两按钮（归档 x=898 w=136 / 添加 x=1042 w=122，y 均为 28、右边缘 1164 = 视口 1180 - 16 padding），任务区右边缘贴齐；底栏已无归档按钮（footer 文本只剩计数）；点「归档已完成」→ `111111` 从列表消失、`已归档 1` 徒标出现、统计「共 2 → 1 项」、左侧计数 2 → 1、按钮立即置灰；切「已归档」视图下该按钮仍可见但置灰；点「取消归档」后完全回到原状（列表 `222222` + `111111`、计数与统计复原）；控制台无应用报错、数据无残留。
- **文档**：CONTEXT.md——使用指南第 11 条重写为「右上『归档已完成』」、新增第 12 条底栏、页面骨架标题栏结构 + 新增「右上操作区」说明、关键流程归档条目、核心链路 ㉒ 措辞；顺手纠正文档漂移：`view` 取值表（旧写四个）、`restoreSessionState` 校验值（旧写四个）、核心链路 ④（四个视图→三个）、⑮（三个时间→四个）。

### 2026-10-09 · 筛选改为「全部 / 已归档 / 垃圾桶」，新增归档机制（用户需求）

- **改了什么**：`pages/home.html`——① 视图筛选按钮组由 `全部 / 未完成 / 已完成 / 垃圾桶` 改为 **`全部 / 已归档（`mdi:archive-arrow-down`，带数量）/ 垃圾桶`**；② 数据模型新增字段 **`archivedAt`**（`number|null`，`loadTodos` 规范化、`addTodo` 置 `null`）；③ 右侧列表从「列表 / 垃圾桶两套」改为**三套互斥**（`全部` / `已归档` / `垃圾桶`，`o-if` 按 `inListView` / `inArchiveView` / `inTrashView` 切换），新增归档视图（`.item.archived`：`.arch` 位置的归档图标 + 正文 + 「取消归档」`st-button` + 删除按钮）与它的底栏「已归档 N 项」；④ 底栏「清除已完成」（红色 `color="error"` + `clearDone()`）改为 **「归档已完成」（默认色 + `archiveDone()`）**，只把当前分组范围内已完成的条目打上 `archivedAt`（**不删数据**）；⑤ 新增 `unarchiveTodo(id)`；`restoreTodo()` 一并清 `archivedAt`；⑥ 相关口径同步：`activeTodos` = `!deletedAt && !archivedAt`、新增 `archivedTodos` / `archiveBadge` / `inListView` / `inArchiveView`、`visibleTodos` 加 `archived` 分支、`groupCountText` 与 `requestDeleteGroup` 的计数排除归档项、`timeMeta` / `buildDetail` 加归档分支（详情弹窗多一行「归档时间」`archivedText`）、`updateEmptyText` 加归档文案并简化为两分支（不再有 done / active 分支）、`restoreSessionState` 合法 view 改为 `['all','archived','trash']`。
- **为什么**：用户要求「上面不要显示全部/未完成/已完成，改为 全部/已归档/垃圾桶；右下角的“清除已完成”改为“归档已完成”，点击后将已经完成放到归档那边」。
- **命名（用户问起，我定的）**：视图标签「**已归档**」、按钮与动作「**归档已完成**」、归档项上的按钮「**取消归档**」——不用「清除 / 还原」：数据并未删除、只是收起来，且「还原」已属垃圾桶语义。已写进 CONTEXT.md「命名约定」。
- **设计决策**：归档用**新增时间戳字段**而不是改 `done` 或加独立数组（与 `deletedAt` 同构、一行字段搞定归档与取消归档，且与垃圾桶正交：归档项可再删进垃圾桶）；“已完成”不再是一个视图（用户要求去掉），而是在列表里以删除线 + 勾选状态呈现。
- **验证结论**（预览实测，全链路真实点击）：筛选标签为 `全部 / 已归档 / 垃圾桶 1`；点「归档已完成」→ 已完成的 `111111` 从列表消失、`已归档 1` 徒标出现、统计由「1 项未完成 · 共 2 项」变「1 项未完成 · 共 1 项」、侧栏「全部任务 / 默认」计数同步由 2 → 1、按钮马上变禁用态；切「已归档」→ 说明行 + 条目行高与其他视图一致、图标 svg 已渲染（20×20）、副标题「默认 · 归档于 10-09 15:44 · 创建于 10-08 16:06」、底栏「已归档 1 项」；点正文开详情 → 状态「已归档（已完成）」且「归档时间 10-09 15:44」有值（未归档为 `—`）；点「取消归档」→ 回列表且勾选状态保留、徒标归零、空状态文案「归档箱是空的 📦 …」正常；在归档视图点删除 → 5 秒倒计时（归档图标行、pending 样式）→ 进垃圾桶（`垃圾桶 2`）→ 垃圾桶点「还原」→ 回到**列表**（而不是归档箱）；清 `sessionStorage` 并硬刷新后，用户原有数据与视图均正常（`222222` 未完成、`111111` 已完成在列表，`22222` 在垃圾桶），控制台无应用报错。
- **踩到的坑（已沉淀 `pitfalls/015`）**：改完 CONTEXT.md 后想省 token、用 `preview eval` 里 `fetch('./CONTEXT.md')` 复核，结果读到全是旧文本，一度误以为 edit 未生效——**预览域里的文件是「最近一次 `action=app` 推送时的快照」**，重推后立即读到新内容。已写入 AGENTS.md「预览取证纪律」第 ③ 条。
- **文档**：CONTEXT.md——定位、使用指南右栏第 6 条（视图筛选三视图说明）与第 11 条（底栏三套 + 命名约定）、第 8 条（详情时间字段）、数据模型（`archivedAt` 与生命周期说明、Todo 字段表、detail 快照字段）、getter 表（视图 getter / `activeTodos` / `archivedTodos` / `badge` / `scoped` / `visibleTodos` / `doneCount`）、方法表（`archiveDone` / `unarchiveTodo` / `restoreTodo` / `timeMeta` / `buildDetail` / `groupCountText`）、页面骨架（三套视图模板结构）、关键流程（归档流程 + 改动数据列表 + 会话状态合法值）、核心链路（⑪ 标注旧功能、⑦ 补充、新增 ㉒）；新增 `pitfalls/015` 并登记索引。

### 2026-10-09 · 修分组行点击区偏小 + 「全部任务」计数不对齐（用户截图反馈）

- **改了什么**：`pages/home.html`——① `.gitem` 垂直内边距由 `padding: 4px 4px 4px 10px` 改为 `0 4px 0 10px`，`.gname` 加 `align-self: stretch; min-height: 34px; display: flex; align-items: center`（行高由内层撑起、不再是文字高度）；② `.gcount` 加 `cursor: pointer`，模板里行名与计数的 `on:click` 都绑 `setGroup`（「全部任务」行与 `o-fill` 分组行两处）；③ 「全部任务」行末尾新增等宽占位元素 `.gmenu-ghost`（34×34，`aria-hidden`，新增 CSS）撑出与 ⋯ 按钮一致的位置。
- **为什么**：用户截图反馈两点——“左侧的点击区域不太对，item 偏上和下的地方，点击不了”、“那个全部任务的 item，数字没有和下面的对齐，有点突兀”。
- **根因**：① 点击绑在 `.gname` 上，而它是 `align-items: center` 下的非撑满项：实测**行高 42px、`.gname` 只有 28px**（分组行）/ 25px（名字较长时），所以字上下各约 7px 的死区；② 「全部任务」行没有 ⋯ 菜单（真实分组有 34px 宽 + 4px gap），所以它的计数右边缘在 **307**、下面各行在 **269**，相差 38px。
- **设计决策**：继续把点击绑在行内子元素（不改成整行 `.gitem`）——行内的 ⋯ 菜单点下去不能顺带切分组（不依赖 `stopPropagation`，见踩坑 006）；改为**把点击面积补到整行高**（垂直内边距从行移到 `.gname` + `align-self: stretch`）并把计数也纳入点击区，只剩右侧 34px 的按钮列不可点（它本就是按钮）。
- **验证结论**（预览实测）：四行（全部任务 / 默认 / 个人 / LINLEE）**行高均 42px**、`.gname` 高 **42px（与行等高）**、四处 `.gcount.right` **均为 269**；点行名切分组（全部任务→LINLEE 生效）、点计数也切分组、点 ⋯ 按钮不切分组且菜单正常弹开（菜单项 104×37）/ 收起（关闭后宽回 0、无弹窗残留）；⋯ 按钮仍 34×34、n-icon 19×19；`sessionStorage` 会话状态已清空，硬刷新后用户原有数据（列表 `222222` / `111111` + 垃圾桶 1 条）与侧栏宽度偏好 295px 不变；控制台无应用报错。
- **文档**：CONTEXT.md——使用指南左栏第 2 条（行高 42 / 点击区 / 计数对齐与两个历史 bug）、页面骨架（新增「行内四列结构」说明，并把 `.gname`/`.gcount` 双绑定写进点击绑定那条）、核心链路新增 ㉑；顺手纠正两处文档漂移（“三列网格 / 右列等宽留白”已不存、“≤1100px 去掉留白列”的媒体规则已删、“拖拽中任务区仍居中”已改为“随剩余宽度变化”）。

### 2026-10-09 · 刷新保留当前分组 / 筛选（用户要求用 sessionStorage）

- **改了什么**：`pages/home.html`——① 新增常量 `SESSION_KEY = "todo-ui-state"`；② 新增 proto 方法 `sessionSnapshot()` / `saveSessionState()` / `restoreSessionState()`；③ `setGroup()` / `setView()` / `deleteGroup()`（删的正是当前浏览的分组时）末尾调 `saveSessionState()`；④ `ready()` 改为 **`async`**，依次 `await loadUi() / loadGroups() / loadTodos()` 后调 `restoreSessionState()`（恢复时要校验分组是否存在，所以必须排在 `loadGroups()` 之后）。状态内容：`{ view, groupFilter }`。
- **为什么**：用户反馈“现在刷新的时候，状态没有被记录。例如左侧列表，点击后，刷新又变成全部”，并明确要求“可以将状态保留在 sessionStorage”。
- **⚠️ 豁免记录（AGENTS.md「豁免规则」）**：项目硬性约定是「数据持久化统一用 `/nos/storage/main.js`，禁止浏览器 storage」。本回合**经用户明确要求**改用 `sessionStorage`，已向用户说明约定与后果（仅在当前标签页会话内有效：刷新保留、关标签页 / 新开窗口回到默认；不同窗口与手机端不同步）。语义上正好匹配用户诉求（刷新不丢，新会话从默认开始），而存 `/nos/storage` 会变成“关掉再打开也停在旧分组”（超出用户预期）。**后续会话不得把它“修正”回 `/nos/storage`**；若用户改口要求跨会话保留，再把键搬进 `ui` 键。
- **验证结论**（预览实测）：点「个人」分组 → `sessionStorage` 写入 `{"view":"all","groupFilter":"gmv0ez7bm736"}`；再切「已完成」→ 写入 `view:"done"`；**单独发 `location.reload()` 后重新取证** → 分组仍高亮「个人」、视图按钮仍是「已完成」（filled）、空状态文案「「个人」里还没有完成的任务」；边界：手动把 `groupFilter` 写成不存在的 id + `view` 写成 `trash` → 刷新后分组回落「全部任务」、视图仍为垃圾桶（4 个候选值校验正常）；清掉 `sessionStorage` 刷新 → 回到默认（「全部任务」+「全部」）；装了 `error` / `unhandledrejection` 记录器跑完上述流程 → **无应用报错**；测试后已把 `sessionStorage` 清空（不把测试状态留给用户），硬刷新后为用户原有数据（列表 `222222` / `111111` + 垃圾桶 1 条），侧栏宽度偏好 295px 未动。
- **文档**：CONTEXT.md——使用指南右栏第 6 条（筛选）补「当前筛选与选中分组会被记住」及清理规则、数据模型持久化节补 `sessionStorage` 说明与豁免提醒、方法表补 3 个新方法并修正 `setGroup` 描述、关键流程补启动顺序（`ready` 改 async）与「会话状态」流程、核心链路新增 ⑳。

### 2026-10-09 · 添加任务新增「AI 添加」：一句描述自动生成标题 + 描述（用户需求）

- **改了什么**：`pages/home.html`（仅此一个文件）——① 添加弹窗下半部分新增虚线分隔的 **AI 区 `.ai-box`**：说明行（`n-icon mdi:auto-fix`）+ `st-textarea.ai-field`（2 行、`sync:value="aiDraft"`）+ 右对齐「AI 生成」`st-button`（`prefix` 槽 `mdi:creation`、`attr:disabled="aiDisabled"`）+ `.ai-note` / `.ai-error` 两行提示；② data 新增 `aiDraft` / `aiLoading` / `aiNote` / `aiError`，proto 新增 getter `aiDisabled` / `aiButtonLabel` 与方法 `getAssistant()` / `parseAiReply(content)` / `generateWithAi()`，模块顶层新增 `AI_SYSTEM_PROMPT` 常量；③ `openAdd` / `closeAdd` 一并重置 AI 区字段。
- **为什么**：用户要求“在添加任务那里，增加一个 AI 添加任务的功能，输入功能描述，AI 自动根据内容添加 title 和描述”。
- **设计决策**：AI **只负责生成内容、不直接落盘**——生成结果回填到上方已有的多行输入框（保持“首行标题、其余为描述”的既有格式），由用户确认后点「添加」走原有 `addTodo()` 单一写入路径（用户可改、不丢控制权，也不破坏既有数据流）；AI 走平台 `/mz/ai/main.js` 的 `getAssistant().chat()`（预览域由能力桥替身接管，应用零配置）；**不传 `model` / `thinking`**（模型与档位用宿主当前配置，且 kimi-k3 传 thinking 会报错）；提示模型只输出 `{"title","desc"}` JSON，解析失败时回退到多行文本解析后仍可用；`_assistant` 懒加载缓存，不让页面启动多一次加载。
- **验证结论**（预览实测）：`preview action=app` 推送后无报错；开弹窗 → AI 区宽 440、描述框 440×74、空描述时「AI 生成」禁用；输入「明天下午三点和客户开会，需要提前准备报价单和合同附件，还要通知设计部同事一起参加」→ 点「AI 生成」→ 按钮变「AI 生成中…」且禁用、提示「AI 正在整理标题和描述…」→ 很快回填标题「准备客户会议及通知设计部」+ 3 行描述、提示「AI 已生成，确认或改一改再点「添加」」；点「添加」后列表首条标题 / 描述分别是模型的 title / desc（多行描述正确保留）、弹窗自动关闭；实链写入的测试条目已用「5 秒倒计时 → 垃圾桶 → 彻底删除（含二次确认）」清理，硬刷新后存储回到**用户原有 3 条**（`222222` / `111111` 在列表、`22222` 在垃圾桶），弹窗重开时 AI 区字段全部为空、「AI 生成」禁用；控制台 **无应用报错**（仅 `[bridge-link]` 噪声，含 `[ai] 生成完成…` 埋点）。
- **踩到的坑（已沉淀 `pitfalls/014`）**：① 在 `preview eval` 里 `location.reload()` 后 `await` 取证 → 该条指令 **30s 静默超时**（reload 断开了调试桥，promise 永不 resolve），硬刷新必须单独发一条 eval 再另发指令取证；② `$deep('.item')` 会穿进 `st-menu` 面板的 shadow 命中组件内部的 `.item`（没有 `.text` 子节点）→ 后续 `.textContent` 报 null，取证页面自有节点要先把根限定为页面 shadowRoot（`$deep('.shell')[0].getRootNode()`）。已同步写入 AGENTS.md「硬性约定」。
- **文档**：CONTEXT.md——定位、使用指南右栏第 5 条（新增 AI 添加子条）、data 表（4 个新字段）、计算属性表（`aiDisabled` / `aiButtonLabel`）、方法表（3 个新方法 + `openAdd`/`closeAdd` 说明）、页面骨架（添加弹窗内两段结构与绑定层级）、关键流程（新增「AI 添加」条目）、核心链路（新增 ⑲ 并归位编号）、踩坑索引（014）。

### 2026-10-09 · 修掉「侧栏拖宽后任务区浪费右侧空间」（用户截图反馈）

- **改了什么**：`pages/home.html` 样式——`.shell` 由**三列网格** `auto minmax(0,1fr) auto` 改为**两列** `auto minmax(0,1fr)`；**删除 `.spacer` 留白列**（元素 + CSS + `≤1100px` 的媒体规则）；`.main` 的 `max-width` 由 `880px` 改为 `1200px`（保留超宽屏行宽限制）；并**删掉重复定义的第二块 `.main` 规则**（旧规则的 `880px` 静默覆盖了新值，详见 `pitfalls/013`）。功能零改动。
- **为什么**：用户截图反馈「我左边放大了的话，你右边主要区域，并没有好好利用我这个区域的位置，浪费了空间」。根因是为了让任务区落在**视口正中**而加的那列与侧栏等宽的留白（`.spacer`）+ `880px` 上限，侧栏一拖宽，右侧就白丢一大块。
- **设计决策**：任务区改为**吃满剩余宽度**（`1fr` + `width:100%`），只在超宽屏用 `max-width: 1200px` 限制行宽；不再为了“视口居中”而留白——**空间利用优先**，侧栏拖多宽都不会浪费。
- **验证结论**（预览实测，视口 1180）：侧栏 300px 时任务区宽 **828px**（= 1180-16-300-20-16，右侧只剩页面 padding 16px）、条目宽 828（吃满）、列模板 `300px 828px`、`.spacer` 已不存在、`maxWidth` 读到 **1200px**；拖拽回归：300→220px 时任务区 **908px**（同步变宽）、手柄位置 246；将宽度拖回 300 并落盘 `ui.sideWidth = 300`（保持用户原值）；功能回归：添加任务（标题+描述、条目宽 828）、5 秒倒计时入垃圾桶、垃圾桶彻底删除二次确认→确认删除，测试条目已彻底清除；控制台无应用报错；存储最终为你原有 3 条（`222222`、`111111`、垃圾桶里的 `22222`）。
- **踩到的坑（已沉淀 `pitfalls/013`）**：页面样式表里存在**两块 `.main` 规则**，后出现的那块把 `max-width` 拉回 880px，改代码后 `getComputedStyle` 不生效且无报错；定位方法是把页面 `<style>` 文本拿出来过滤 `.main` / `max-width` 行数一遍（注意 shadowRoot 里有两个 `<style>`，要挑含 `.shell` 的）。
- **文档**：CONTEXT.md——定位、使用指南开头的布局说明（含「不要再加回留白列」的历史坑提醒）、「宽度与空间利用」、可拖拽宽度与关键流程描述、核心链路 ⑱ 全部改为两列/吃满剩余宽度；新增 `pitfalls/013` 并登记索引。

### 2026-10-09 · 继续：全链路复核 + 补齐「侧栏可拖拽宽度」的文档

- **本回合做了什么**：用户说「继续」。先读文件发现代码已被后续会话演进到（可拖拽侧栏宽度 `.resizer` + `data.sideWidth` + `ui` 存储键、分组行内 ⋯ 菜单、n-icon 图标、三列网格让任务区居中），**但这些改动没被写进 CONTEXT/MEMORY**（CONTEXT 仍写死 `190px` 三列、存储只记两个键），于是：① 用 preview 工具把当前版本从头实测一遗；② 补齐文档；③ 新增 `pitfalls/012`。本轮**未改任何应用代码**。
- **实现复核结论**（预览实测）：布局：侧栏 x=16 宽 150px（用户此前拖到的最小值）贴左、任务区居中（中心偏移 < 20px）；拖拽手柄：`PointerEvent` 拖动 150→220px 生效、`ui.sideWidth` 落盘 220、任务区仍居中，拖动中 `.shell` 带 `resizing` + `user-select: none`；新建/改名/删除分组：⋯ 菜单两项均正常（默认分组「删除」置灰）、改名弹窗预填原名且保存后侧栏同步、删除分组二次确认（取消不删 / 确认后任务移入默认）；任务侧：多行添加（标题 + 描述分行正确、弹窗提示归属分组）、勾选完成（副标题出现「完成于 …」）、详情弹窗（分组/状态/三个时间 + 底部仅「关闭」）、删除 5 秒倒计时（图标 `mdi:close` → `mdi:reply`、pending 样式、到点入垃圾桶、撤销可用）、垃圾桶还原、彻底删除二次确认（取消不删、确认后从垃圾桶消失）；硬刷新后数据仍在；控制台 **errors: 0**。
- **测试数据已全部清理**：测试任务已彻底删除、临时分组已删；**我临时把用户分组名「个人」改成「个人事务」后已改回「个人」**；侧栏宽度已恢复为拖动测试前的 150px。存储最终为：`todos` 3 条（`222222` 未完成、`111111` 已完成、`22222` 在垃圾桶，均属默认分组）、`groups` 3 个（默认 / 个人 / LINLEE）、`ui` `{sideWidth: 150}`。
- **文档补齐的内容**：CONTEXT.md——一句话定位加「宽度可拖拽 150–300px」；使用指南开头改写三列 grid（`auto minmax(0,1fr) auto` + `sideWidth` 驱动、右侧留白列）、左栏新增第 4 条「调整侧栏宽度」并把右栏条目重编号为 5–11；数据模型存储改为**键三个**并补 `ui` 键与 `SIDE_MIN_W/SIDE_MAX_W/SIDE_DEFAULT_W` 常量；data 表补 `sideWidth` / `resizing`；方法表补 `clampSideWidth` / `loadUi` / `saveUi` / `startResize`；页面骨架补「可拖拽的侧栏宽度」与修正后的「宽度与对齐」；关键流程补 `loadUi()` 与「侧栏宽度」流程；核心链路补第 ⑱ 条。
- **踩到的坑（已沉淀 `pitfalls/012`）**：自测拖拽时把 `resizing` 类查在了 `.side` 上（实际挂在外层 `.shell`），一度误判拖动未生效；拖拽的 `pointermove` 必须派发到 `window`（且 `pointerdown` 要带 `button: 0`）；以及**拖完必须把 `sideWidth` 改回用户原值**（它是用户偏好，已写进存储）。

### 2026-10-08 · 分组行 ⋯ 菜单的两项加上前置图标（用户截图反馈「这里的 menu 也要 icon」）

- **改了什么**：`pages/home.html`——`st-menu` 内的两个 `st-menu-item` 各加 `<n-icon slot="prefix">`：「重命名」用 `mdi:pencil`、「删除」用 `mdi:delete-outline`；CSS 新增 `st-menu-item n-icon { font-size: 1.15em }`（与 `st-button n-icon` 同规则，菜单项字号 14px → 图标实测 16.1px）。
- **为什么**：用户看到分组行下拉菜单里只有纯文字，要求菜单项也配上图标（延续上一回合「功能图标统一 n-icon」）。
- **验证结论**（预览实测，`preview` 工具 `eval`）：两项图标均 16.1×16.1、`svg` 已渲染、位于菜单项内（菜单项 106×37）；**点图标本身（向 `n-icon` shadow 里的 `svg` 派发冒泡 click）也能触发操作**——「重命名」→ 弹窗 headline「改名分组：「默认」」，临时建「图标测试组」后点删除图标 → 弹窗「删除分组「图标测试组」？」；默认分组的「删除」禁用时点图标**不弹窗**（拦截仍生效），图标随组件自带 `.item { opacity: 0.38 }` 与文字一起变淡；测试分组已清理（`.gitem` 回到 2 行）；硬刷新后存储仍为 `groups` 1 个 / `todos` 2 条，控制台 **errors: 0**。
- **复查依据**：`st-menu-item` 支持 `prefix` / `suffix` / `sub-menu` 槽（已读 senti-ui `references/components/menu.md`）；禁用态视觉由组件内部 `.item` 的 `opacity: 0.38` 承担（实测 shadow 内部 `.item` opacity=0.38、宿主 `opacity` 仍为 1），所以不需要给禁用项另写图标灰化样式。

### 2026-10-08 · 页内剩余 emoji 功能图标统一换成 n-icon（收尾上一回合的遗留项）

- **改了什么**：`pages/home.html`——h1 前置 `<n-icon icon="mdi:check-circle-outline">`（CSS：`h1` 改 flex 对齐 + `h1 n-icon { font-size: 1em; color: var(--md-sys-color-primary) }`）；「添加任务」「新建分组」改用 `st-button` 的 `prefix` 槽放 `mdi:plus`、筛选栏垃圾桶用 `mdi:delete-outline`（统一 `st-button n-icon { font-size: 1.15em }` 与 14px 文字齐高）；列表删除按钮原 `deleteButtonIcon()`（返回 `"↩"`/`"✕"` 文本）改为 **`deleteButtonIconName()`** 返回 Iconify 名（`mdi:reply` / `mdi:close`），模板改成 `<n-icon attr:icon="$host.deleteButtonIconName($data)">`；垃圾桶「彻底删除」按钮的 🗑 换 `mdi:delete-outline`（`title` 顺带改为「彻底删除：<标题>」）；`timeMeta` 的倒计时文案去掉 🗑 前缀及其句式改为「点撤销按钮可撤销」。
- **为什么**：上一回合 MEMORY 的遗留项（「页内其它图标仍是 emoji，若后续要求统一需一并替换」）+ AGENTS 硬性约定「UI 图标用 `n-icon`，不用 emoji 充当功能图标」；用户本回合说「继续」。
- **验证结论**（预览实测，`preview` 工具）：`eval` 量得 h1 n-icon **26×26**（与 h1 同字号、内部 svg 已渲染）、三个 prefix 图标各 **16.1×16.1**、删除按钮 40×40 内图标 **22×22**（颜色继承 `currentColor`）；点删除按钮 → 图标变 **`mdi:reply`** + title「撤销删除」+ 副标题「默认 · 5 秒后移入垃圾桶（点撤销按钮可撤销）」+ pending 样式，再点 → 回 `mdi:close` 且无 pending 残留（撤销已落盘，硬刷新后仍 2 条）；垃圾桶条目「彻底删除」图标 `mdi:delete-outline`、title「彻底删除：22222」；「添加任务」/「新建分组」弹窗点开 → headline 正确 → 点「取消」关闭，无残留；硬刷新后 `[group] 已读取分组，共 1 个` / `[storage] 已读取待办，共 2 项`，控制台**无应用报错**；存储直读核对：`todos` 2 条（`111111` 未完成、`22222` 在垃圾桶）、`groups` 仅「默认」，**用户数据未被测试污染**。
- **踩到的坑（已沉淀 `pitfalls/011`）**：想裸读 IndexedDB 核对落盘时用 `getStorage` 的 id 当库名 → 打开得到空库、`transaction('keyval')` 在 `onsuccess` 里抛错、promise 永不 resolve，`eval` **30s 静默超时**；正确库名是 `nos-storage-conjure-todo-app`、仓库名 `main`（记录形如 `{key, value}`）。
- **遗留**：`＋` 已无 UI 残留（只剩 CSS 注释里）；空状态文案里的 🎉 等属文案装饰，保留。

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
