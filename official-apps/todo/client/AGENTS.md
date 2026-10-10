# AGENTS.md — 先帮我写一个简单的todo应用，后面我再提需求

给 AI 代理的**硬性规范**（随会话自动注入，必须遵守）。会话开始的读取顺序：

1. **CONTEXT.md** —— 项目事实与使用指南（活文档，维护规则见「文档同步规则」）；
2. **MEMORY.md** —— 恢复记忆：此前改过什么、为什么、遗留问题（「记忆体规则」）；
3. **踩坑索引**（CONTEXT.md 内）—— 按标题判断本回合可能相关的坑，按需精读（「踩坑库规则」）。

## 硬性约定

- 技术栈固定：ofa.js（无构建步骤）+ senti-ui（M3 组件）+ o-router 微应用结构；依赖一律走 CDN `/gh/ofajs/...@latest`，禁止引入打包器、npm 依赖或额外运行时。
- 目录职责：`index.html`（入口，勿改结构）、`app-config.js`（只导出 `home`）、`pages/*.html`（页面模块）。
- **页面模块内运行时加载 `/nos/*`（如 storage）必须用页面工厂参数注入的 load**：`export default async ({ load }) => { const { getStorage } = await load("/nos/storage/main.js"); }`；**禁止 `lm(import.meta)`**——页面脚本被编译成 `data:` URL 模块执行，`import.meta` 不能作 URL base，解析任何路径都抛 Invalid URL，会让整页加载失败且报错不带原因。
- **write_file 是整文件覆盖，改前保证手上有当前完整内容**：只发片段会把整个文件截断成残片。上下文里已有该文件的完整当前内容（本会话刚 read_file 过且无变更迹象，或自己刚 write_file 写入过）→ 直接基于上下文里的内容改、**不重复 read_file**（省 token）；首次修改、上下文经过压缩摘要、或对内容没把握 → **先 read_file 再改**——多读一次的代价远小于凭模糊记忆整体重写丢内容的返工。
- **页面模块的 `:host` 必须是滚动容器**（`height:100%; overflow-y:auto`）——`o-router fix-body` 给自身 shadow 写死了 `overflow:hidden`，删掉这条整页无法滚动。
- 颜色只用 M3 变量 `--md-sys-color-*`；canvas 里绘制的色值属于图片内容，不受此约束。
- **关键路径埋 console 定位点**：开发代码时给重要位置写日志，供排查时用 preview 工具（action=console）快速定位——至少覆盖：入口初始化、关键数据流转、外部回调（文件 / 事件响应）、catch 错误分支（`console.error` 连同 err 一起打）。格式带统一模块标签（如 `console.log("[init]", ...)`），与预览通道的 `[bridge-link]` 噪声天然可区分；定位点**常驻保留**，临时性 debug 日志用完即删、不刷屏。
- **改 `pages/*.html` 里 `proto` 的方法名 / 删方法后，必须全文件核对模板引用并在推送后读控制台**：模板的 `on:click="xxx"` / `{{$host.xxx(...)}}` / `attr:xxx="$host.xxx(...)"` 都是运行时按名字找方法的，对不上只会抛 `Event binding error: function "xxx" not found`——页面照常渲染、只有那个交互失效，肉眼极难发现（见 `pitfalls/003-template-callback-must-exist.md`）。所以「按钮点了没反应」先查控制台，不要先怀疑组件。
- **定制 senti-ui 组件尺寸时只改尺寸类属性，不覆盖组件依赖的布局属性**：例如给 `st-input` 定宽只写 `width` / `min-width`，**不要写 `display`**——组件内部靠自己的 `:host { display: inline-flex }` 让原生 input 用 `flex: 1` 撑满，页面样式表会压过 shadow 的 `:host` 规则，被覆盖后外框看着照旧、真实可输入区却缩成 156px（见 `pitfalls/004-st-input-display-override-and-frozen-anim.md`）。
- **`st-dialog` 等组件内部只用属性访问，不用 `$host.方法()`**：弹窗内部 `$host` 不指向页面实例，`{{$host.xxx()}}` / `attr:x="$host.xxx()"` 会**静默渲染为空**（不报错，而同一弹窗里 `{{data.字段}}` 却正常）——展示文案与布尔标志应在打开弹窗时预计算进 data 快照，模板只读字段（见 `pitfalls/005-host-in-dialog-not-page.md`）。
- **页面根级绑定写裸方法名 / data 字段，只有 `o-fill` / `o-if` 内部才用 `$host.方法()`**：根级写 `$host.xxx()` 会在 `class:` / `attr:` 等表达式指令上报 `Error evaluating element expression` 且绑定静默失效（`on:click` 有时能跑，但不要依赖），见 `pitfalls/006-host-in-root-level-binding.md`。
- **UI 图标用 NoneOS Core 的 `n-icon`（`<l-m src="/nos/n-icon/n-icon.html"></l-m>` + Iconify 名如 `mdi:pencil`），不用 emoji 充当功能图标**：颜色随 `currentColor` 继承、自动适配主题。若把 `n-icon` 放进 `st-icon-button` 等自带 `::slotted` 字号规则的组件里，**不要再给 `n-icon` 写 `width` / `height` / `font-size`**（会与组件规则叠加把图标撑出按钮），缩放只改外层按钮的 `font-size`（见 `pitfalls/009-n-icon-inside-st-icon-button-sizing.md`）。
- **`:hover` / 指针悬停类改动不能声称“已实测”**：预览窗口跑在后台标签页时浏览器不更新指针状态，`getComputedStyle(...).opacity` 等量不出悬停效果（同「弹窗动画被冻结」的成因）。做法：用旁证证明样式路径通（如选择器已生效的 em 尺寸），并给无 hover 设备 `@media (hover: none)` 兜底，然后在回复里**明确告诉用户这部分需他本人在前台用鼠标确认**，不要反复改代码（见 `pitfalls/010-st-menu-self-test-traps.md`）。
- **豁免规则（硬性约定与用户指令冲突时）**：用户明确要求的做法与某条硬性约定冲突时，**既不死守也不悄悄违反**——先向用户说明该约定存在的原因与违反的后果，用户仍坚持则按用户的决定执行，并**在 MEMORY.md 里记录这次豁免**（哪条约定、为什么豁免），防止后续会话的 AI 把它当成违规「修正」回去。
- **核对数据是否真正落盘，首选「硬刷新 + 读埋点日志」（`[storage] 已读取待办，共 N 项` / `[group] 已读取分组，共 N 个`），不要裸读 IndexedDB**：NoneOS 存储的库名是 `nos-storage-<getStorage 的 id>`、仓库名是 `main`（记录形如 `{ key, value }`）。拿 `getStorage` 的 id 当库名只会打开一个**空库**，随后 `transaction()` 在 `onsuccess` 里抛错会让 promise 永不 resolve，使 `preview eval` **静默超时 30s**（无报错、无返回值，极易误判为应用卡死，见 `pitfalls/011-nos-storage-indexeddb-shape.md`）。
- **`<o-fill>` / `<o-if>` 等框架节点会插在 DOM 中间，且它们是 `display: contents`（rect 全为 0）**：需要拿布局容器的几何时用**语义选择器向上找**（`el.closest('.list')`），**禁用 `el.parentElement` 猜层级**；否则会拿到全 0 的 rect，让坐标计算（浮层定位、碰撞判定）整体跑偏且不报错（见 `pitfalls/016-o-fill-display-contents-rect-zero.md`）。能用「元素自身的边缘（伪元素 / 边框）」表达位置时，优先用这种不依赖坐标的方案。
- **预览取证的几条纪律**：① **不要在 `preview eval` 里 `location.reload()` 后又 `await`**——reload 会销毁页面上下文并断开调试桥，该次指令必然静默超时；硬刷新要单独发一条 `preview eval`（`location.reload(); return "reloaded"`），再用新指令取证。② **`$deep` / `$deep` 会穿进页面内嵌组件的 shadow**，命中同名类（如 `st-menu` 面板里的 `.item`），表现为“取到的元素没有预期子节点”或数量对不上；取证页面自有节点时先把根限定在页面 shadowRoot（`const root = $deep('.shell')[0].getRootNode()`），再用 `root.querySelectorAll(...)`，`$deep` 只用来找锚点元素（见 `pitfalls/014-preview-eval-reload-and-deep-selector-traps.md`）。③ **预览域等于「最近一次 `action=app` 推送时的快照」**：推送之后对源文件的修改不会同步进去，因此**不要在没有重推的情况下用 `fetch('./CONTEXT.md')` 这类方式复核刚写的文档**（会读到旧副本，误以为 edit 没生效）；复核源文件用 `read_file`，想用 fetch 按行号查关键词就先 `action=app` 重推一次（见 `pitfalls/015-preview-static-file-snapshot.md`）。④ **`action=app` 报 `ACK timeout after 4 retries` 不等于推送失败**：先用 `eval` 查页面 shadowRoot 里新模板的文案 / 类名是否已出现（**判据用模板 DOM，别搜 `<script>` 里的代码**——ofa 不把 script 内容留在 innerHTML 里），已生效就直接继续调试，**不要反复重推**（见 `pitfalls/020-preview-app-push-ack-timeout-not-fatal.md`）。⑤ **临时改预览数据的备份必须存 `localStorage` / `sessionStorage`**（挂 `window` 会被 `reload` 抹掉），且还原前先判空——`setItem(key, undefined)` 会把用户数据清空且不报错（见 `pitfalls/021-temp-preview-data-backup-must-survive-reload.md`）。

