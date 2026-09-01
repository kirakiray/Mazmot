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
│   ├── markdown.js     # Markdown 渲染（与 ai-chat 同源副本，代码块带复制按钮）
│   ├── skill-sync.js   # 技能知识库：源清单 + zip 解析 + 下载安装到 VFS skills 空间 + 索引/读取
│   └── tools/          # Agent 工具插件（每工具一文件，见「工具插件体系」）
│       ├── index.js        # 注册中心：TOOL_DEFS + createTools()（ctx 注入 + chain tool 包装）
│       ├── create-app.js   # create_app：建 <name>/client/ 并写 app.json
│       ├── write-file.js   # write_file：写/覆盖 client/ 下文件（文本白名单 + 路径逃逸校验）
│       ├── read-file.js    # read_file：读文件（迭代修改前查看）
│       └── list-files.js   # list_files：列文件清单
├── pages/
│   ├── home.html       # 唯一页面：三段布局（顶栏 / 左会话栏 / 聊天列）+ 右侧应用面板
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
| `pages/home.html` | 唯一页面模块（见下节） |
| `lib/markdown.js` | Markdown → HTML（代码块带复制按钮，事件委托处理 `:html` 内的点击） |

## home.html 页面要点

**布局**：`.app`（relative，容纳右侧滑出面板）> `topbar` + `.body-row` > 左 `.side`（会话栏，选中应用即常驻显示：`currentAppName !== ""`）+ `.main-col`（聊天区 + 输入区）。右侧 `.panel`（滑出面板：头部关闭按钮 + `st-tab-bar` 三 tab——「应用」（新建应用按钮 + 应用列表）/「工具」（Agent 可用工具清单，数据来自 `TOOL_DEFS` 映射、新增插件自动出现）/「技能」（Agent 可用技能知识库清单，数据来自 VFS skills 空间索引、后台同步完成后刷新），`panelTab` 状态切换）+ `.panel-mask` 为 absolute 覆盖层。

**状态（`data`）**：`messages` / `input` / `sending` / `keyError` / `coreError` / `nextId` / `atBottom`（聊天）；`panelOpen` / `apps` / `currentAppName`（`""` = 草稿）/ `currentAppDisplay` / `currentAppIcon` / `currentAppMode` / `currentAppSessions` / `currentSessionId`（应用与会话）；`storageMode` / `localDirLabel`（草稿目标偏好）；`confirmingDelApp` / `confirmingDelSession`（两步删除确认，不弹原生 confirm）；`skills`（已安装技能知识库列表，供「技能」tab 渲染，随后台同步刷新）。

**模块级非响应式变量**：`agent`（惰性创建，切换应用/会话/目标后置 null 重建）、`activeBubble`（流式写入目标）、`pendingNewApp`（本轮 create_app 捕获）、`localRootHandle`（本地句柄，下划线规则防 ofa 响应式包装）、`fs` / `mazmotStore` / `selfStore`（Core 依赖，`load()` 运行时注入）。

**关键方法（`proto`）**：

- `ensureAgent()`：惰性建 Agent；`useLocal` 按「已选应用看 `currentAppMode`、草稿看 `storageMode` + 有句柄」判定，`rootHandle` 注入工具；`onAppCreated` 捕获 `pendingNewApp`（mode 随之定格）
- `reloadApps()` / `syncCurrentFromRegistry()`：registry 读写与 currentApp* 展示字段同步（会话按 `updatedAt` 倒序）
- `selectApp(name)`：`applyApp`（恢复本地句柄、重置确认态、置空 agent）+ 打开最近会话；`loadSession(sid)`：换消息与 threadId；`startDraft(wipeDraft)`：回草稿（目标重新可选，恢复 `chat:draft`；`wipeDraft = true` 时连历史草稿消息与 `thread:draft` 记忆一并清空，删光所有应用后回落草稿走此分支）；`newSessionFor(name)`：清空进入新会话（发首条消息时才落 registry）
- `selectMode(mode)` / `chooseLocalDir()`：草稿目标切换与 `fs.open()`（不支持时提示 Safari/Firefox 用虚拟渠道）
- `deleteApp(event, name)` / `deleteSession(event, sid)`：两步确认；删应用按渠道决定是否删文件；删会话清 `chat:` / `thread:` 键后切到剩余最近会话
- `prepareContext(text)`：发送前落点准备——草稿本地缺句柄则重选（失败降级 vfs）；已选应用无会话则自动新建（标题取首条用户消息前 24 字）；本地句柄丢失则从记录恢复，随后 `ensureLocalPermission` 补授权，失败才回退重选
- `handleSend()` / `handleStreamEvent(ev)` / `newBubble()`：发送与流式渲染（text 增量进 activeBubble、toolCalls 出工具行、toolResult 回填、done 兜底）
- `finishTurn(text, threadId)`：回合收尾——本轮若 `pendingNewApp` 走 `adoptNewApp`；否则消息落 `chat:` 键并更新会话标题/updatedAt
- `adoptNewApp(info, text, plain)`：校验文件完整性（`validateApp`，缺 `REQUIRED_FILES` 则卡片标缺失）→ **立即**登记 `apps[]`（不等文件齐全；本地记录携带句柄，尽早落库才能在刷新后恢复授权）→ registry 建应用 + 首个会话，草稿消息与 Agent 记忆从 `chat:draft` / `thread:draft` **迁移**过去 → `applyApp` 切入新应用上下文（目标锁定）→ 聊天流追加应用预览卡片（`role: "app"`）
- `ensureAppRegistered()`：每回合兜底——`apps[]` 里缺当前应用记录（历史会话 / 旧版本创建）时补登记，本地渠道带上句柄；由 `finishTurn` 的已选应用分支调用
- `openApp(appName, mode)`：预览——vfs 直接 `window.open("/$ai-apps/...")`；local 走 `openLocalApp`（所选目录即项目根，句柄缺失先从记录恢复 / 重选，`getRunUrl` 直接挂载该目录）
- `openPanel()` / `closePanel()`：右侧应用面板；`ready()`：恢复 ui 停留位置或草稿

**ofa.js 模板注意**：o-fill 内用 `$data` / `$host`，根级直接用 data 字段名与方法名；布尔属性用 `attr:`；删除按钮 `event.stopPropagation()` 防触发所在行选中。

## 运行方式

- 在 Mazmot 系统内经应用市场安装后运行（`?app=ai-app-builder` 官方应用分享格式）
- 依赖宿主环境：NoneOS Core Service Worker 提供 `/nos/*` 与 `/gh/` 前缀，Mazmot 宿主提供 `/mz/ai/*` 与 `/mz/app-runner.js`；页面模块内 `load()` 按需加载，禁止顶层 `import "/nos/*"`、`"/mz/*"`
- AI 生成需宿主已配置 AI Key（「AI 密钥管理器」应用）；本地目录渠道仅 Chrome（`fs.open()`）

## 测试

- 测试框架 sibyl-test，`test/builder.sb.html` 覆盖：`sanitizeAppName` / `validateRelPath`（正常 + 非法路径）、`buildRunUrl` / `buildAppRecord` / `buildLocalAppRecord` / `buildAppJson`、工具插件注册中心（fake tool + 内存 fake fs 验证 ctx 注入与回调连通）、`createAppDir` → `writeAppFile` → `validateApp` 端到端（需先访问 `/` 装好 Core）
