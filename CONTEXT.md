# Mazmot 项目 Context

> 项目全局视图，帮助 AI 快速掌握当前架构、技术栈和关键设计。阅读后再针对具体任务查看相关文件即可。

## 项目定位

**Mazmot** 是一个基于浏览器的 **AI 应用启动器 / 迷你操作系统**（README 描述："让你快速的启动 AI 应用。无需配置，无需安装，无需学习"）。用户通过它管理并运行多个独立的 Web 应用。

## 核心技术栈

| 层级 | 技术 | 用途 |
| ---- | ---- | ---- |
| 底层 | noneos-core | 虚拟文件系统、用户管理、Service Worker、挂载本地目录 |
| 应用框架 | ofa.js | 组件/页面模块、路由、状态管理，无需 Node/Webpack |
| UI | Punch-UI v2 | Material Design 风格组件（`p-list`、`p-dialog`、`p-button` 等） |
| 存储 | ever-cache | 基于 IndexedDB 的异步存储（类 localStorage） |
| 图标 | `n-icon` (`/nos/n-icon/n-icon.html`) | 业务代码统一用 `<n-icon icon="mdi:xxx">`；底层会加载 `iconify-icon`，请勿直接调用其 API |

**约束**：所有代码必须符合 ofa.js 语法（`<o-if>`、`<o-fill>`、`on:click`、`proto`/`data`、`sync:`、`:style.` 等），禁止 Vue/React 语法。详见 [AGENTS.md](AGENTS.md)。

## 目录结构

