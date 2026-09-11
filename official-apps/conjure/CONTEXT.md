# 妙造（Conjure）上下文说明

妙造（Conjure）是对话式 AI 应用生成器：用户描述需求，AI Agent（`mz/ai/chain` 工具循环）生成完整的 ofa.js 应用并写入文件系统，完成后可直接预览运行。支持多应用、每应用多会话；写入渠道二选一——虚拟系统（VFS `ai-apps/<name>/client/`）或本地目录（`fs.open()` 选盘上目录，仅 Chrome，文件写入所选目录的 `client/` 子目录）。本文件是本应用的**活文档**，与代码保持一致；修改代码必须同步更新本文件（规则见 [AGENTS.md](AGENTS.md)）。

> 核心心智模型：**写入目标在「新应用」草稿阶段选定，`create_app` 落地后随应用锁定**；每个应用下挂多条会话（独立消息 + 独立 Agent 记忆）；右侧面板管理应用，左侧边栏是当前应用的历史会话列表。

## 目录结构

```
conjure/
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
│   ├── tools/          # Agent 工具插件（每工具一目录/一文件，见「工具插件体系」）
│   │   ├── visual-test-kit.js # 视觉工具组件测试基座：defineVisualSelfTest（环境守卫 /
│   │   │                      #   逐条回调 + 100ms 节奏 / 组件挂载台 bench），
│   │   │                      #   用法与坑见 lib/tools/visual-test-kit.md
│   │   └── show-form/  # 视觉交互表单工具包：index.js（插件）+ form-card.html（视觉组件）+
│   │                   #   self-test.js（内置测试模组）+ README.md + test/show-form.sb.html
│       ├── index.js        # 注册中心：TOOL_DEFS + createTools()（ctx 注入 + chain tool 包装）
│       ├── create-app.js   # create_app：建 <name>/client/ 并写 app.json
│       ├── write-file.js   # write_file：写/覆盖 client/ 下文件（文本白名单 + 路径逃逸校验；目标未初始化时自动补建 app.json 并触发 onAppCreated）
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
- **AI Agent**：`/mz/ai/main.js`（`getAssistant` / `getApiKeys` / `onApiKeysChange`）+ `/mz/ai/chain/main.js` 的 `createAgent` + `tool` + storage 版 checkpointer；assistant 选择：用户在输入区 select 手动指定的 key 优先（`activeKeyId`，deepseek 供应商配 `deepseek-v4-flash` 模型名，其余跟随供应商默认），模型同理可手动指定（`activeModelId`，须属于当前 key 的供应商，选项来自 `MODEL_OPTIONS` 映射）；未指定时自动——优先 DeepSeek（`deepseek-v4-flash`）否则 `getAssistant()` 随机负载均衡；未配置 Key 时发送报错提示去「AI 密钥管理器」。key 列表镜像在 state `apiKeys`，`onApiKeysChange` 实时刷新，选中项被删/禁用自动回退自动模式；Key 切换器与模型选择器收在上下文进度圆圈的悬停气泡里（模型选项跟随选中 Key 的供应商，自动 Key 时禁用），不占控件行（`.ctx-pop`，纯 CSS hover 展示），不占控件行
- **宿主能力（站内绝对路径 `/xxx` 引用，Service Worker 保证运行时可用）**：
  - `/nos/fs/main.js`：VFS 写入（`init("ai-apps")`）与本地目录选择（`fs.open()`，仅 Chrome）
  - `/nos/storage/main.js`：持久化——本应用自身状态存 `getStorage("conjure")` 独立空间，生成应用登记读写 `getStorage("mazmot")` 空间的 `apps` 键（详见「数据模型」）
  - `/mz/app-runner.js`：本地渠道预览时 `getRunUrl({ source: "local", _handle: appDir })` 挂载 `client/`
- **数据安全约定**：写库前把响应式对象拍平为纯对象（避免代理入库）；noneos 句柄等非响应式数据放下划线开头的模块变量（如 `localRootHandle`），防 ofa.js 响应式包装
- **图标**：删除按钮等图标用 `<n-icon icon="mdi:xxx">`（页面已声明 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`），禁止直接依赖 `iconify-icon`；其余 UI 主要用 emoji 与内联 SVG
- **视觉**：不强制 senti-ui 组件，可按需自写；颜色体系遵循 M3 设计语言（CSS 变量 `--md-sys-color-*` 配对 token），不写死十六进制色

## 工具插件体系

`lib/tools/` 下每个工具一个插件文件，默认导出 `{ key, name, description, schema, exec(args, ctx) }`；`index.js` 的 `createTools({ tool, fs, rootHandle, onAppCreated, onFileWrite, readSkill, requestForm })` 构造共享 `ctx` 并用 chain 的 `tool` 工厂包装，返回按 `key` 索引的映射（页面用 `Object.values(tools)` 喂给 Agent）。

现有六个工具：

| name | 作用 | 备注 |
|------|------|------|
| `create_app` | 建应用载体目录并写 app.json | 成功触发 `onAppCreated`（页面捕获为 `pendingNewApp`，连带当时的渠道偏好 `mode`） |
| `write_file` | 写/覆盖 client/ 下文件 | 路径相对 client/；`validateRelPath` 拦绝对路径 / `..` 逃逸 / 非白名单文本扩展名；写入前经 `ensureAppInitialized` 检测 app.json，缺失则自动补建最小 app.json 并触发 `onAppCreated`（兜底模型跳过 create_app 的场景） |
| `read_file` | 读文件内容 | 不存在返回提示文本（不抛错，交模型自纠） |
| `list_files` | 列文件清单 | 递归收集，兼容无 `flat()` 的旧 Core；本地渠道列所选目录全部文件 |
| `read_skill` | 读框架知识库文档 | 经 `ctx.readSkill` 注入 `lib/skills/index.js` 的 `readSkillFile`；提示词硬性规则要求写 ofa.js 模板 / 用 senti-ui 组件前先查文档 |
| `show_form` | 视觉交互表单（见下节「视觉交互表单」）；插件带 `tags: ["视觉"]`，资源面板工具列表以「👁 视觉」徽标标注 | 经 `ctx.requestForm` 注入 builder-store 的 `requestForm(spec)`；工具描述内含字段规范（text/textarea/number/select/radio/checkbox + options/placeholder/required），提交后模型收到 `{"data":{key:值}}`，取消收到 `{"cancelled":true}` |