- **重要功能必须带场景测试**：新增或修改交互流程 / 数据存取 / 核心逻辑时，在 `client/test/` 下同步写或更新 .test.json 场景用例（步骤格式见宿主系统提示词「场景测试」节），并用 preview 工具 action=run-tests 跑到全绿才算完成；纯样式微调可豁免。
- **场景测试用例的写法（本项目统一约定，详见 CONTEXT.md「场景测试」节）**：① `name` 用 ≤12 字短功能名、一文件一主流程，细节写进 `desc`；② 辅助函数**只在一处挂到共享上下文 `T` 上**（`T.q` / `T.btn` / `T.dlgBtn` / `T.addTask` / `T.drag` …），后续步骤直接用 `T.xxx(...)`、**禁止重复定义**；③ **`reload` 之后的步骤不依赖 `T`**（reload 会重置 T），一律用 `document.querySelector('o-page').shadowRoot` 直查；④ 断言写在 eval 里（抛错即失败），`expect` 只留 `consoleErrors: 0`——**不要用 `expect.count .item`**（宿主深查会穿进 `st-menu` 等组件 shadow 命中同名 `.item`，见踩坑 014）；⑤ **每个 `reload` 后面跟一个宿主侧数值等待 `{"wait": 1500}`**（选择器 wait 紧跟 reload 会在页面重载窗口里投递失败：宿主报 ACK timeout / wait 超时，见踩坑 019）；就绪轮询写在 eval 里、锚点用常驻节点（本项目 `.shell`，**不要用 `.item` 这类合法可能为空的节点**）；长等待（倒计时 5–6 秒）单独占一个数值 wait 步骤，不要与其它 eval 混在一条指令里；⑥ 首步 `T.wipe()`（先把 dirty 状态的备份还原、再备份并清空自身存储 + `sessionStorage`）→ `reload`，末步从备份 restore 用户数据；**跑完必须核对 `__todo_test_dirty` 已清、存储里用户数据已回来**（中断时 restore 不执行，用户数据会留在已清空状态）；⑦ 交互都走 T 的辅助函数（`st-button` 必须点到内部原生 button，踩坑 008）；⑧ 断言出现失败时**先用 preview 实测真实行为**再决定改用例还是改代码（踩坑 017）；⑨ 宿主未注入 run-tests 通道时用 `test/_driver.js` 按同一套语义分片回放（踩坑 018）。后续需求迭代时这些用例会反复重跑，是防止改错文件的主要防线。
- **改「视图数据范围 / 过滤口径」时必须先扫一遍模板里所有 `:value=` 绑定**：同一个视图的列表与计数可能来自不同的表达式（本项目垃圾桶列表曾绑未过滤的 `trashTodos`，而底栏计数 / 徒标 / 空状态已改成过滤后的 getter → 同一屏上“底栏 0 项”与“列表 1 条”并存，接口测试才暴露）。只改 getter 定义不算改完；改完用 `preview eval` 数 `.item` 条数与底栏计数对账，并跑场景用例（见 `pitfalls/022-同一视图可能有两个数据源绑定.md`）。
## 记忆体规则（MEMORY.md）