```
Mazmot/
├── index.html                # 根入口：初始化/升级 NoneOS Core，完成后跳转 /apps/main/ 或 ?redirect=
├── sw.js                     # NoneOS Core Service Worker（在根入口注册，scope=/）
├── AGENTS.md                 # AI 开发规范（必读）
├── CONTEXT.md                # 项目架构上下文（本文档）
├── package.json              # 提供 static（http-server:30031）/ test（sb-test）/ build 等脚本
│
├── apps/                     # 应用（monorepo 风格）
│   ├── main/                 # 主应用：应用列表 / 添加 / 分享入口，URL = /apps/main/
│   │   ├── index.html        # 入口 HTML：校验 Core 模块 → 装载 ./app-config.js；同时挂载 <rdn-network> 浮窗
│   │   ├── app-config.js     # ofa.js 主应用配置（init "mazmot" 命名空间）
│   │   ├── home.html         # 应用列表主页（页面模块）
│   │   ├── home/
│   │   │   ├── add-app.html          # 添加应用 3 步向导（子页面，弹窗内加载）
│   │   │   ├── template-writer.js    # 模板加载与写入（从 templates/<id>/ 读取源文件，按 __files.json 的 replacements 清单替换后写入 client/）
│   │   │   ├── templates/            # 应用模板资源目录
│   │   │   │   ├── manifest.json     # 模板清单（添加新模板时登记 id/name/desc）
│   │   │   │   └── <id>/             # 每个模板一个子目录，含 __files.json（文件清单 + 替换规则）+ .html/.json/.js 源文件；当前有 base（Hello World）和 chat（NoneOS Core P2P 聊天）
│   │   │   └── app-status.js         # 应用打开状态追踪（BroadcastChannel + LS + window 引用）
│   │   └── lib/              # 主应用工具库，同时被 run-app 反向引用
│   │       ├── app-runner.js         # 应用运行辅助：mount() 本地目录 / 生成运行 URL
│   │       ├── share-mgr.js          # 分享工具：DataPublisher 单例 / 签名 payload / Base64URL / verifyData
│   │       └── test/                 # sibyl-test 单元测试（_install-nos.sb.html / app-runner.sb.html / share-mgr.sb.html）
│   │
│   ├── run-app/              # 分享接收应用，URL = /apps/run-app/?u=...&h=...
│   │   ├── index.html        # ofa.js 外壳：<o-router> + <o-app src="./app-config.js">（不校验模块，Core 由页面模块自己装）
│   │   ├── app-config.js     # 声明 home = ./run-app.html（不 init 文件系统，Core 未装时不可用）
│   │   ├── run-app.html      # 页面模块（壳）：内嵌 <nos-version auto-install> 装 Core → 加载 lib/*.js → 编排验签 / 确认 / 安装 / 跳转
│   │   └── lib/              # run-app 的模块化拆分（run-app.html 只做 UI / 状态编排）
│   │       ├── run-app-utils.js      # 纯工具函数（formatStatus / buildErrorDetail / mapAppProgress 等，便于单测）
│   │       ├── install-flow.js       # 安装流程（fetchSharePayload / findInstalled / installAppPackage）
│   │       ├── connection.js         # 连接层（waitForRtcReady / requestChunkWithRetry）
│   │       ├── diag.js               # 诊断信息采集器（出错时把 timeline / 路径 / 事件拼进 errorDetail）
│   │       └── test/
│   │           └── run-app-utils.sb.html  # run-app-utils 的 sibyl-test 单测
│   │
│   └── network/              # 网络应用（服务器/用户连接状态与流量监控），URL = /apps/network/
│       ├── index.html        # 应用入口 HTML：校验 /nos/fs、/nos/user 模块
│       ├── app-config.js     # ofa.js 配置（home = ./home.html，init "mazmot"）
│       ├── home.html         # 首页：上部服务器网格 + 下部已连接 RemoteUser 网格，点击跳转详情
│       ├── server-detail.html # 服务器详情：连接状态 / 版本 / 延迟 / 连接·断开·测试延迟
│       ├── user-detail.html  # 用户详情：在线状态 / SessionIds / RTT / Ping / 断开
│       └── traffic.html      # 流量监控：汇总卡片 + 服务器/用户的实时带宽与连接统计
│
├── comps/                    # 系统级公共组件（ercode / rdn-network / rnd-box），详见 comps/CONTEXT.md
│   ├── ercode/               # <m-ercode> 二维码组件（被主应用分享弹窗使用）
│   ├── rdn-network/          # <rdn-network> 浮窗式网络面板（被 apps/main/index.html 挂载）
│   ├── rnd-box/              # <m-rnd-box> 可拖拽缩放浮动盒子容器
│   └── CONTEXT.md            # 组件上下文说明
│
├── ai/                       # 独立子项目：AI Provider 抽象层（DeepSeek/Kimi），不被主系统直接引用
│   ├── main.js               # 入口：saveKey / getAssistant / apiKeys（基于 ever-cache）
│   ├── supplier/             # provider 实现（assistant.js 基类 / deepseek.js / kimi.js）
│   ├── demo/                 # 独立 ofa.js demo 应用（api-keys / chat / layout）
│   └── README.md             # 完整 API 文档
│
├── .github/workflows/        # CI：test.yml 跑 sibyl-test 多浏览器矩阵（Chrome/Firefox/WebKit）
│
├── others/                   # 实验性/一次性测试页（语音、whisper、向量检索等），可忽略
│
└── old/                      # v1/v2/v3/v4 历史版本（不参与新逻辑，含废弃的 container 模式）
```

## 关键架构：应用直接在主域运行

### 运行方式

应用文件存放在两类目录中：

- **虚拟目录**：`init("mazmot-apps").get(appName)` 下的 `client/` 子目录。
  - 运行 URL：`/$mazmot-apps/{appName}/client/index.html`
  - 由 NoneOS Core Service Worker 直接拦截并返回虚拟文件。
- **本地目录**：用户通过 `open()` 选择的文件夹（仅 Chrome 支持）。
  - 运行前先把 `client/` 子目录 `mount()` 到主域，得到类似 `$mount-xxx>dirName` 的路径。
  - 运行 URL：`/{mounted.path}/index.html`

应用通过 `window.open(runUrl)` 直接打开，不需要额外的容器服务器或跨 `iframe` / `window.open` 的容器页。

### 安全说明

由于应用和主系统**同域**运行，应用理论上可以访问主系统的 IndexedDB / Service Worker。当前方案以"兼容 Safari、简化部署"为优先，不再做 Origin 级隔离。容器模式已废弃，相关代码仅保留在 `old/v4/container/` 中。

## 应用生命周期

### 1. 添加应用（[apps/main/home/add-app.html](apps/main/home/add-app.html)）