## 视觉交互表单（show_form 工具）

带 UI 交互的工具：模型调用 `show_form` 传入表单规范 `{title, description, fields[]}` → builder-store `requestForm` 把表单卡片作为一条 `role:"assistant", type:"form"` 消息推入当前回合并返回 Promise（挂起本轮对话直到用户交互）→ 用户在卡片上填写并点「提交」（组件内收集控件值，required 缺失 toast 拦下）→ `store.submitForm(msgId, values)` 把 `{status:"submitted", data}` patch 回消息（随会话桶持久化）并把数据 resolve 给工具，工具以 `{"data":{...}}` JSON 返回给模型继续。用户点停止 / 回合兜底结束时 `cancelPendingForm` 置 `cancelled` 只读。卡片由 show-form 包内的视觉组件 `<show-form-card>`（`form-card.html`，页面经 `l-m` 声明预载）渲染：`data.spec` 接收表单规范（页面传 `:spec="$data.form"`），pending 时 `renderFields` 生成 senti-ui 表单控件（st-input / st-textarea / st-select / st-radio / st-checkbox，宿主页面须 l-m 预载这些控件；st-radio 以 name 为同组互斥键、value 属性为提交值），全部文本经 `esc` 转义防注入，提交时组件内部收集控件值（senti 控件 value 走 property、checked 走属性）、required 校验后 emit `form-submit`（bubbles + composed，ofa emit 的载荷在 `event.data` 即表单值）→ 页面 `onFormSubmit` → `store.submitForm`；**历史只读回填**：重新打开会话时提交过的表单以「label：值」清单只读展示（badge「已提交 · 只读」），历史里仍处 pending 的表单在 `replaceMessages` 归一化为 `expired`（badge「已过期 · 只读」），均不可再编辑。

## 工具详情对话框与包内置测试

资源面板工具列表项可点击 → `st-dialog.tool-detail`；宽度分两档——非视觉工具窄单栏（`class:narrow`，min(560px, 92vw)，无 Tab），视觉工具 82vw / max-width 1280、带「工具信息 / 内置测试」双 Tab（`toolTab`）。
- **工具信息 Tab**：描述、参数 Schema、「▶ 前往测试」入口（只切 Tab 不执行）；视觉工具右侧保留 iframe 演示（srcdoc 由 `buildToolDemoDoc` 生成，渲染一张 pending 可交互的示例表单卡片）。
- **内置测试 Tab**：左列为测试计划 list（打开对话框时加载 `self-test.js` 导出的 `testPlan` 用例名，全部为 pending 空心圆），右列为测试运行 iframe；**点「▶ 运行测试」才实际执行**——点击时清空旧 srcdoc 再挂新文档（同值属性不触发 iframe 重载，先归空才能保证每次点击都真正重跑），加载包内组件 + senti 控件 + `selfTest` 模组跑 `runSelfTest(onCase)`，被测组件实时挂载在画面上、结束保留画面；断言经 `postMessage`（`conjure-tool-test-case/done/error`）逐条同步回左列，按用例名把该项从 pending 打勾为 pass / fail。测试区 `.tool-test-grid` 常驻不卸载（仅 display 显隐）——若用 o-if 卸载，切 Tab 会让保留的 srcdoc 重挂载而自动重跑。
- 两个 iframe 的 srcdoc 公共骨架在 `toolDocPre` / `toolDocSenti`：`<base>` 指向站点根、l-m src 必须完整绝对地址、script 开闭标签拆开拼、内嵌脚本单行且只能用块注释——违反任一条会导致模板解析失败或脚本截断 / 吞闭合括号。
show-form 包的 `self-test.js` 覆盖插件层（包结构 / 参数清洗 / 提交 / 取消 / 环境兜底）与组件层（控件渲染 / required 拦截 / 事件冒泡 / 只读回填 / XSS 转义；组件或 senti 控件未注册的环境自动跳过组件断言），包内 `test/show-form.sb.html` 复用同一 `runSelfTest()` 做两种环境（纯模块 / 预载组件）的回归。新增视觉工具包照此约定导出 `visual` + `selfTest`（self-test.js 再导出 `testPlan` 用例名清单）即自动获得 Tab、测试计划 list、测试运行 iframe 与演示预览。self-test.js 不直接写断言样板，而是引用 `lib/tools/visual-test-kit.js` 的 `defineVisualSelfTest({ tag, requiredTags, plan, run })`：基座统一处理环境守卫（`kit.componentReady`）、逐条回调 + 100ms 节奏（`kit.check`）、组件挂载（`kit.mount()` 直接返回被测组件的 ofa.js 实例，用例用 ofa 自带能力随意操作；proto 方法带参调用、数据不走 this，见 lib/tools/visual-test-kit.md）。

## 技能知识库（运行时下载到 VFS）

Agent 的「查文档」能力，技能**不内置**在应用内：启动后后台任务按技能源清单从远端下载（zip 或裸 `SKILL.md`），安装到 VFS 根命名空间 `skills/<id>/`（`init("skills")`），`read_skill` 读取的也是这份虚拟目录副本（下载一次后离线可用）。

