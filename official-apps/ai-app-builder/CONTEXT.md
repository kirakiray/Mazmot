# AI 应用生成器（ai-app-builder）上下文说明

对话式 AI 应用生成器：用户描述需求，AI Agent（`mz/ai/chain` 工具循环）生成完整的 ofa.js 应用并写入文件系统，完成后可直接预览运行。支持多应用、每应用多会话；写入渠道二选一——虚拟系统（VFS `ai-apps/<name>/client/`）或本地目录（`fs.open()` 选盘上目录，仅 Chrome）。本文件是本应用的**活文档**，与代码保持一致；修改代码必须同步更新本文件（规则见 [AGENTS.md](AGENTS.md)）。

> 核心心智模型：**写入目标在「新应用」草稿阶段选定，`create_app` 落地后随应用锁定**；每个应用下挂多条会话（独立消息 + 独立 Agent 记忆）；右侧面板管理应用，左侧边栏是当前应用的历史会话列表。

## 目录结构

```
ai-app-builder/
├── index.html          # 入口 HTML：加载 ofa.js + router + senti-ui 主题引导，挂载 o-app
├── app-config.js       # 应用配置：home 页面路径 + 页面切换动画参数
├── app.json            # 应用 manifest（name/version/entry/appConfig 等）
├── __app.json          # 应用市场分发元数据（name/icon/desc + files 文件清单）
├── AGENTS.md           # AI 代理开发规范（规则自包含）
├── CONTEXT.md          # 本文件
├── lib/
│   ├── builder.js      # 核心库：系统提示词、应用名/路径校验、VFS 写入编排、apps[] 登记/注销
│   ├── builder-store.js # 可观察状态仓库：AI 创作/运行的全部业务逻辑（Agent 编排、应用/会话管理、
│   │                    #   写入目标与本地句柄、消息流水线、持久化）封装为独立运行的状态对象，
│   │                    #   页面只 subscribe 事件同步视图（见「状态仓库」小节）
│   ├── markdown.js     # Markdown 渲染（与 ai-chat 同源副本，代码块带复制按钮）
│   ├── skill-sync.js   # 技能知识库：源清单 + zip 解析 + 下载安装到 VFS skills 空间 + 索引/读取
│   └── tools/          # Agent 工具插件（每工具一文件，见「工具插件体系」）
│       ├── index.js        # 注册中心：TOOL_DEFS + createTools()（ctx 注入 + chain tool 包装）
│       ├── create-app.js   # create_app：建 <name>/client/ 并写 app.json
│       ├── write-file.js   # write_file：写/覆盖 client/ 下文件（文本白名单 + 路径逃逸校验）
│       ├── read-file.js    # read_file：读文件（迭代修改前查看）
│       └── list-files.js   # list_files：列文件清单
├── pages/
│   ├── home.html       # 唯一页面：三段布局（顶栏 / 左会话栏 / 聊天列）+ 右侧资源面板（只负责视觉与交互，
│   │                   #   业务全部委托 builder-store）
│   └── home.css        # 样式（M3 CSS 变量，含应用卡片 / 会话栏 / 滑出面板 / 目标切换器）
└── test/
    └── builder.sb.html # sibyl-test：纯函数 + 工具注册中心 + Core 端到端用例
```

## 技术栈

- **ofa.js** 页面模块（`<template page>`），单页应用，无路由跳转
- **依赖 URL（自包含规范）**：
  - **ofa.js**：所有文件（含入口 HTML）一律 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`（本地前缀，NoneOS Core Service Worker 拦截），必须带 `#debug`；jsdelivr 完整 URL 仅限仓库根 `index.html` 与 `apps/run-app/` 等 Core 引导入口，本应用内禁止写死
  - **ofa.js router**：`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`（无版本号）
  - **Senti-UI**：主题引导 `boot/st-boot.js` + 页面内按需 `l-m` 声明的 `st-tab-bar` / `st-tab-item`（面板 tab）、`st-button`（新建应用 / 预览应用等主按钮）、`st-icon-button`（顶栏应用列表 / 面板关闭 / 新建对话）；一律 `/gh/ofajs/senti-ui@latest/packages/...`（始终 `@latest`）；禁止其他来源的组件资源