```
选择应用来源 → 输入应用名 → 校验唯一性
   ├─ 本地目录：open() 选择目录
   │    └─ probeExistingApp(handle)：读 client/app.json（回退根 app.json）
   │         ├─ 命中且用户点「直接导入」→ importExistingLocalApp：直接 push 到 storage.apps 并关闭弹窗（不写模板）
   │         ├─ 命中且用户点「取消」→ 用 manifest.name / description 预填 step2 表单继续
   │         └─ 未命中 → 进入 step2 让用户填名称
   └─ 虚拟目录：确认名称后 (await init("mazmot-apps")).get(name, {create:"dir"}) 建立子目录
   ↓
存入 ever-cache 的 apps[]（本地：存原生 handle；虚拟：namespace=mazmot-apps，handle=null）
   ↓
writeTemplateFiles 写入 4 个模板文件到目标目录的 client/ 子目录（仅新建流程走到这里）
   ↓
完成
```

### 2. 启动应用（[apps/main/home.html](apps/main/home.html)）

```
handleOpen / handleOpenWindow / handleOpenTab
   ↓
loadApps 重新初始化存储的句柄（本地：new DirHandle(app.handle)；虚拟：init+get 重建）
   ↓
app-runner.js getRunUrl(app)
   ├─ 虚拟：返回 /$mazmot-apps/{name}/client/index.html
   └─ 本地：mount(clientDir) 后返回 /{mounted.path}/index.html
   ↓
window.open(runUrl)
```

### 3. 删除应用

```
clearOpened → 关闭窗口
（虚拟目录）app._handle.remove() → 移除虚拟子目录
从 ever-cache.apps 移除记录
```

## 数据模型

### ever-cache `apps` 数组结构

#### 持久化字段（写入 `EverCache("mazmot").apps`）

```javascript
{
  name: "my-app",           // 唯一 recordName（字母/数字/_-，不含空格）；运行时常被映射到 _recordName
  desc: "描述",
  handle: FileSystemDirectoryHandle | null, // 本地目录存原生句柄；虚拟目录为 null
  dirName: "选择的目录名 / 虚拟命名空间",   // 虚拟目录形如 "mazmot-apps/<name>"
  source: "local" | "virtual",
  namespace: "mazmot-apps",  // 仅 virtual 有值，(await init(namespace)).get(name) 即可重建 handle
  appId: "my-app-abc123def456...",  // 稳定 ID = `${应用名}-${LocalUser.userId}`，跨设备识别同一应用
  autoShare: false,          // 是否开启自动分享（开关切换时由 _persistAppField 写回）
  createdAt: timestamp
}
```

#### 运行时字段（[home.html](apps/main/home.html) 的 `loadApps()` 在内存里拼装出来，不持久化）

```javascript
{
  // —— 持久化字段的镜像 ——
  ...上述持久化字段,

  // —— 句柄 / 路径相关 ——
  _handle: DirHandle,        // 重建后的目录句柄（虚拟走 init+get，本地走 new DirHandle(handle)）
  _recordName: app.name,     // 与持久化的 name 同值，给 lib 函数用的一致 key
  virtualDirName: "my-app",  // 从 dirName 去掉 namespace 前缀后的纯目录名，getRunUrl 优先用它

  // —— 来自 client/app.json 的展示元数据（manifest 缺失时回退） ——
  icon: "📦",
  name: "我的应用",           // 显示名（manifest.displayName || manifest.name || app.name），覆盖持久化的 name
  desc: "...",
  version: "0.1.0",

  // —— UI 状态 ——
  source: "local" | "virtual",
  namespace: "...",
  appId: "...",
  isMine: boolean,           // appId 后缀 === 当前用户 userId，标识「自己开发的应用」
  opened: boolean,           // 窗口是否存活（BroadcastChannel + window 引用判定）
  autoShareValue: "on" | "off",   // 供 sync:value 双向绑定用
  autoShareUrl: "",          // 已发布的短链接；空字符串表示尚未就绪
  autoShareState: "idle" | "pending" | "publishing" | "ready" | "error",
  autoShareStatus: "已关闭 / 等待发布 / 发布中... / 已发布，对方可直接连接 / 错误描述",
}
```