- **源清单**：`DEFAULT_SKILL_SOURCES`（`ofajs-docs.zip`、`noneos-core-docs.zip` 两个 raw.githubusercontent URL）为默认种子，首次运行写入自存储空间 `skill-sources` 键，之后以存储为准（`getSkillSources` / `setSkillSources`，预留管理 UI 扩展点）
- **同步流程**（`syncSkills`，`ready()` 里 `backgroundSyncSkills()` 后台触发、不阻塞首屏）：逐源下载 → sha256 与 `skills/<id>/__meta.json` 里记录比对，同内容跳过写入 → zip 经零依赖解析（`unzipText`：手读中央目录 + `DecompressionStream("deflate-raw")`，支持存储/deflate）→ `stripCommonRoot` 剥掉单一根目录 → 只落文本扩展名文件 + `__meta.json`；单个源失败不中断其余，离线时保留已有副本
- **索引与读取**：`loadSkillIndex(fs)` 遍历 skills 空间各目录的 `SKILL.md` frontmatter（含 `version`，有则列表显示 v 徽标），并从 `__meta.json` 带出 `source`（下载地址）与 `installedAt`；`readSkillFile(fs, id, path)` 只放行 `.md`、拦截 `..` 逃逸与非法 id，超 60000 字符截断提示精读 references
- **手动安装 / 更新**（右侧资源面板「技能」tab）：「＋ 添加」按钮弹出 prompt 输入 zip 包或 `SKILL.md` 的 https 地址 → 仓库 `installSkillFromSource(url)` 先把 loading 占位放入 `skills` 列表（同 id 已存在则原地置 loading，即更新语义）→ `installSkillFromUrl(fs, url)` 下载安装（同内容 sha256 一致跳过写入）→ 刷新索引、置空 `agent`，并把该地址登记进自存储 `skill-sources`（之后后台同步也会持续检查）。失败回滚 loading 占位并由 alert 提示。每个技能 item 下方展示来源地址，行尾刷新按钮从来源更新；`idFromUrl` 由 URL 推导技能 id
- **接线**：页面初始化 `skillIndex = await loadSkillIndex(fs)`（失败不阻塞）→ `ensureAgent` 注入 `readSkill: (id, path) => readSkillFile(fs, id, path)` 并把 `skills: skillIndex` 传给 `buildSystemPrompt`（提示词尾部「可用知识库」清单；硬性约束含「写模板 / 用组件前禁止凭记忆，必须先 read_skill」）；后台同步有实际写入时刷新 `skillIndex` 并置空 `agent` 重建提示词

`ctx.rootHandle` 是本地渠道的根目录句柄；缺省时所有写入走 VFS `ai-apps/`。**新增工具**：建插件文件 → `TOOL_DEFS` 登记 → 按需更新 `SYSTEM_PROMPT`（均在 `lib/` 内，页面零改动）。

## 双写入渠道与锁定规则

- **草稿阶段**（`currentAppName === ""`）：输入区显示「📁 虚拟系统 / 📂 本地目录」切换器；选本地需先 `fs.open()` 选目录（句柄存模块变量 `localRootHandle`，非响应式）。渠道只是**偏好**，`Agent` 工具的 `rootHandle` 在草稿本地模式下同样注入。
- **落地锁定**：`create_app` 成功时 `onAppCreated` 捕获 `{ appName, displayName, icon, mode }`，`mode` 取当时偏好（或已选应用的 `currentAppMode`）；应用写入 registry 后 `mode` 固定，后续所有会话的 `ensureAgent` 按 `currentAppMode` 注入句柄，切换器不再显示（输入区改为只读落盘路径）。
- **本地句柄恢复与授权**：本地应用登记时句柄随 `apps[]` 记录持久化到 `mazmot` storage。nos-storage 按**路径引用**存句柄，`fs.open()` 得到的本地目录**必须先 `fs.mount()`** 才能 `setItem`（未挂载句柄无法还原，存储直接抛错）——`chooseLocalDir` 选完目录即挂载，挂载产物（path 为 `$mount-*`）入库存档。切换应用 / 刷新后从记录恢复（`getLocalHandleFromRecord`，内部 `fs.get(path)` 还原）。恢复到句柄后用 `ensureLocalPermission` 检查权限——已 granted 直接可用；仅剩 prompt 状态则 `requestPermission`（借助用户手势）补授权；补授权失败才回退重新选目录。权限待授予时提示条带「🔑 授权目录」按钮（`permGrantNeeded` + `grantLocalPermission`）。`chooseLocalDir` 里用户取消选择器（`AbortError`）静默返回 false，不当失败报错。

## 数据模型

### 存储空间 `conjure`（本应用自身状态）

| 键 | 值 | 说明 |
|----|----|------|
| `apps-registry` | `[{ name, displayName, icon, mode: "vfs"\|"local", createdAt, sessions: [{ id, title, createdAt, updatedAt, duration? }], sessionOrder?: [id...] }]` | 应用注册表（含内嵌会话列表）；`duration` 为累计对话耗时毫秒（`finishTurn`/`adoptNewApp` 每回合累加，会话级统计）；`sessionOrder` 为手动拖拽排序登记（可省略，缺省按 `updatedAt` 倒序；不在登记里的新会话按最近更新排最前） |
| `chat:<app>:<sid>` / `chat:draft` | 消息数组（同页面 `messages` 结构，含 `role: user/assistant/tool/app` 条目；assistant 条目带 `reasoning`（思考过程文本）/ `model`（回答模型徽标）/ `reasoningOpen`（思考块折叠状态）/ `usage`（回合 token 用量，挂在回合末条 AI 消息上，含 DeepSeek 的 `prompt_cache_hit_tokens` 缓存命中；`context_tokens` 为当前上下文占用估算，进度条用）） | 各会话消息；草稿存 `chat:draft` |
| `thread:<threadId>` | wire 格式消息数组 | Agent 会话记忆（checkpointer）；`threadId` = 应用名 `:` 会话 id，草稿为 `draft` |
| `pref:thinking` | boolean | 思考模式开关偏好（输入区「🧠 思考模式」按钮切换，`init` 时恢复并注入 Agent 的 `thinking` 参数） |
| `pref:ctx-window` | string（token 数，如 `"131072"`） | 上下文窗口大小偏好（输入区 select 切换 128k/256k/512k/768k/1mb，`setCtxWindow` 时持久化，`ready` 时恢复） |
| `pref:active-key` | string（key id 或 `""`） | 对话用 API Key 偏好（`""` = 自动负载均衡；`selectApiKey` 时持久化，`init` 时恢复；key 失效自动回退 `""`） |
| `pref:active-model` | string（模型 id 或 `""`） | 对话模型偏好（`""` = 供应商默认；`selectModel` 时持久化，`init` 时恢复；不属于当前 key 供应商时自动回退 `""`） |
| `ui` | `{ app, session }` | 上次停留位置，`ready` 时恢复 |

