# 网页收藏夹（speed-dial）上下文说明

Speed Dial 风格的网页收藏夹应用：分组筛选、拖拽排序、AI 导入（从任意文本/文件中识别网址批量收藏）、AI 自动分组（按主题整理已有收藏），数据全部保存在本地（NoneOS storage）。本文件是本应用的**活文档**，与代码保持一致；修改代码必须同步更新本文件（规则见 [AGENTS.md](AGENTS.md)）。

> 注意：搜索框是**网络搜索**（输入关键词跳转所选搜索引擎，默认 Google，可切换 Bing / 百度 / DuckDuckGo，选择持久化），不是本地收藏筛选，本地筛选仅靠分组 chips；AI 导入 / AI 分组需联网且依赖宿主已配置 AI Key。

## 目录结构

```
speed-dial/
├── index.html          # 入口 HTML：加载 ofa.js + router + pui-global.css，挂载 o-app
├── app-config.js       # 应用配置：home 页面路径 + 页面切换动画参数
├── app.json            # 应用 manifest（name/version/entry/appConfig 等）
├── __app.json          # 应用市场分发元数据（name/icon/desc + files 文件清单）
├── AGENTS.md           # AI 代理开发规范（规则自包含）
├── CONTEXT.md          # 本文件
└── pages/
    ├── home.html       # 主页面：收藏卡片网格 + 分组筛选 + 删除/拖拽排序 + 持久化
    ├── dial-form.html  # 添加/编辑弹窗页面模块（内嵌于 home 的 o-page，保存经 dial-save 事件上抛）
    ├── ai-import.html  # AI 导入弹窗页面模块（内嵌于 home 的 o-page，识别结果经 ai-import-save 事件上抛）
    ├── ai-group.html   # AI 自动分组弹窗页面模块（内嵌于 home 的 o-page，分组结果经 ai-group-apply 事件上抛）
    └── palette.js      # 图标底色八色板常量（dial-form 取色器与 AI 导入自动配色共用）
```

## 技术栈

- **ofa.js** 页面模块（`<template page>`），单页应用，无路由跳转
- **punch-ui** 组件：`p-input` / `p-button` / `p-split-button`（工具栏 AI 按钮：「AI 分组」为主操作、「AI 导入」为下拉子项） / `p-checkbox` / `p-dialog` / `p-menu`（`p-menu` + `p-menu-item`，home 的搜索引擎切换菜单）（l-m 从 `https://punch-ui-v2.pages.dev/packages/...` 加载）+ `util.js` 的 `toast` / `confirm`；AI 导入的多行输入用原生 textarea（p-textarea 自动增高不符合固定高度需求）
- **`n-icon`**（`/nos/n-icon/n-icon.html`）提供图标，底层 iconify；表单内的图标选择用 iconify 官方搜索 API `https://api.iconify.design/search?query=...&limit=32`（选中项存 iconify 图标名，运行时由 n-icon 联网渲染）
- **NoneOS storage**（`/nos/storage/main.js`）持久化，独立空间 `getStorage("speed-dial")`
- **AI 对话**（`/ai/main.js` 的 `getAssistant()`）：AI 导入功能用其从任意文本中提取网址；未配置 Key 时报错提示去「AI 密钥管理器」应用添加

## 数据模型

存储空间：`speed-dial`；唯一键：`dials`，值为 Dial 对象数组（按下标即展示顺序）：

```js
{
  id: string,        // `${Date.now()}-${随机串}`，创建时生成
  url: string,       // 已规范化的完整 URL（无协议时自动补 https://）
  title: string,     // 留空则自动取 hostname
  group: string,     // 分组名，空输入落库为 "未分组"
  color: string,     // 图标底色，取自 PALETTE 八色；空串 = 无底色（淡描边样式）
  icon: string,      // iconify 图标名（如 "mdi:github"），空串 = 首字母文字
  createdAt: number, // 创建时间戳
}
```

- **PALETTE**：`pages/palette.js` 导出的 8 个品牌色（dial-form 与 home 共用）；手动新增时按 `dials.length % PALETTE.length` 轮选取色（由 home 传 `count` 参数给 `openForm`），AI 导入落库时由 home 按当时 `dials.length` 轮选取色
- **"未分组"** 是保留组名：表单留空保存为 `"未分组"`，编辑回填时反向转回空串