> 注意：`app-runner.js` 的 `getRunUrl(app)` 读取的是**运行时对象**：`source` + `namespace` + `virtualDirName || name` + `_handle`。`share-mgr.js` 的 `publishApp(app)` 读取的是 `_handle` + `_recordName` + `name` + `version` + `desc` + `icon` + `appId`。

### 应用数据模型约束（强约定）

以下约束散落在 [add-app.html](apps/main/home/add-app.html) / [home.html](apps/main/home.html) / [app-runner.js](apps/main/lib/app-runner.js) / [share-mgr.js](apps/main/lib/share-mgr.js)，新增 / 修改相关代码时必须保持一致：

- **应用目录布局**：每个应用在目标位置（本地目录或 `$mazmot-apps/{recordName}/`）下必须有 `client/` 子目录；`client/` 内必须至少含 `app.json` 与 `index.html`。读取应用文件时优先取 `client/`，缺失时回退到根目录（仅用于兼容老数据，新代码不要再产生这种布局）。
- **应用名规则**：`name`（= `_recordName`）只能含字母、数字、下划线、连字符（`/^[A-Za-z0-9_-]+$/`），不能含空格；由 [add-app.html](apps/main/home/add-app.html) 的 `validateName` 与 `importExistingLocalApp` 双重校验。
- **`appId` 生成规则**：固定为 `` `${name}-${LocalUser.userId}` ``，由 [share-mgr.js](apps/main/lib/share-mgr.js) 的 `generateAppId` 产生。`userId` = 公钥的 SHA-256 十六进制，跨设备稳定。`appId.endsWith("-" + currentUserId)` 用来判定"自己开发的应用"（`isMine`）。
- **虚拟目录路径推导**：`virtualDirName = dirName.replace(/^mazmot-apps\//, "")`（若 `dirName` 不带前缀则直接用 `dirName`，再兜底到 `name`）；`getRunUrl` 优先用 `virtualDirName`，老数据回退到 `app.name`。
- **持久化字段最小集合**：`name / desc / handle / dirName / source / namespace / appId / autoShare / createdAt`。新增字段必须同步更新 [share-mgr.js](apps/main/lib/share-mgr.js) 的 payload `meta` 与"数据模型"小节。
- **`app.json` 元数据**：至少包含 `name` / `displayName` / `version` / `icon` / `description`；`home.html` 的 `loadApps` 读它覆盖持久化的 `name` / `desc` 用于显示。

### 应用模板文件（[template-writer.js](apps/main/home/template-writer.js)）

生成 4 个文件，存放在目标目录的 `client/` 子目录下（给用户新建的子应用用的模板）：

- `app.json` — 应用元数据（name / displayName / version / icon / entry / permissions / capabilities）
- `index.html` — 入口 HTML，加载 ofa.js + router + Punch-UI + `./app-config.js`
- `app-config.js` — 定义 `home` 页面路径和过渡动画
- `pages/home.html` — Hello World 页面模块

## UI 关键组件（[apps/main/home.html](apps/main/home.html)）

### 主界面

- `<p-dialog>` 承载 `<o-page src="./home/add-app.html">` 弹窗
- `<p-list>` + `<o-fill :value="appList">` 渲染应用列表
- 每个 `<p-list-item>` 是 **可折叠**（`collapsible`）：
  - **主行 suffix**：`已打开` 徽章 + `新标签打开`(mdi:tab-plus) + `小窗口打开`(mdi:open-in-new) 两个 icon 按钮
  - **主行点击**：`on:click-main="handleOpen"` 触发打开（区分展开箭头点击）
  - **折叠子列表**：显示应用来源徽章、目录名称、应用 ID、删除按钮

### 状态追踪（[app-status.js](apps/main/home/app-status.js)）

用 `BroadcastChannel("mazmot-app-status")` + localStorage `mazmot-opened-apps` 双重追踪应用窗口。使用 `appName` 作为唯一标识符。

## 开发/调试

### 启动服务

```bash
npm run static
```

启动后：
- 主系统：http://localhost:30031/

### 首次访问