### 存储空间 `mazmot` 的 `apps` 键（生成应用登记）

- 虚拟渠道（`buildAppRecord`）：`{ name, desc, icon, source: "virtual", namespace: "ai-apps", dirName: "ai-apps/<name>", virtualDirName, handle: null, createdAt, mazmot: { source: "ai-builder" } }`
- 本地渠道（`buildLocalAppRecord`）：`{ name, desc, icon, source: "local", namespace: "", dirName: name, handle: <DirHandle>, createdAt, mazmot: { source: "ai-builder" } }`
- 登记按 `name + namespace` 去重更新（`registerAppRecord`）；删除用 `unregisterAppRecord`（按 `mazmot.source === "ai-builder"` + name 匹配）；列表查询 `listRegisteredApps` 过滤 `namespace === "ai-apps" || mazmot?.source === "ai-builder"`
- 主系统（apps/main）应用列表：**生成应用一律不进主列表**——虚拟应用落在独立命名空间 `ai-apps/`（不与主系统共享的 `mazmot-apps/` 混用），本地渠道记录仅供妙造（conjure）持久化恢复句柄；主系统 `loadApps` 按 `mazmot?.source === "ai-builder"` 过滤隐藏全部生成应用

### 磁盘 / VFS 落点

- 虚拟渠道：`init("ai-apps")` 根下 `<name>/client/`（运行 URL `/$ai-apps/<name>/client/index.html`）；删除应用时递归删该目录（`deleteVfsApp`）
- 本地渠道：应用文件统一写入**用户所选目录的 `client/` 子目录**（`resolveBaseDir` 按 `rootHandle` 分流，与虚拟渠道布局一致）；预览挂载该 `client/` 目录（`getRunUrl` 本地逻辑，无 `client/` 时回退挂载根目录——兼容历史写在根上的旧应用）；**删除应用不删盘上文件**，只移除登记。历史旧应用的文件在所选目录根上，继续编辑时会在 `client/` 下重建（旧文件不受影响）
- **本地项目导入**：草稿阶段选中本地目录时，若目录里已存在 `client/app.json`（既有项目，`detectLocalProject` 探测），走**导入流程**而非新建——按 app.json 元数据在本应用 registry 与 mazmot apps[] 登记（句柄随记录落库），并从项目目录的 `conjure-chats.json` 恢复会话列表、消息与 Agent 记忆（只补本机缺失的会话，不覆盖本地已有记录），完成后 `selectApp` 切换到该项目；发送中触发的导入（`prepareContext` 草稿分支选完目录发现已切换）会继续按既有应用走会话准备，本轮对话直接落进导入的项目
- **对话快照（conjure-chats.json）**：本地渠道应用的每次回合结束（`finishTurn` 尾部与新建应用落地后）调用 `syncLocalProjectChats`，把会话列表（含 `sessionOrder`、`duration`）、各会话消息（进行中的回合优先取内存桶）、Agent 记忆（`thread:*`）全量写入项目目录 `client/` 同层的 `conjure-chats.json`，供下次导入时同步对话数据；写入失败仅 console.warn 不影响对话
- **数据备份**：两种渠道均在 `client/` 同层落 `backup/<id>/` 目录（虚拟渠道为 `ai-apps/<name>/backup/<id>/`，本地渠道为所选目录 `backup/<id>/`；id 形如 `backup-20260908-153012-<hash8>`，尾部为内容 hash），打包时按原相对路径复制 client/ 全部文本文件并忽略 `node_modules`；内容与已有备份相同则跳过（toast 提示「内容未变化」）；备份可更名与加备注（自定义 label / note 存备份目录内 `__meta.json`，列表优先显示 label——无则回退格式化时间，备注有则显示在目录名下）；两者的编辑合并为一个 `st-dialog` 对话框（名称 st-input + 备注 st-textarea，保存时一并写入；放在 `.app` 层避免抽屉 transform 影响 fixed 遮罩）；每个备份项可还原——confirm 确认覆盖风险后写回，无备份时 confirm 引导先创建备份，当前内容与备份一致时 toast 提示无变动，与当前一致的备份项显示「与当前一致」徽标（store `refreshBackups` 依据 `currentAppHash` 标记 `current` 字段，该项隐藏还原按钮）；入口为顶栏预览按钮旁的「备份管理」按钮 → 右侧加宽抽屉（列表 + 新增备份 + 智能备份 + 还原 + 编辑 + 两步确认删除）；「✨ 智能备份」在打包后用 AI 对比上一版备份自动生成标题与备注（见 builder-store `smartBackup`）

## 关键代码文件速查