存储空间 `speed-dial` 另有一个独立键 `searchEngine`（字符串）：搜索引擎 id，取值 `google`（默认）/ `bing` / `baidu` / `duckduckgo`，与 home 模块内 `ENGINES` 常量的 `id` 对应；非法值回落 `google`。

## 关键代码文件速查

| 文件 | 职责 |
|------|------|
| `index.html` | 入口：jsdelivr 加载 ofa.js `@latest#debug` + router，引 pui-global.css，`<o-app src="./app-config.js">` |
| `app-config.js` | 导出 `home`（页面路径）与 `pageAnime`（切换动画：opacity + 左右 30px 平移） |
| `pages/home.html` | 主页面：状态、计算属性、增删、拖拽、持久化；内嵌 `<o-page id="dial-form">`、`<o-page id="ai-import">` 与 `<o-page id="ai-group">`，分别监听 `dial-save` / `ai-import-save` / `ai-group-apply` 事件落库 |
| `pages/dial-form.html` | 添加/编辑弹窗页面模块：自带 `p-dialog` + 表单状态，暴露 `openForm()` 供宿主打开，保存时校验空 URL 并 `emit("dial-save")` 冒泡上抛表单值 |
| `pages/ai-import.html` | AI 导入弹窗页面模块：输入文本/选文件 → `getAssistant()` 提取网址 → 勾选后 `emit("ai-import-save")` 冒泡上抛所选列表 |
| `pages/ai-group.html` | AI 自动分组弹窗页面模块：接收宿主全部收藏 → `getAssistant()` 按主题划分分组 → 按组勾选后 `emit("ai-group-apply")` 冒泡上抛 `{id, group}` 列表 |
| `pages/palette.js` | 八色板常量 `PALETTE`，dial-form 取色器与 AI 导入自动配色共用 |
| `app.json` | manifest；`createdAt` 在分发时由 `__app.json` 的 replacements 替换 |
| `__app.json` | 分发清单：`files` 列出 app.json / index.html / app-config.js / pages 下五个文件 |

## home.html 页面要点

状态（`data`）：`dials`（收藏数组）、`activeGroup`（当前筛选组，`""` 为全部）、`draggingId` / `dropTargetId`（拖拽中）、`searchText`（搜索框输入）、`engineId`（当前搜索引擎 id，默认 `"google"`）、`engines`（模块级 `ENGINES` 常量注入，供 `o-fill` 渲染菜单）。弹窗状态（`dialogOpen` / `form` / `editingId`）已下沉到 `pages/dial-form.html`，AI 导入弹窗状态已下沉到 `pages/ai-import.html`。

搜索框（品牌图标与工具栏之间，`.search-bar` 居中 max-width 560px）：`p-input`（`sync:value="searchText"`，Enter 提交）+ prefix 插槽内 `p-menu`（`align="left"`）引擎切换——触发按钮显示当前引擎名 + `mdi:chevron-down`，菜单项由 `o-fill :value="engines"` 渲染（当前项文字高亮 `.engine-active`，点击调 `setEngine` 后菜单自动关闭）+ suffix 插槽 `mdi:magnify` 搜索按钮。

计算属性（`proto` getter）：

- `visibleDials`：`activeGroup` 为空返回全部，否则按 `dial.group === activeGroup` 过滤
- `groups`：由 `dials` 实时聚合出 `[{ name, count }]`，空 group 记作「未分组」
- `currentEngine`：按 `engineId` 从 `ENGINES` 查引擎对象，查不到回落 `ENGINES[0]`

关键方法（`proto`）：