MEMORY.md 是 AI 的**连续性记忆（记忆体）**：跨会话的「上次做到哪、为什么这么做、还剩什么没做」全靠它衔接，断更会导致重复踩坑或推翻既有决策。

- **会话开始读**：紧随 CONTEXT.md 之后 `read_file` 读 MEMORY.md，恢复历史上下文（此前改过什么、为什么、验证结论、遗留问题）。
- **每回合改动后必须更新**：本回合只要改了代码或文档，收尾前就在 MEMORY.md **顶部**追加一条（日期 / 改了什么 / 为什么 / 验证结论）；纯讨论无改动则不记。
- **容量上限 50 条**：追加前若已满 50 条，先把**最旧的 20 条**压缩合并成 3–4 条再写入新条目。压缩只保留仍有用的信息——仍生效的决策与约束、用户明确过的偏好、未解决 / 待办的问题；丢弃已完成且不再影响后续的过程细节与重复的验证流水账。压缩条目标注「（含 N 条早期记录压缩）」。

## 踩坑库规则（pitfalls/）

踩坑记录一坑一文件，收在 `pitfalls/` 目录；索引（编号 / 标题 / 文件路径）在 CONTEXT.md「踩坑索引」表。坑会越积越多，**禁止一口气读全部**——按下面的时机按需读。