| 文件 | 职责 |
|------|------|
| `lib/builder.js` | `NAMESPACE`/`REQUIRED_FILES` 常量；`contextInfo(messages)`（从回合末条 AI 消息的 `usage.context_tokens` 读出当前会话上下文占用，供输入区圆圈进度，窗口总量由页面 select 选定）；`truncateThread(thread, turns)`（把 wire 记忆按回合截断、丢弃末尾未闭合的 tool_calls 回合，供会话 fork 复制记忆）；`tailThread(thread, keepTurns)`（取末尾 k 个完整回合，供压缩后保留最近原文）；`COMPACTION_PROMPT`（上下文压缩摘要的系统提示词）；`sanitizeAppName`（规范化为 `/^[a-z0-9_-]+$/`）、`validateRelPath`（路径白名单校验）；`buildAppJson` / `buildAppRecord` / `buildLocalAppRecord`；`createAppDir` / `writeAppFile`（写入前自动确保 app.json 已初始化，返回值带 `initialized` 标记）/ `ensureAppInitialized` / `readAppFile` / `listAppFiles` / `validateApp`（均接受可选 `rootHandle` 切换渠道）；`registerAppRecord` / `unregisterAppRecord` / `listRegisteredApps` / `deleteVfsApp`；数据备份：`createAppBackup`（把 client/ 全部文件按原相对路径复制到同层 `backup/<id>/`，`node_modules` 整体忽略；id 尾部为内容指纹——对排序后的 路径+内容 清单算 SHA-256 取前 8 位 hex，内容与已有备份一致时跳过写入，幂等去重）/ `listAppBackups`（列 backup/ 下备份目录，新的在前，每项带 `label` 与 `note`——读目录内 `__meta.json`，无则空串）/ `currentAppHash`（当前 client/ 内容指纹，供列表标注「与当前一致」项）/ `currentAppFiles`（当前 client/ 全部文件的 `{path, text}` 清单，供智能备份对比）/ `readBackupFiles`（读取指定备份目录内全部文件（忽略 `__meta.json`），供智能备份取上一版内容）/ `renameAppBackup`（更名写 `__meta.json` 的 label，目录名/内容寻址不变，label 非空且 ≤50 字）/ `setBackupNote`（备注写同一 `__meta.json` 的 note，空串清除，≤200 字）/ `restoreAppBackup`（还原：先比对当前 client/ 内容指纹与备份 id 尾部 hash，一致返回 `unchanged` 不写入；否则清空 client/ 后按备份目录写回，`__meta.json` 不参与还原）/ `deleteAppBackup`（递归删除指定备份，校验 id 格式防路径逃逸，均接受可选 `rootHandle` 切换渠道）；本地项目：`detectLocalProject`（探测目录是否既有项目）/ `PROJECT_CHAT_FILE` + `saveProjectChats` / `loadProjectChats`（项目目录对话快照读写）；`SYSTEM_PROMPT`（教模型 Mazmot/ofa.js 结构与硬性约束；工作流程要求功能文件完成后补写 **AGENTS.md**（给 AI 的开发规范）与 **CONTEXT.md**（项目说明）两份项目文档，且内容须基于实际生成的代码）+ `buildSystemPrompt(ctx)`（按当前上下文动态构建：已选应用时注入应用名/渠道与强制规则——「回答项目问题前必须先 list_files / read_file（至少读 AGENTS.md、CONTEXT.md 和 app.json），禁止凭猜测描述项目」「修改时先读后写，必须先读项目内 AGENTS.md 与 CONTEXT.md 并严格遵守其中约定，改完同步更新 CONTEXT.md」；草稿阶段退回基础提示词） |
| `lib/tools/index.js` | 插件注册中心（见「工具插件体系」） |
| `lib/tools/*.js` + `lib/tools/show-form/` | 六个工具插件，宿主依赖全走 `ctx`；show-form 为目录式包（插件 index.js + 视觉组件 form-card.html + 内置测试 self-test.js + 包测试 test/ + README），插件默认导出可带 `tags`（面板徽标）、`visual`（配套组件模块地址，registry 聚合为 `visualModules` 供页面 `l-m` 声明预载）与 `selfTest`（内置测试模组地址，工具详情对话框「运行内置测试」加载） |
| `pages/home.html` | 唯一页面模块（见下节；只负责视觉与交互，业务委托仓库；输入区行内有上下文占用小圆圈进度 + 最大窗口 select（128k/256k/512k/768k/1mb），`applyMessageEvent` 时经 `syncCtx` 重算；网页 `document.title` 经 watch `currentAppName` 跟随项目切换：草稿「新项目 - 妙造 Conjure」，项目「项目名 - 妙造 Conjure」（会话不体现在 title 上）；输入框 `attr:placeholder` 走 `inputPlaceholder`，由 `syncInputPlaceholder` 按场景切换：草稿「描述你想生成的应用…」、应用内「向 AI 描述要如何迭代这个应用…」） |
| `lib/builder-store.js` | `createBuilderStore({ fs, mazmotStore, selfStore, load })` 可观察状态仓库（见「状态仓库」小节） |
| `lib/markdown.js` | Markdown → HTML（代码块头部为语言标签 + ghost 胶囊复制按钮（图标 + 文案，复制成功短暂变为「已复制」主色态），点击经页面 `attached`（根级生命周期）里挂在 `#chatScroll` 上的事件委托处理，`:html` 重渲后依然有效；围栏代码用 highlight.js 做语法高亮——模块加载时顶层 `await import("/npm/@highlightjs/cdn-assets@11.11.1/es/highlight.min.js")`（common 语言集，SW 拦截离线可用），语言可识别按语言高亮、未标注语言自动探测，超 20k 字符或加载失败（无 SW 测试环境）退化为纯转义；token 配色在 `home.css` 用 `light-dark()` 跟随明暗主题） |

## 状态仓库（lib/builder-store.js）

AI 创作 / 运行过程的全部业务逻辑封装在 `createBuilderStore({ fs, mazmotStore, selfStore, load })` 返回的可观察状态对象中，页面不持有任何业务状态，只订阅事件更新视觉数据。这样「进行中的对话切换应用」等上下文切换都在仓库内部单一代码路径里完成，不会出现页面作用域变量错乱。