- `onSearchKey(event)`：搜索框 keydown（keydown 是 composed 事件，可穿透 `p-input` shadow），Enter 触发 `doSearch()`
- `doSearch()`：`searchText` trim 非空时 `location.href = currentEngine.url + encodeURIComponent(q)` **当前页跳转**搜索引擎（应用本就在独立标签页整页运行，无需开新标签）；空输入不动作
- `setEngine(id)`：id 在 `ENGINES` 内才生效，更新 `engineId` 并 `await store.setItem("searchEngine", id)` 持久化
- `normalizeUrl(input)`：trim，已有协议（`scheme://`）原样返回，否则补 `https://`；空串原样返回
- `hostOf(url)`：解析 hostname 并去掉 `www.`，解析失败返回原串
- `openDial(dial)`：`window.open(url, "_blank", "noopener")`；拖拽中（`draggingId` 非空）不触发
- 卡片图标渲染：`dial.icon` 非空时 `n-icon :icon` 渲染图标，否则 `initial(dial)` 首字母（两个 `x-if` 非显式切换）；`dial.color` 为空串时 `.tile-logo.no-bg` 无底色（透明背景 + 淡描边，内容用 on-surface-variant 色）
- `openAdd()` / `openEdit(event, dial)`：`stopPropagation` 后调用 `getDialForm()?.openForm(...)` 打开弹窗页面（新增传 `count`/默认分组，编辑传 `id`/原值（含 `icon`）；`"未分组"` 反向转空串）
- `onDialSave(event)`：处理弹窗上抛的 `dial-save` 事件（`event.data` = `{ id, url, title, group, color, icon }`），负责 `normalizeUrl` 归一化、标题/分组兜底、`icon` 空值归一为空串、编辑原地改字段或新增 push（生成 id/createdAt），最后 `persist()`
- `openImport()` / `getAiImport()`：调 `getAiImport()?.openImport()` 打开 AI 导入弹窗（同 `getDialForm` 模式）
- `openGroup()` / `getAiGroup()`：收藏为空时 toast 提示并拦截；否则调 `getAiGroup()?.openGroup(this.plainDials())` 打开 AI 分组弹窗
- `onAiGroupApply(event)`：处理 AI 分组上抛的 `ai-group-apply` 事件（`event.data.items` = `[{ id, group }]`），按 id 匹配更新 `dial.group`（分组名非空且变化才计入），最后 `persist()`；有变更时把 `activeGroup` 重置为 `""`（原筛选组可能已被改名），并 toast 提示更新数量
- `onAiImportSave(event)`：处理 AI 导入上抛的 `ai-import-save` 事件（`event.data.items` = `[{ url, title }]`）；逐条 `normalizeUrl`、跳过空 URL 与已收藏 URL（按 url 去重）、标题兜底 `hostOf`、分组取当前 `activeGroup`（空则「未分组」）、颜色按 `dials.length % PALETTE.length` 轮选，最后 `persist()` 并 toast 提示新增数量
- `removeDial(event, dial)`：punch-ui `confirm` 确认后 splice 删除再 `persist()`
- 拖拽：`onDragStart/onDragOver/onDragLeave/onDrop/onDragEnd`，drop 时在 `plainDials()` 拷贝上 splice 换位后整体回写 `this.dials`
- `plainDials()`：把响应式对象拍平为纯对象数组（仅保留 7 个持久化字段，`icon` 空值归一为空串），**写库必须经过它**，避免代理对象入库
- `persist()`：`store.setItem("dials", this.plainDials())`
- `attached()`：`Promise.all` 并行读 `dials` 与 `searchEngine`（引擎 id 校验在 `ENGINES` 内才应用，否则保持默认 google），最后 `this.shadow.$("#search-input")?.focus()` 实现**应用打开时搜索框自动聚焦**

## dial-form.html 弹窗页面要点

以 `<o-page id="dial-form">` 常驻内嵌于 home（**o-page 初始化后不允许改 src**，传参走方法调用而非 query）：