1. 访问 30031 根路径 → 根 `index.html` 加载 `nos-version` 自动安装/升级 NoneOS Core；完成后根据 `?redirect=` 跳转，默认进入 `/apps/main/`
2. 进入 `apps/main/index.html` → 先动态导入 `/nos/fs/main.js` 校验 Core 模块；若缺失则回根入口升级，再装载 `./app-config.js`（`init("mazmot")` 初始化文件系统）。同时 `<l-m>` 加载并挂载 `<rdn-network>` 浮动网络面板（可拖拽 / 收起为气泡），让用户在主应用内直接查看网络状态。
3. `apps/main/home.html` 加载显示应用列表（初始为空）

> 直接打开分享链接（`/apps/run-app/?u=...&h=...`）时，`run-app/index.html` 只作为 ofa.js 外壳，不主动校验 Core 模块。`run-app.html` 页面模块内部内嵌 `<nos-version auto-install>` 自动装/升级 Core；Core 就绪后才通过 `load(...)` 并行加载 `/nos/fs`、`/nos/user`、`/nos/publish`、`/nos/crypto` 等模块（任一加载失败即进入错误页）。

### 运行测试

使用 [sibyl-test](https://github.com/ofajs/sibyl-test) 编写浏览器端单元测试。测试页为普通 HTML，需先完成 NoneOS Core 安装后再打开：

**主应用工具库测试**（[apps/main/lib/test/](apps/main/lib/test/)）

- `http://localhost:30031/apps/main/lib/test/_install-nos.sb.html` — 校验 `<nos-version>` 在 Core 已安装场景下能正确触发 `installed` 事件并携带版本号（其他测试依赖 Core 已就绪）
- `http://localhost:30031/apps/main/lib/test/app-runner.sb.html` — 测试 [app-runner.js](apps/main/lib/app-runner.js) 的 URL 生成与文件读取
- `http://localhost:30031/apps/main/lib/test/share-mgr.sb.html` — 测试 [share-mgr.js](apps/main/lib/share-mgr.js) 的 Base64URL、分享链接与打包结构

**run-app 工具库测试**（[apps/run-app/lib/test/](apps/run-app/lib/test/)）

- `http://localhost:30031/apps/run-app/lib/test/run-app-utils.sb.html` — 测试 [run-app-utils.js](apps/run-app/lib/run-app-utils.js) 的 `formatStatus` 步骤前缀、`buildErrorDetail` 错误拼装、`mapAppProgress` 进度映射等纯函数

**快速调试单文件**：

```bash
npx sb-test -f apps/run-app/lib/test/run-app-utils.sb.html --browsers chrome
```

**CI**：[.github/workflows/test.yml](.github/workflows/test.yml) 在 push / PR 时通过 `ofajs/sibyl-test@v1` action 跑 Chrome（Ubuntu）/ Firefox（Ubuntu）/ WebKit（macOS）三浏览器矩阵。

### 添加并运行第一个应用

1. 点击"添加应用" → 选择本地目录（Chrome 才支持）或虚拟目录
2. 输入名称 → 写入 4 个模板文件到目标目录的 `client/` 子目录
3. 应用列表出现新项
4. 点击应用行或 `tab-plus` / `open-in-new` 按钮启动

## 应用分享（基于 DataPublisher）

用点对点方式把应用发给别人，无需 zip、无需后端。

### 分享（发布端）

1. 分享入口只剩一个：在应用列表折叠子项开启「自动分享」开关 → `handleAutoShareToggle` → `autoShareApp` → [share-mgr.js](apps/main/lib/share-mgr.js) 的 `publishApp(app, { appId, onProgress })`，返回 `{ shareUrl, appId, payloadHash }`。操作行不再有独立的「分享应用」按钮。
2. `publishApp` 内部：`readAppFiles(handle)` 读 `client/` 下所有文件 → `ensurePublisher()` 拿到 `LocalUser("mazmot")` + `DataPublisher` 单例 → `buildPackageFile(files, meta)` 打成 UTF-8 JSON `File` → `publisher.publish(file)` 得到应用包 `manifest.fileHash` → 拼装扁平 `payloadData`（展示元数据 + `publisherUserId` + 应用包 `fileHash`）→ `buildSharePayloadFile(payloadData)` → `publisher.publish(payloadFile)` 得到 `payloadManifest.fileHash`（core manifest 已带 ECDSA 签名）→ `buildRunUrl(origin, userId, payloadHash)` → `{origin}/apps/run-app/?u={userId}&h={payloadHash}`。
3. 「分享链接」行：开关开启后额外显示（`<o-if :value="$data.autoShare">`），行内含只读链接文本 + 复制按钮（`copyAutoShareUrl`） + 二维码按钮（`showShareQrCode`，弹出仅显示 `<m-ercode>` 二维码 + 链接文本 + 「复制链接」的 `shareDialogOpen` 弹窗）。链接未就绪时两个按钮均 `disabled`。
4. `home.html` 的 `attached()` 与 `refreshApps()` 都会调 `_runAutoShareAll()`，对所有 `autoShare=true` 的应用重新执行一次 `publishApp`，保证进入 home 页时对端可直接连接、无需再点击分享。
5. P2P 依赖发布者在线：只要 main 所在标签页保持打开（`_publisherCache` 常驻），对方即可通过短链接从本机拉取应用；关闭该标签页即断供。

### 接收（`/apps/run-app/?u=...&h=...` → [run-app/index.html](apps/run-app/index.html) → [run-app.html](apps/run-app/run-app.html)）

用于「分享 → 一键进入」场景，全流程静默；若本地已装其他应用则弹窗确认，其余步骤自动完成：

> 架构说明：`run-app.html` 只负责 UI / 状态编排 / 事件绑定。所有纯逻辑都拆到了 [run-app/lib/](apps/run-app/lib/) 下四个模块（`run-app-utils.js` / `install-flow.js` / `connection.js` / `diag.js`），页面模块在顶部一次性 `load(...)` 拿到工具函数后调用。这样 `run-app-utils` / `connection` 等纯函数可以单独跑 sibyl-test 单测，详见 [run-app/lib/test/run-app-utils.sb.html](apps/run-app/lib/test/run-app-utils.sb.html)。

1. `index.html` 只承担 ofa.js 外壳（`<o-router>` + `<o-app src="./app-config.js">`），`app-config.js` 声明 `home = "./run-app.html"`；由于 Core 可能尚未安装，`app-config.js` **不** `init("mazmot")`，也不会校验任何 `/nos/*` 模块。
2. 页面模块内嵌隐藏的 `<nos-version auto-install>` 组件，通过模板 `on:check-start` / `on:uninstalled` / `on:upgradable` / `on:install-start` / `on:install-progress` / `on:installed` / `on:error="onCoreError($event)"` 声明式绑定到 `proto.onCoreXxx` 方法；`coreReady` Promise 由 `onCoreInstalled` / `onCoreError` 通过闭包变量兑现。Core 检测/安装占进度条前 40%。
3. 步骤计数：模块顶部有 `STEPS` 数组（共 9 步），进度条上方的 `statusText` 一律带 `n/N · 描述` 前缀（由 `run-app-utils.js` 的 `formatStatus` 生成），通过 `enterStep(index)` + `setProgress(percent, text)` 联动。
4. Core 就绪后使用 `load = lm(import.meta)` 并行加载 `/nos/fs`、`ever-cache`、`share-mgr.js`、`/nos/user`、`/nos/publish`、`/nos/crypto`。`parseShareUrl` 得到 `{ userId, payloadHash }`；`connectUser(userId)` 后调用 `install-flow.js` 的 `fetchSharePayload`（内部：`requestManifest` → `isPublicKeyOfUser` 核对签发者 → `connection.js` 的 `requestChunkWithRetry` × N → `assembleFile`）得到 payload JSON。
5. `findInstalled(payload)`：
   - 未安装 or 已安装但版本不同 → 走 `installOrUpdate` 流程（复用步骤 4 已建立的 `remoteUser` → `requestManifest(payload.fileHash)` → `requestChunk` × N → `assembleFile` → 写入 `$mazmot-apps/{recordName}/client/`；`recordName` = `payload.appId`，覆盖时沿用旧目录）。
   - 已安装且版本一致，或来自本人分享 → 跳过下载直接跳转。
6. 若本地已存在至少一个"其他"应用（同 appId 视为自身，会走覆盖升级不算），下载前把 `step` 切到 `confirm` 步骤：页面以 `<o-fill>` 列出已装应用 + 数据可互通的安全提示，让用户「确认安装 / 取消」。逻辑通过 `_confirmResolver` 缓存的 Promise resolver 实现，取消即停止流程。
7. 无论走哪条分支，最后 `location.replace("/$mazmot-apps/{recordName}/client/index.html")` 在同一标签页替换到应用地址。
8. 任意步骤抛错均调用 `fail(title, err)`：错误页除展示标题与 message 外，还会显示"出错步骤：n/N · 描述"，以及一个只读的详情框（`error-detail`，等宽字体、`white-space: pre-wrap`）打印 `err.name / message / code / cause / stack`（长 base64 data URL 会被自动缩略），便于开发者排查；同时 `console.error` 一次原始 err 对象。所有走过的状态文案都保留在下方"历史步骤"折叠框里，可回看。

### URL 与 Payload 结构（短链接方案）

**URL** 只包含两个字段：

- `u` — 发布者 `userId`（core 会用它 `connectUser`；`userId = sha256_hex(publicKey)`）
- `h` — 分享清单在发布者 IndexedDB 中的 `manifest.fileHash`

**分享清单 payload**（通过 `publisher.publish` 发布，接收端拉取）：

```json
{
  "v": "1.0.0",
  "appId": "...",
  "recordName": "...",
  "displayName": "...",
  "version": "...",
  "description": "...",
  "icon": "...",
  "publisherUserId": "...",
  "fileHash": "...",
  "sharedAt": 0
}
```

安全锚点由三层组成：
1. `connectUser(u)` 会话本身由 core 做 E2E 密钥握手，链接被伪造 userId 就连不上。
2. `publisher.requestManifest` 内部 `verifyData(manifest)` 校验 ECDSA 签名。
3. `requestChunk` 内部按 SHA-256 校验 chunk 内容，防篡改。
4. 显式 `isPublicKeyOfUser(manifest.publicKey, u)` 把 URL 的 userId 与签名者绑定起来。

### 关键约束

- 发布者必须保持标签页在线；DataPublisher 是 P2P 的，关闭页面对方无法拉取剩余块。
- 目前分享包只支持 UTF-8 文本文件。二进制资源后续通过 `encoding: "base64"` 扩展。

## 关键代码文件速查

| 需求 | 打开文件 |
| ---- | -------- |
| 修改应用列表 UI | [apps/main/home.html](apps/main/home.html) |
| 修改添加应用流程 | [apps/main/home/add-app.html](apps/main/home/add-app.html) |
| 应用运行 URL 生成 / 文件读取 | [apps/main/lib/app-runner.js](apps/main/lib/app-runner.js) |
| 应用模板内容 | [apps/main/home/template-writer.js](apps/main/home/template-writer.js) + [apps/main/home/templates/](apps/main/home/templates/) |
| 应用打开状态 | [apps/main/home/app-status.js](apps/main/home/app-status.js) |
| 分享工具（发布/验签） | [apps/main/lib/share-mgr.js](apps/main/lib/share-mgr.js) |
| 分享接收页（壳 + 编排） | [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 分享接收页业务逻辑 | [apps/run-app/lib/](apps/run-app/lib/)（install-flow / connection / diag / run-app-utils） |
| 分享一键跳转入口 | [apps/run-app/index.html](apps/run-app/index.html) + [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 静态服务器 / npm 脚本 | [package.json](package.json)（`npm run static` 直接调 http-server，无独立脚本文件） |
| 主应用 ofa.js 配置 | [apps/main/app-config.js](apps/main/app-config.js) |
| 接收应用 ofa.js 配置 | [apps/run-app/app-config.js](apps/run-app/app-config.js) |
| 主 SW | [sw.js](sw.js) |
| 连接状态应用（服务器/用户网格 + 详情页 + 流量监控） | [apps/network/](apps/network/)（含 [traffic.html](apps/network/traffic.html)） |
| 二维码组件（分享弹窗用） | [comps/ercode/ercode.html](comps/ercode/ercode.html) |
| 浮窗式网络面板（主应用挂载） | [comps/rdn-network/rdn-network.html](comps/rdn-network/rdn-network.html) |
| 系统级公共组件说明 | [comps/CONTEXT.md](comps/CONTEXT.md) |
| AI Provider 抽象层（独立子项目） | [ai/](ai/)（[README.md](ai/README.md) 有完整 API 文档） |