**事件契约（`store.subscribe(cb)`）**：

- `{ type: "patch", data }`——state 标量 / 整组数据更新（data 为键值对；`nextId` 为内部计数，页面忽略）
- `{ type: "messages", op, ... }`——消息流水线细粒度变更：`op: "replace"`（带 `list`）/ `"push"`（带 `item`）/ `"patch"`（带 `id, patch`）/ `"splice"`（带 `id`）

**每会话消息桶（切换会话不串台的关键）**：每个会话（含草稿）在 `sessionBuckets: Map<chatKey, 消息数组>` 里有独立的消息桶，`state.messages` 只是「当前查看会话」桶的视图镜像（事件只在操作目标桶 === 当前视图时才发给页面）。发送回合开始时固定 `turnKey`（本回合所属 chatKey），流式消息 / 工具事件 / `finishTurn` 落盘全部路由到该桶——用户中途切到别的会话/项目也不受影响，切回时 `loadSessionById` 检测到 `key === turnKey` 直接投影内存实时桶（不读盘覆盖）。`nextId` 全局单调递增防多桶 id 撞车。删除正在流式的会话/应用时中断回合并丢弃实时桶（`finishTurn` 见桶不存在即跳过落盘）。`toggleTool` / `toggleReasoning` 作用于当前视图桶（可能与回合桶不同）。同一时间只允许一个回合（`sending` 互斥），回合归属会话在左侧列表项上有 `busy` 标记（loading 图标，随 `currentAppSessions` 条目的 `busy` 字段下发，`syncCurrentFromRegistry` 重建列表时按 `turnKey` 复原）。

**state 字段**：`messages` / `sending` / `thinking`（思考模式开关，随 `pref:thinking` 持久化）/ `activeModel`（当前 Agent 的模型标识，AI 消息徽标用）/ `keyError` / `coreError` / `nextId`（消息与发送）；`apps` / `currentAppName`（`""` = 草稿）/ `currentAppDisplay` / `currentAppIcon` / `currentAppMode` / `currentAppSessions` / `currentSessionId` / `currentSessionTitle`（顶栏展示的当前会话标题，`syncSessionTitle` 从 registry 解析，草稿/无会话为空）（应用与会话）；`storageMode` / `localDirLabel` / `permGrantNeeded`（写入目标与授权）；`skills`（技能索引镜像）；`backups`（当前应用备份 id 清单，新的在前）/ `backupBusy`（打包中防重入）/ `smartBackupBusy`（智能备份的 AI 分析阶段）；`apiKeys` / `activeKeyId`（对话用 Key 镜像与选中项）/ `activeModelId`（手动选中的模型）。

**非响应式闭包资源**（不进 state，防响应式拆原型）：`agent`（惰性创建，切换应用/会话/目标后置 null 重建）、`activeBubble`、`pendingNewApp`、`localRootHandle`（本地句柄）、`checkpointer`、`/mz/ai` 与 `/mz/ai/chain` 模块缓存。

**仓库方法**：`init({ initialApp })`（项目标签按 URL `?p=<name>` 恢复：优先回到该项目上次激活的会话——记忆存 `sessionStorage('aib:session:<name>')`，标签页级随标签隔离——无记忆则开最近会话；无 `p` = 草稿标签恢复 `chat:draft`；启动先读一次已安装技能索引填充 `skills`，再后台增量同步）、`send(text)`（prepareContext → 用户消息入列 → Agent 流式对话 → finishTurn 收尾，含 `adoptNewApp` 新应用落地迁移与 `ensureAppRegistered` 兜底登记）、`reloadApps` / `selectApp` / `startDraft(wipeDraft)` / `newSessionFor` / `reorderSessions(fromId, toId)`（左侧会话拖拽排序：以展示顺序为基准移动，顺序持久化到 registry 的 `sessionOrder`，`syncCurrentFromRegistry` 读取该登记排序）/ `loadSession` / `deleteApp(name)`（删除登记与数据；**删的是当前项目时随项目关闭本标签**——项目标签由 window.open 打开、`window.close()` 可关，`beforeunload` 广播 bye 撤掉其他标签的「已打开」徽标；关闭失败（入口直开/浏览器拦截）回退切下一个项目或回草稿）/ `deleteSession` / `renameSession` / `selectMode` / `chooseLocalDir` / `grantLocalPermission` / `installSkillFromSource(url)`（手动安装 / 更新技能，loading 占位见「技能知识库」节） / `openApp` / `refreshBackups`（读当前应用 backup/ 清单）/ `createBackup`（打包当前 client/ 到同层 backup/，见「磁盘 / VFS 落点」）/ `deleteBackup(id)` / `renameBackup(id, label)` / `setNote(id, note)` / `restoreBackup(id)`（返回还原结果，`reason: "unchanged"` 表示无变动未写入） / `toggleTool` / `toggleThinking` / `toggleReasoning(id)`（AI 消息思考过程折叠开关；流式新气泡 `reasoningOpen` 默认展开，历史消息载入时统一收起）/ `compress()`（手动压缩当前查看会话，见「上下文压缩」）/ `setContextWindow(n)`（注入 select 选定的窗口大小，自动压缩判断用） / `selectApiKey(id)`（切换对话用 API Key，"" = 自动，偏好存 `pref:active-key`，切换即 `invalidateAgent` 下一回合生效）/ `selectModel(id)`（切换对话模型，"" = 供应商默认，偏好存 `pref:active-model`）/ `forkSession(fromMessageId)`（会话 fork：复制截至指定消息（含）的聊天记录为新会话（标题加 `⎇` 后缀），Agent 记忆经 `truncateThread` 按完整回合截断复制后落盘，成功即切换到新会话；草稿与发送中不支持）/ `stop`（中断当前生成：`currentAbort.stopped` 置位后流式回调链抛错中断，已生成内容保留并照常落盘，下次发送继续同一 thread）/ `getLocalHandle()`（句柄只读查询）。