- 状态（`data`）：`dialogOpen`（弹窗开关）、`editingId`（空串=新增）、`palette`、`form`（url/title/group/color/icon）、`iconQuery`（图标搜索关键词）、`iconResults`（iconify 图标名数组）、`searching`、`noBg`（p-switch 值，`"on"` = 无底色）
- `openForm({ id, url, title, group, color, icon, count })`：宿主调用的入口，回填表单并打开弹窗；`color` 缺省时按 `count % PALETTE.length` 轮选取默认色，`noBg` 按传入 `color` 是否为空串初始化（编辑无底色收藏时开关自动开启）；打开后按 `iconKeyword(url)`（去 `www.` 后取 hostname 倒数第二段，gist.github.com → github；单段如 localhost 直接用）自动静默搜一次图标，方便直接选品牌标
- 色板行：`x-if :value="noBg === 'off'"` 包裹色板（无底色时隐藏色板选择）；「无底色」`p-switch`（`sync:value="noBg"`，`"on"/"off"`）放在「网址图标」行最右侧（`margin-left: auto`）；图标预览块在无底色时透明背景无边框（`.icon-preview.no-bg` 仅换内容色），图标/首字母用 on-surface-variant 色
- 图标选择区（色板行下方）：预览块实时显示选中图标或首字母（`previewInitial` getter，标题优先其次主域名）+「恢复默认」清空 icon；搜索行是原生 `<input>`（`sync:value="iconQuery"`，Enter 触发搜索）+「搜索图标」按钮；结果为 `o-fill` 渲染的 8 列图标网格（`n-icon :icon="$data"`，固定 `max-height: 168px` 内部滚动，点击选中高亮，`attr:title` 显示图标名）；`.dialog-form` 整体 `max-height: 60vh` 内部滚动防撑高弹窗
- `searchIcons(silent)`：调 iconify 搜索 API（`api.iconify.design/search?limit=32`），取 `icons` 前 32 个；`silent`（自动搜索）时失败/空结果不弹 toast
- `save()`：URL 为空 → punch-ui `toast` 报错不关闭；否则 `emit("dial-save", { data: { id, url, title, group, color, icon }, bubbles: true, composed: true })` 冒泡上抛原始表单值（`color` 在 `noBg === "on"` 时上抛空串，`form.color` 始终保留色板选择以便切回），并关闭弹窗
- 分工约定：**弹窗只管表单完整性（非空校验），home 负责业务归一化与落库**；取消/遮罩关闭仅本页置 `dialogOpen = false`，不通知宿主

## ai-import.html AI 导入弹窗页面要点

以 `<o-page id="ai-import">` 常驻内嵌于 home，工具栏「AI 导入」按钮触发，两阶段流程（`phase` 状态：`input` / `review`，`o-if` 切换）：

- 状态（`data`）：`dialogOpen`、`phase`、`inputText`（textarea 文本）、`fileName`（已选文件名展示）、`dragOver`（拖拽悬停高亮）、`candidates`（`[{ url, title, checked }]`）、`analyzing`
- `openImport()`：宿主调用的入口，重置全部状态并打开弹窗
- 输入阶段：**原生 `<textarea>` 固定高度 240px 内部滚动**（不用 p-textarea，它会随内容自动增高撑爆弹窗），`sync:value` 绑定 `inputText`；整个输入区是拖放目标（`onDragOver` preventDefault + `dragOver` 高亮，`onDrop` 取 `dataTransfer.files[0]`）；另有隐藏原生 `<input type="file">`（`pickFile()` 触发点击）；`readFile(file)` 为选择/拖拽共用的读取逻辑（`file.text()` 读内容写入 `inputText`，读完清空 `input.value` 以便重选同一文件；超 50000 字符截断并在文件名后标注）
- `analyze()`：非空校验 → 惰性 `load("/ai/main.js")` 取 `getAssistant()` → `chat({ thinking: false })` 用固定 prompt 要求模型只输出 JSON 数组 → `parseSites()` 容错解析（剥代码块标记、取首个 JSON 数组、校验 url 能解析出带点域名、按 url 去重、title 兜底域名）→ 空结果 toast 报错停留，否则进 `review` 阶段
- 异常处理：`no api key available` → 提示去「AI 密钥管理器」配置；其它错误 toast 原始 message；await 返回后若弹窗已被关闭则丢弃结果
- 勾选阶段：`o-fill` + `p-checkbox`（`sync:checked="$data.checked"`）逐条勾选，支持 `toggleAll()` 全选/全不选（`selectedCount` / `allChecked` getter 统计）
- `confirmImport()`：未勾选 toast 报错；否则 `emit("ai-import-save", { data: { items: [{ url, title }] }, bubbles: true, composed: true })` 上抛所选并关闭弹窗；`backToInput()` 返回输入阶段（保留已输入文本，可重新识别；不用 `back` 命名，与 ofa.js proto 内置方法重名会注册报错）
- 分工约定同 dial-form：**本页只管识别与选择，归一化/去重/配色/落库由 home 的 `onAiImportSave` 处理**