- **AI Agent**：`/mz/ai/main.js`（`getAssistant` / `getApiKeys`）+ `/mz/ai/chain/main.js` 的 `createAgent` + `tool` + storage 版 checkpointer；assistant 优先选 DeepSeek（`deepseek-v4-flash`，按 `getApiKeys()` 找 `provider === "deepseek"` 的 key），否则 `getAssistant()` 随机负载均衡；未配置 Key 时发送报错提示去「AI 密钥管理器」
- **宿主能力（站内绝对路径 `/xxx` 引用，Service Worker 保证运行时可用）**：
  - `/nos/fs/main.js`：VFS 写入（`init("ai-apps")`）与本地目录选择（`fs.open()`，仅 Chrome）
  - `/nos/storage/main.js`：持久化——本应用自身状态存 `getStorage("ai-app-builder")` 独立空间，生成应用登记读写 `getStorage("mazmot")` 空间的 `apps` 键（详见「数据模型」）
  - `/mz/app-runner.js`：本地渠道预览时 `getRunUrl({ source: "local", _handle: appDir })` 挂载 `client/`
- **数据安全约定**：写库前把响应式对象拍平为纯对象（避免代理入库）；noneos 句柄等非响应式数据放下划线开头的模块变量（如 `localRootHandle`），防 ofa.js 响应式包装
- **图标**：删除按钮等图标用 `<n-icon icon="mdi:xxx">`（页面已声明 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`），禁止直接依赖 `iconify-icon`；其余 UI 主要用 emoji 与内联 SVG
- **视觉**：不强制 senti-ui 组件，可按需自写；颜色体系遵循 M3 设计语言（CSS 变量 `--md-sys-color-*` 配对 token），不写死十六进制色

## 工具插件体系

`lib/tools/` 下每个工具一个插件文件，默认导出 `{ key, name, description, schema, exec(args, ctx) }`；`index.js` 的 `createTools({ tool, fs, rootHandle, onAppCreated, onFileWrite })` 构造共享 `ctx` 并用 chain 的 `tool` 工厂包装，返回按 `key` 索引的映射（页面用 `Object.values(tools)` 喂给 Agent）。

现有四个工具：

| name | 作用 | 备注 |
|------|------|------|
| `create_app` | 建应用载体目录并写 app.json | 成功触发 `onAppCreated`（页面捕获为 `pendingNewApp`，连带当时的渠道偏好 `mode`） |
| `write_file` | 写/覆盖 client/ 下文件 | 路径相对 client/；`validateRelPath` 拦绝对路径 / `..` 逃逸 / 非白名单文本扩展名 |
| `read_file` | 读文件内容 | 不存在返回提示文本（不抛错，交模型自纠） |
| `list_files` | 列文件清单 | 递归收集，兼容无 `flat()` 的旧 Core；本地渠道列所选目录全部文件 |
| `read_skill` | 读框架知识库文档 | 经 `ctx.readSkill` 注入 `lib/skills/index.js` 的 `readSkillFile`；提示词硬性规则要求写 ofa.js 模板 / 用 senti-ui 组件前先查文档 |

## 技能知识库（运行时下载到 VFS）

Agent 的「查文档」能力，技能**不内置**在应用内：启动后后台任务按技能源清单从远端下载（zip 或裸 `SKILL.md`），安装到 VFS 根命名空间 `skills/<id>/`（`init("skills")`），`read_skill` 读取的也是这份虚拟目录副本（下载一次后离线可用）。

- **源清单**：`DEFAULT_SKILL_SOURCES`（`ofajs-docs.zip`、`noneos-core-docs.zip` 两个 raw.githubusercontent URL）为默认种子，首次运行写入自存储空间 `skill-sources` 键，之后以存储为准（`getSkillSources` / `setSkillSources`，预留管理 UI 扩展点）
- **同步流程**（`syncSkills`，`ready()` 里 `backgroundSyncSkills()` 后台触发、不阻塞首屏）：逐源下载 → sha256 与 `skills/<id>/__meta.json` 里记录比对，同内容跳过写入 → zip 经零依赖解析（`unzipText`：手读中央目录 + `DecompressionStream("deflate-raw")`，支持存储/deflate）→ `stripCommonRoot` 剥掉单一根目录 → 只落文本扩展名文件 + `__meta.json`；单个源失败不中断其余，离线时保留已有副本
- **索引与读取**：`loadSkillIndex(fs)` 遍历 skills 空间各目录的 `SKILL.md` frontmatter；`readSkillFile(fs, id, path)` 只放行 `.md`、拦截 `..` 逃逸与非法 id，超 60000 字符截断提示精读 references
- **接线**：页面初始化 `skillIndex = await loadSkillIndex(fs)`（失败不阻塞）→ `ensureAgent` 注入 `readSkill: (id, path) => readSkillFile(fs, id, path)` 并把 `skills: skillIndex` 传给 `buildSystemPrompt`（提示词尾部「可用知识库」清单；硬性约束含「写模板 / 用组件前禁止凭记忆，必须先 read_skill」）；后台同步有实际写入时刷新 `skillIndex` 并置空 `agent` 重建提示词

`ctx.rootHandle` 是本地渠道的根目录句柄；缺省时所有写入走 VFS `ai-apps/`。**新增工具**：建插件文件 → `TOOL_DEFS` 登记 → 按需更新 `SYSTEM_PROMPT`（均在 `lib/` 内，页面零改动）。

## 双写入渠道与锁定规则

- **草稿阶段**（`currentAppName === ""`）：输入区显示「📁 虚拟系统 / 📂 本地目录」切换器；选本地需先 `fs.open()` 选目录（句柄存模块变量 `localRootHandle`，非响应式）。渠道只是**偏好**，`Agent` 工具的 `rootHandle` 在草稿本地模式下同样注入。
- **落地锁定**：`create_app` 成功时 `onAppCreated` 捕获 `{ appName, displayName, icon, mode }`，`mode` 取当时偏好（或已选应用的 `currentAppMode`）；应用写入 registry 后 `mode` 固定，后续所有会话的 `ensureAgent` 按 `currentAppMode` 注入句柄，切换器不再显示（输入区改为只读落盘路径）。
- **本地句柄恢复与授权**：本地应用登记时句柄随 `apps[]` 记录持久化到 `mazmot` storage。nos-storage 按**路径引用**存句柄，`fs.open()` 得到的本地目录**必须先 `fs.mount()`** 才能 `setItem`（未挂载句柄无法还原，存储直接抛错）——`chooseLocalDir` 选完目录即挂载，挂载产物（path 为 `$mount-*`）入库存档。切换应用 / 刷新后从记录恢复（`getLocalHandleFromRecord`，内部 `fs.get(path)` 还原）。恢复到句柄后用 `ensureLocalPermission` 检查权限——已 granted 直接可用；仅剩 prompt 状态则 `requestPermission`（借助用户手势）补授权；补授权失败才回退重新选目录。权限待授予时提示条带「🔑 授权目录」按钮（`permGrantNeeded` + `grantLocalPermission`）。`chooseLocalDir` 里用户取消选择器（`AbortError`）静默返回 false，不当失败报错。

## 数据模型

### 存储空间 `ai-app-builder`（本应用自身状态）

| 键 | 值 | 说明 |
|----|----|------|
| `apps-registry` | `[{ name, displayName, icon, mode: "vfs"\|"local", createdAt, sessions: [{ id, title, createdAt, updatedAt }] }]` | 应用注册表（含内嵌会话列表） |
| `chat:<app>:<sid>` / `chat:draft` | 消息数组（同页面 `messages` 结构，含 `role: user/assistant/tool/app` 条目） | 各会话消息；草稿存 `chat:draft` |
| `thread:<threadId>` | wire 格式消息数组 | Agent 会话记忆（checkpointer）；`threadId` = 应用名 `:` 会话 id，草稿为 `draft` |
| `ui` | `{ app, session }` | 上次停留位置，`ready` 时恢复 |

### 存储空间 `mazmot` 的 `apps` 键（生成应用登记）

- 虚拟渠道（`buildAppRecord`）：`{ name, desc, icon, source: "virtual", namespace: "ai-apps", dirName: "ai-apps/<name>", virtualDirName, handle: null, createdAt, mazmot: { source: "ai-builder" } }`
- 本地渠道（`buildLocalAppRecord`）：`{ name, desc, icon, source: "local", namespace: "", dirName: name, handle: <DirHandle>, createdAt, mazmot: { source: "ai-builder" } }`
- 登记按 `name + namespace` 去重更新（`registerAppRecord`）；删除用 `unregisterAppRecord`（按 `mazmot.source === "ai-builder"` + name 匹配）；列表查询 `listRegisteredApps` 过滤 `namespace === "ai-apps" || mazmot?.source === "ai-builder"`
- 主系统（apps/main）应用列表：**生成应用一律不进主列表**——虚拟应用落在独立命名空间 `ai-apps/`（不与主系统共享的 `mazmot-apps/` 混用），本地渠道记录仅供 ai-app-builder 持久化恢复句柄；主系统 `loadApps` 按 `mazmot?.source === "ai-builder"` 过滤隐藏全部生成应用

### 磁盘 / VFS 落点

- 虚拟渠道：`init("ai-apps")` 根下 `<name>/client/`（运行 URL `/$ai-apps/<name>/client/index.html`）；删除应用时递归删该目录（`deleteVfsApp`）
- 本地渠道：**用户所选目录即项目根**，文件直接写在根上、不建 `<name>/client/` 子目录（`resolveBaseDir` 按 `rootHandle` 分流）；预览直接挂载该目录（`getRunUrl` 本地逻辑无 `client/` 时回退挂载根目录——因此所选目录里若恰好有无关的 `client/` 子目录会被优先挂载）；**删除应用不删盘上文件**，只移除登记

## 关键代码文件速查

| 文件 | 职责 |
|------|------|
| `lib/builder.js` | `NAMESPACE`/`REQUIRED_FILES` 常量；`sanitizeAppName`（规范化为 `/^[a-z0-9_-]+$/`）、`validateRelPath`（路径白名单校验）；`buildAppJson` / `buildAppRecord` / `buildLocalAppRecord`；`createAppDir` / `writeAppFile` / `readAppFile` / `listAppFiles` / `validateApp`（均接受可选 `rootHandle` 切换渠道）；`registerAppRecord` / `unregisterAppRecord` / `listRegisteredApps` / `deleteVfsApp`；`SYSTEM_PROMPT`（教模型 Mazmot/ofa.js 结构与硬性约束；工作流程要求功能文件完成后补写 **AGENTS.md**（给 AI 的开发规范）与 **CONTEXT.md**（项目说明）两份项目文档，且内容须基于实际生成的代码）+ `buildSystemPrompt(ctx)`（按当前上下文动态构建：已选应用时注入应用名/渠道与「回答项目问题前必须先 list_files / read_file，禁止凭猜测描述项目」的强制规则；草稿阶段退回基础提示词） |
| `lib/tools/index.js` | 插件注册中心（见「工具插件体系」） |
| `lib/tools/*.js` | 四个工具插件，宿主依赖全走 `ctx` |
| `pages/home.html` | 唯一页面模块（见下节；只负责视觉与交互，业务委托仓库） |
| `lib/builder-store.js` | `createBuilderStore({ fs, mazmotStore, selfStore, load })` 可观察状态仓库（见「状态仓库」小节） |
| `lib/markdown.js` | Markdown → HTML（代码块带复制按钮，事件委托处理 `:html` 内的点击） |

## 状态仓库（lib/builder-store.js）

AI 创作 / 运行过程的全部业务逻辑封装在 `createBuilderStore({ fs, mazmotStore, selfStore, load })` 返回的可观察状态对象中，页面不持有任何业务状态，只订阅事件更新视觉数据。这样「进行中的对话切换应用」等上下文切换都在仓库内部单一代码路径里完成，不会出现页面作用域变量错乱。

**事件契约（`store.subscribe(cb)`）**：

- `{ type: "patch", data }`——state 标量 / 整组数据更新（data 为键值对；`nextId` 为内部计数，页面忽略）
- `{ type: "messages", op, ... }`——消息流水线细粒度变更：`op: "replace"`（带 `list`）/ `"push"`（带 `item`）/ `"patch"`（带 `id, patch`）/ `"splice"`（带 `id`）

**state 字段**：`messages` / `sending` / `keyError` / `coreError` / `nextId`（消息与发送）；`apps` / `currentAppName`（`""` = 草稿）/ `currentAppDisplay` / `currentAppIcon` / `currentAppMode` / `currentAppSessions` / `currentSessionId` / `currentSessionTitle`（顶栏展示的当前会话标题，`syncSessionTitle` 从 registry 解析，草稿/无会话为空）（应用与会话）；`storageMode` / `localDirLabel` / `permGrantNeeded`（写入目标与授权）；`skills`（技能索引镜像）。

**非响应式闭包资源**（不进 state，防响应式拆原型）：`agent`（惰性创建，切换应用/会话/目标后置 null 重建）、`activeBubble`、`pendingNewApp`、`localRootHandle`（本地句柄）、`checkpointer`、`/mz/ai` 与 `/mz/ai/chain` 模块缓存。

**仓库方法**：`init({ initialApp })`（项目标签按 URL `?p=<name>` 恢复并打开最近会话；无 `p` = 草稿标签恢复 `chat:draft`；启动先读一次已安装技能索引填充 `skills`，再后台增量同步）、`send(text)`（prepareContext → 用户消息入列 → Agent 流式对话 → finishTurn 收尾，含 `adoptNewApp` 新应用落地迁移与 `ensureAppRegistered` 兜底登记）、`reloadApps` / `selectApp` / `startDraft(wipeDraft)` / `newSessionFor` / `loadSession` / `deleteApp` / `deleteSession` / `selectMode` / `chooseLocalDir` / `grantLocalPermission` / `openApp` / `toggleTool` / `stop`（中断当前生成：`currentAbort.stopped` 置位后流式回调链抛错中断，已生成内容保留并照常落盘，下次发送继续同一 thread）/ `getLocalHandle()`（句柄只读查询）。

## home.html 页面要点

**布局**：`.app`（relative，容纳右侧滑出面板）> `topbar` + `.body-row` > 左 `.side`（会话栏，选中应用即常驻显示：`currentAppName !== ""`）+ `.main-col`（聊天区 + 输入区；发送按钮在 `sending` 时切换为红色停止按钮 → `handleStop`）。

**项目导航（标签制）**：每个项目一个网页标签，URL 以 `?p=<name>` 标识（草稿标签无 `p`）。顶栏品牌区——已进入项目时只显示应用 Logo + 名称 + 渠道徽标 + 当前会话标题（不显示生成器品牌）；草稿时显示「AI 应用生成器 / 新应用 · 未创建」。项目名右侧下拉按钮（`st-icon-button` + `mdi:chevron-down`）→ **左侧项目抽屉**（`.proj-drawer` + 遮罩，复用 `.panel-item` 列表项样式）：顶部「＋ 新建项目」按钮；项目清单每项含图标 / 名称 / 渠道徽标 / 目录名、「已打开」徽标（`openTabs`）与两步确认删除按钮。点击项 → `window.open(url, 窗口名)` 新标签打开——窗口名 `ai-builder-<name>` / `ai-builder-draft` 命中已开标签则聚焦复用，不重复开。「已打开」状态由跨标签感知维护：`BroadcastChannel("ai-builder-tabs")` 广播 `hello` / `alive` / `bye`（本标签 `announce(currentAppName)`，`beforeunload` 发 `bye`；打开抽屉时 `refreshAliveTabs()` 清空重探测）。URL `p` 参数由 `syncUrlParam()` 跟随 `currentAppName` 用 `history.replaceState` 同步（草稿落地为新应用后自动补 `p`，刷新不丢项目）。右侧 `.panel` 为「工具 / 技能」双 tab 的资源面板，`.panel-mask` 为 absolute 覆盖层。

**职责边界**：页面 `data` 是仓库状态的**视觉投影**——`ready()` 里 `store.subscribe()` 把 patch 事件键值直接赋给同名 data 字段，messages 事件细粒度应用到 `this.messages`（`applyMessageEvent`）；`proto` 方法是对仓库方法的薄代理（会话两步删除 `confirmingDelSession`、项目两步删除 `confirmingDelApp` 与 `panelOpen` / `panelTab` / `projDrawerOpen` / `openTabs` / `input` / `atBottom` 等纯 UI 状态留在页面）。业务变更一律调仓库方法，页面不直接改业务数据。

## 运行方式

- 在 Mazmot 系统内经应用市场安装后运行（`?app=ai-app-builder` 官方应用分享格式）
- 依赖宿主环境：NoneOS Core Service Worker 提供 `/nos/*` 与 `/gh/` 前缀，Mazmot 宿主提供 `/mz/ai/*` 与 `/mz/app-runner.js`；页面模块内 `load()` 按需加载，禁止顶层 `import "/nos/*"`、`"/mz/*"`
- AI 生成需宿主已配置 AI Key（「AI 密钥管理器」应用）；本地目录渠道仅 Chrome（`fs.open()`）

## 测试

- 测试框架 sibyl-test，`test/builder.sb.html` 覆盖：`sanitizeAppName` / `validateRelPath`（正常 + 非法路径）、`buildRunUrl` / `buildAppRecord` / `buildLocalAppRecord` / `buildAppJson`、工具插件注册中心（fake tool + 内存 fake fs 验证 ctx 注入与回调连通）、`createAppDir` → `writeAppFile` → `validateApp` 端到端（需先访问 `/` 装好 Core）