## home.html 页面要点

**布局**：`.app`（relative，容纳右侧滑出面板）> `topbar` + `.body-row` > 左 `.side`（会话栏，选中应用即常驻显示：`currentAppName !== ""`；右缘 `.side-resize` 手柄可拖拽调宽，钳制 150–400px，记忆到 `sessionStorage('aib:side-width')`）+ `.main-col`（聊天区 + 输入区；发送按钮在 `sending` 时切换为红色停止按钮 → `handleStop`）。空会话 hero 按场景分两态（`messages.length === 0 && !sending` 内嵌 `o-if currentAppName`）：草稿 =「描述你想要的应用」+ 生成类示例 chips（番茄钟/记账本/随机点名）；已选应用 = 应用图标 + 应用名 + 迭代话题 chips（检查优化 / 新增功能 / 美化界面，经 `useChip` 回填输入框）。顶栏右侧操作区：已进入项目时在「预览应用」按钮旁并列「备份管理」按钮（`openBackupDrawer` → 右侧加宽抽屉 `.backup-drawer`，宽 `min(460px, 92vw)`：顶部「＋ 新增备份」与「✨ 智能备份」按钮（`backupBusy` 时统一禁用；智能备份执行 `store.smartBackup()`：`createAppBackup` 打包 → 取备份列表中除新备份外第一份为上一版 → `currentAppFiles` / `readBackupFiles` 取双方内容，构建「新增/修改/删除文件」差异摘要（单文件截断 2500 字）发给 AI（`assistant.chat` 非流式，复用 `pickAssistant`），要求只输出 `{label, note}` JSON（解析失败退化为整段回复当备注）→ `renameAppBackup` + `setBackupNote` 写入 meta 并刷新列表；首个备份无对比基准，备注改为介绍应用功能；内容无变化时与普通备份一样跳过并 toast）+ 备份清单（`store.refreshBackups()` 刷新，条目展示格式化时间与目录名，两步确认删除 `confirmingDelBackup` → `store.deleteBackup`））。

**会话 fork（分支对话）**：聊天由线性会话构成，每条 AI 消息底部的 usage 行旁有「⎇ fork」按钮（`canFork()` 限定已落地会话且非发送中）→ `store.forkSession(id)` 创建分支：当前会话的聊天记录复制截至该消息（含）为新会话（同应用 registry 下新 `sid`，标题为原标题 + `⎇`），Agent 记忆 `thread:<app>:<sid>` 经 `truncateThread` 按完整回合截断复制（fork 点所在回合若因中途停止而未闭合——末条 assistant 仍带 tool_calls——该回合整段舍弃，防悬空 tool_calls 打崩后续请求），随后 `loadSessionById` 切换到新会话，两侧从此各自独立演化。左侧会话列表支持拖拽排序：HTML5 drag 事件（`sessionDragStart/Over/Leave/Drop/End`，拖过项显示上缘指示线），落点调仓库 `reorderSessions(fromId, toId)` 持久化到 registry 的 `sessionOrder`；对话进行中的项 loading 替代删除按钮槽位且不可删除（`deleteSession` 对 `turnKey` 命中的会话兜底拒绝）。对话计时展示在右侧聊天区：所有消息入桶时统一打上落盘时刻 `ts`（`pushMessage` 补齐）；非 AI 消息 hover 才显示时间（`.msg-ts`），AI 消息的时间与本轮耗时固定在 `ai-foot` 行最右侧（`.ai-time`，如 `17:09:11 · 2分05秒`）；回合进行中「生成中…」右侧由页面每秒 `clock` 心跳实时计时（`turnLiveText`，依赖仓库状态 `turnStartTs`，回合结束清零），回合结束后 `send` 收尾把本轮耗时 `turnMs` patch 到回合末条 AI 消息上随会话桶落盘。消息事件（含流式 patch）统一触发 `followScroll`：只要处于底部就持续跟随，手动拉回底部即恢复自动跟随。无 `ts` 的历史消息不显示时间。

**上下文压缩**：模型实际读到的上下文只来自 Agent 记忆 `thread:*`（checkpointer），显示层 `chat:*` 不参与 prompt——因此压缩只替换记忆、不动聊天记录。仓库 `compressThread(chatKey)`：把 wire 消息拼成对话稿（超长掐头留尾）→ 用 `pickAssistant()` 发一次独立摘要请求（不走 `agent.chat`，系统提示词 `COMPACTION_PROMPT` 要求保留需求/文件清单/决策/待办，≤800 字）→ 新记忆 = 摘要 user 消息 + assistant 确认 + `tailThread(thread, 2)` 最近两个完整回合原文 → 落盘，并在聊天流插入 `role: "compact"` 卡片（`count` 被压缩条数 + `summary` 可展开查看，模板复用 tool-row 折叠样式）。触发两路：① 手动——上下文进度圆圈即压缩按钮（`handleCompress` → `store.compress()`，`compacting` 状态防重入，对话过短/发送中弹 alert 说明）；② 自动——发送前（`send` 内，`ensureAgent` 之后）用 `contextInfo` 估算 `已用 + 本轮输入 ≈ chars/2 + 64`，达到窗口（`setContextWindow` 注入的 select 值，页面在 ready/切换时同步）即先压缩再对话，失败仅 console.warn 不阻塞。压缩只在两回合之间发生，chain 每回合收尾的 checkpointer.set 整体覆盖语义不受影响；水位显示要等下一回合的 `context_tokens` 回来才会下降。