## ai-group.html AI 自动分组弹窗页面要点

以 `<o-page id="ai-group">` 常驻内嵌于 home，工具栏 `p-split-button` 主操作「AI 分组」触发（「AI 导入」为同按钮下拉子项），两阶段流程（`phase` 状态：`analyzing` / `review`，`o-if` 切换）：

- 状态（`data`）：`dialogOpen`、`phase`、`dialCount`（实际送分析的条数）、`totalCount`（宿主传入总条数）、`previewGroups`（`[{ name, items: [{ id, title, host }], checked }]`）
- `openGroup(dials)`：宿主调用的入口，接收 `plainDials()` 纯对象数组，截断到前 `MAX_CLASSIFY`（200）条后重置状态、打开弹窗并自动开始分析（无输入阶段）
- `analyze(list, suggestion)`：惰性 `load("/ai/main.js")` 取 `getAssistant()` → `chat({ thinking: false })`，prompt 要求模型输出 `[{"id","group"}]` JSON 数组（中文组名 2~6 字、共 2~8 组、id 原样返回）；带 `suggestion` 时在规则前插入「用户对分组的额外要求（优先级最高）」块 → `parseGroups()` 容错解析（剥代码块标记、取首个 JSON 数组、校验 id 在送入列表内、组名截 20 字、按 id 去重）→ 聚合成预览分组：**AI 未覆盖的网址保持原 `dial.group`（空则「未分组」）**，进 `review` 阶段
- 异常处理：`no api key available` → 提示去「AI 密钥管理器」配置；其它错误 toast 原始 message 并关闭弹窗；await 返回后弹窗已被关闭则丢弃结果
- 预览阶段：外层 `o-fill`（`fill-key="name"`）渲染分组块，内层嵌套 `o-fill`（`:value="$data.items" fill-key="id"`）渲染组内条目（标题 + 域名）；每组一个 `p-checkbox`（`sync:checked="$data.checked"`）控制是否应用，未勾选组降透明度；分组列表固定 `max-height: 380px` 内部滚动；列表下方是建议输入行——**原生 `<textarea>` 固定高度 64px 内部滚动**（同 AI 导入不用 p-textarea 的原因，多行建议不撑高弹窗）+「重新分组」按钮
- `reGroup()`：建议为空 toast 报错；否则回到 `analyzing` 阶段（loading 文案切换为「按你的建议重新分组」）并带 `suggestion` 复用 `dialList` 重新分析，新结果覆盖预览；建议文本保留可继续修改重分
- 头部提示：超 200 条时显示「仅分析前 N 条（共 M 条）」，否则显示「未勾选的分组保持原样」
- `applyGroups()`：未勾选任何组 toast 报错；否则收集勾选组的 `{ id, group }`，`emit("ai-group-apply", { data: { items }, bubbles: true, composed: true })` 上抛并关闭弹窗
- 分工约定同上：**本页只管分析与选择，落库由 home 的 `onAiGroupApply` 处理**

交互细节：

- 模板用 `o-fill` 循环渲染分组 chips 与卡片网格（`fill-key` 分别为 `name` / `id`）
- 删除/编辑按钮点击需 `event.stopPropagation()`，避免冒泡触发 `openDial`

## 运行方式

- 在 Mazmot 系统内经应用市场安装后运行（`?app=speed-dial` 官方应用分享格式）
- 依赖宿主环境：NoneOS Core Service Worker 提供 `/nos/*` 与 `/gh/` 前缀，Mazmot 宿主提供 `/ai/main.js`；页面模块内用 `load(...)` 按需加载，禁止顶层 `import "/nos/*"`
- AI 导入需在宿主已配置 AI Key（「AI 密钥管理器」应用）；未配置时功能给出明确提示，其余功能不受影响

## 测试

- 测试框架 sibyl-test，测试文件放 `test/` 下（如 `test/home.sb.html`），当前尚无测试