- **事前预防（动手前）**：开始任务前先过一遍 CONTEXT.md「踩坑索引」的标题，判断本回合任务可能踩到哪些坑；对得上号的，**先 `read_file` 对应 `pitfalls/NNN-*.md` 读完再动手**——提前花一次读取，省掉事后整轮排查。
- **卡住回查（多次失败时）**：同一个问题连续多次尝试都无法解决时，**不要继续盲试**——回头通读「踩坑索引」全表标题，看有没有以前踩过、可直接套用的解法；命中就按该条的「正确姿势」执行，再验证。
- **索引无命中时**：先凭自己的能力有节制地排查（换角度取证、缩小范围做最小实验，而不是同类改法反复试）；仍解决不了，就把「期望什么 / 实际什么 / 已试过哪些方案与结果 / 当前怀疑」整理成一段话**向用户求助**，不要无限消耗回合。
- **事后沉淀（难题解决后必须记录）**：踩到新坑、或难题经过多次尝试才最终解决的，都必须记录到踩坑集合——在 `pitfalls/` 新建 `NNN-英文短横线-slug.md`（NNN 三位编号顺延），按「症状 → 根因 → 正确姿势」三段组织（难题类把**尝试过的弯路与最终有效的那一步**写进根因/姿势里），标题行写 `# NNN · 一句话概括`；**同时**在 CONTEXT.md「踩坑索引」表末尾追加一行。
- **编号与文件名一经创建不再改**（引用稳定）；旧坑内容过时就地修正对应文件，不让索引与文件失配。

## 文档同步规则

### CONTEXT.md 活文档规则（核心）

CONTEXT.md 是项目知识的**活文档（living document）**，必须与代码保持一致：

> 一句话总结：**代码怎么变，CONTEXT.md 就怎么改，始终保持一致。**

- **凡是修改了项目内的文件**（新增 / 删除 / 重命名文件、改动入口、变更技术栈、调整数据模型 / 关键常量、重构结构等），**都必须同步更新 CONTEXT.md** 对应小节。
- **发现错误即纠正**：阅读源码后若发现 CONTEXT.md 的描述与实际代码不符（信息过时、描述错误、字段名 / 路径写错、行为说明有误），即便该错误不是本次任务引入的，也**有责任顺手修正**，避免继续误导后续的 AI。
- **删除模块要同步清理**：删除了某个文件、目录或整块功能，必须把 CONTEXT.md 中对应的目录结构树、文件说明、踩坑索引表条目等内容一并移除，不能残留对已不存在之物的描述。
- 更新范围包括但不限于：目录结构树、文件说明、技术栈、数据模型、关键流程、关键常量与行为描述、踩坑索引表。
- **路径写法统一用相对路径**：在 CONTEXT.md、AGENTS.md 及其他文档中引用项目内文件时，一律使用相对路径（如 `pages/home.html`），**禁止使用 `file:///` 协议、绝对路径或带盘符的写法**，保证文档在不同环境、不同机器下通用可移植。
- 仅改动注释、格式等不影响语义的修改，可酌情不更新。

### AGENTS.md 自身的更新（只沉淀规则）

- 出现新的**全局硬性纪律**（对后续所有任务都成立的行为约束）→ 追加或修订本文件对应章节（「硬性约定」等）；规则写成可执行约束，不掺项目细节。
- **记忆与说明类内容不进 AGENTS.md**：一次性的过程记录归 **MEMORY.md**（做了什么），项目事实与使用指南归 **CONTEXT.md**（是什么）。
- 「完成标准」中的核心链路清单随功能演进同步更新，保证判据始终覆盖当前功能。

## 完成标准（必须实测，不能只看代码）

**实测手段**：本项目运行在 Mazmot 妙造（conjure）的隔离预览窗口中，用 **preview 工具**做实测——它是推送运行 + 读控制台 + 查 DOM + 模拟交互的调试通道，下面的判据都通过它执行。支持多个预览窗口（本机窗口 + 用户手机扫码设备，上限 10 个）：多窗口排查先用 `action=windows` 列窗口，再用顶层 `winId` 定向到某个窗口；省略 `winId` 的指令投递给最近活跃的在线窗口。用户报告「手机上不对」时，先 `windows` 找到移动设备窗口再定向取证。

1. `preview action=app` 后应用能打开；
2. `preview action=console` 无应用报错（控制台会被 `[bridge-link]` debug 噪声刷屏，判断应用错误请装 `window.addEventListener('error')` 记录器再看，或读增量日志）；
3. 核心链路实测过（本项目核心链路以 CONTEXT.md「关键流程」为准，功能演进时同步扩充清单）：交互用 action=click / type 真实操作过，不是只看渲染；
4. **布局类改动必须实测滚动**：读 `o-page` 的 `scrollHeight` / `clientHeight` / `scrollTop`（设 `scrollTop=99999` 看能否到底），并确认滚到底后关键控件 rect 在视口内；
5. 本回合有代码 / 文档改动 → **MEMORY.md 已按「记忆体规则」追加记录**；踩了新坑或解决了多次尝试的难题 → pitfalls/ 文件与 CONTEXT.md「踩坑索引」已同步登记。