**项目导航（标签制）**：每个项目一个网页标签，URL 以 `?p=<name>` 标识（草稿标签无 `p`）。顶栏品牌区——已进入项目时显示应用 Logo + 名称 + 渠道徽标 + 项目下拉按钮，右侧再并列小字号的当前会话标题 + 编辑按钮（`editSessionTitle` → senti-ui `prompt.js` 重命名，仓库 `renameSession` 同步 registry / 列表 / 顶栏）；草稿时显示「妙造 / 新应用 · 未创建」。项目名右侧下拉按钮（`st-icon-button` + `mdi:chevron-down`，草稿态同样显示）→ **左侧项目抽屉**（`.proj-drawer` + 遮罩，复用 `.panel-item` 列表项样式）：顶部「＋ 新建项目」按钮；项目清单每项含图标 / 名称 / 渠道徽标 / 目录名、「已打开」徽标（`openTabs`）与两步确认删除按钮。点击项：当前为空白草稿态（`currentAppName === ""`）且该项目**未在其他标签打开**时**在当前页内切换**——`openProjectTab` 直接调仓库 `selectApp(name)` 加载该项目并打开最近会话，收起抽屉（URL `p` 由 `syncUrlParam()` 自动补上）；目标项目已打开（`openTabs` 命中，「已打开」徽标同一数据源）则与已进入项目时一致聚焦那个标签，避免同一项目被两个标签同时接管。窗口名 `ai-builder-<name>` / `ai-builder-draft`；打开/聚焦统一走 `focusOrOpenTab(url, name)`——先 `window.open("", name)` 拿同名标签引用（已存在时**仅聚焦不导航**，避免 `window.open(url, name)` 对已存在标签执行同 URL 导航造成的整页刷新），拿到的是 `about:blank` 新空白标签时才补 `location.href = url`。（「＋ 新建项目」在草稿态同样只收起抽屉留在本页）。窗口名由 `syncTabName()` 跟随 `currentAppName` 实时同步（草稿 = `ai-builder-draft`，项目 = `ai-builder-<name>`，与 `syncUrlParam()` 同一处触发）——标签**原地切换**（草稿里生成落地 / 草稿里点项目）后必须改名，否则项目标签顶着 `draft` 旧名，再点「新建项目」会把该项目标签本身导航回草稿。「已打开」状态由跨标签感知维护：`BroadcastChannel("ai-builder-tabs")` 广播 `hello` / `alive` / `bye`（本标签 `announce(currentAppName)`，`beforeunload` 发 `bye`；打开抽屉时 `refreshAliveTabs()` 清空重探测）。URL `p` 参数由 `syncUrlParam()` 跟随 `currentAppName` 用 `history.replaceState` 同步（草稿落地为新应用后自动补 `p`，刷新不丢项目）。右侧 `.panel` 为「工具 / 技能」双 tab 的资源面板，`.panel-mask` 为 absolute 覆盖层。

**职责边界**：页面 `data` 是仓库状态的**视觉投影**——`ready()` 里 `store.subscribe()` 把 patch 事件键值直接赋给同名 data 字段，messages 事件细粒度应用到 `this.messages`（`applyMessageEvent`）；`proto` 方法是对仓库方法的薄代理（会话两步删除 `confirmingDelSession` + `removingSid` 折叠动画——删除按钮平时为圆形、确认时形变圆角方形，二次点击后 item 高度/透明度归零再真正删除；项目两步删除 `confirmingDelApp` 与 `panelOpen` / `panelTab` / `projDrawerOpen` / `openTabs` / `input` / `atBottom` 等纯 UI 状态留在页面）。业务变更一律调仓库方法，页面不直接改业务数据。

## 运行方式

- 在 Mazmot 系统内经应用市场安装后运行（`?app=conjure` 官方应用分享格式）
- 依赖宿主环境：NoneOS Core Service Worker 提供 `/nos/*` 与 `/gh/` 前缀，Mazmot 宿主提供 `/mz/ai/*` 与 `/mz/app-runner.js`；页面模块内 `load()` 按需加载，禁止顶层 `import "/nos/*"`、`"/mz/*"`
- AI 生成需宿主已配置 AI Key（「AI 密钥管理器」应用）；本地目录渠道仅 Chrome（`fs.open()`）

## 测试

- 测试框架 sibyl-test，`test/builder.sb.html` 覆盖：`sanitizeAppName` / `validateRelPath`（正常 + 非法路径）/ `truncateThread`（按回合截断、未闭合回合丢弃）、`buildRunUrl` / `buildAppRecord` / `buildLocalAppRecord` / `buildAppJson`、`createAppBackup` / `listAppBackups` / `deleteAppBackup` / `restoreAppBackup`（fake fs：打包忽略 node_modules、内容还原、内容 hash 去重跳过、内容变化产生新备份、更名与备注读写、空串清备注、还原覆盖写回与无变动检测、id 校验、`currentAppFiles` / `readBackupFiles` 读取清单（忽略 __meta.json、非法 id 报错））、`reorderSessions`（fake 自存储：拖拽排序持久化 sessionOrder、新会话排最前、非法参数无变化）、本地项目导入（fake fs + fake 自存储：`detectLocalProject` 探测、`conjure-chats.json` 快照读写 roundtrip、草稿选本地目录自动导入并切换、消息与记忆恢复、mazmot 登记携带句柄）、工具插件注册中心（fake tool + 内存 fake fs 验证 ctx 注入与回调连通）、`show_form` 视觉表单（参数清洗、提交返回 data JSON、取消返回 cancelled、环境不支持/字段全不合法的降级）、`createAppDir` → `writeAppFile` → `validateApp` 端到端（需先访问 `/` 装好 Core）
- show-form 包自带测试 `lib/tools/show-form/test/show-form.sb.html`：复用包内 `runSelfTest()` 断言（纯模块环境跑插件层 + 预载组件环境跑组件层：控件渲染 / 提交事件 / 只读回填 / XSS 转义），另验 `visual` / `selfTest` 导出约定
