# Mazmot 项目 Context

> 项目全局视图，帮助 AI 快速掌握当前架构、技术栈和关键设计。阅读后再针对具体任务查看相关文件即可。

## 项目定位

**Mazmot** 是一个基于浏览器的 **AI 应用启动器 / 迷你操作系统**（README 描述："让你快速的启动 AI 应用。无需配置，无需安装，无需学习"）。用户通过它管理并运行多个独立的 Web 应用。

## 核心技术栈

| 层级 | 技术 | 用途 |
| ---- | ---- | ---- |
| 底层 | noneos-core | 虚拟文件系统、用户管理、Service Worker、挂载本地目录 |
| 应用框架 | ofa.js | 组件/页面模块、路由、状态管理，无需 Node/Webpack |
| UI | Senti-UI | Material Design 3 组件（`st-list`、`st-dialog`、`st-button` 等），颜色走 `--md-sys-color-*` M3 角色变量（`apps/main` 已从 Punch-UI 迁移） |
| 存储 | `/nos/storage/main.js` | NoneOS Core 官方异步键值存储（IndexedDB），主系统用 `getStorage("mazmot")` 空间 |
| 图标 | `n-icon` (`/nos/n-icon/n-icon.html`) | 业务代码统一用 `<n-icon icon="mdi:xxx">`；底层会加载 `iconify-icon`，请勿直接调用其 API |
| 多语言 | `locale-text` (`/nos/locale-text/`) | `apps/main`、`apps/network`、`apps/run-app`、`official-apps/speed-dial`、`official-apps/ai-manager` 支持中/英双语：模板正文用 `<locale-text><span lang="cn">…</span><span lang="en">…</span></locale-text>`，JS 文案与 `title`/`placeholder` 等属性用 `getLocaleText`（经页面内 `t(key)` + `L10N` 表，o-fill 内 `$host.t`）；语言跟随 `navigator.language` 自动判定。入口 `<title>` 用脚本按语言设置。`apps/main/home.html` 头部齿轮按钮打开设置弹窗（左侧「常规」导航 + 右侧语言 `st-select`），切换后 `setLang` + 重载。例外：`apps/run-app/lib/*` 的错误文案保留中文（Core 就绪前执行，不能引 `/nos/*`）；speed-dial 的「未分组」为持久化数据值，不做多语言 |

**约束**：所有代码必须符合 ofa.js 语法（`<o-if>`、`<o-fill>`、`on:click`、`proto`/`data`、`sync:`、`:style.` 等），禁止 Vue/React 语法。详见 [AGENTS.md](AGENTS.md)。

## 目录结构

```
Mazmot/
├── index.html                # 根入口：初始化/升级 NoneOS Core，完成后跳转 /apps/main/ 或 ?redirect=
├── sw.js                     # NoneOS Core Service Worker（在根入口注册，scope=/；importScripts 前设置 HOST_CACHE_CONFIG=true 开启宿主缓存）
├── host-cache.json           # 宿主项目缓存清单（name/version/files），Core 安装或升级后自动下载 files 写入 OPFS 实现离线访问
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
│   │   │   ├── settings-user.html   # 设置弹窗「用户信息」子页面（查看 default 用户 ID / 用户名，弹窗内 <o-page> 加载）
│   │   │   ├── settings-certs.html  # 设置弹窗「凭证管理」子页面（遍历 default 用户 cred 凭证库，展示个人资料与全部证书）
│   │   │   ├── market.html           # 应用市场页面模块（弹窗内加载，展示官方应用及其版本号并安装到虚拟目录）
│   │   │   ├── template-writer.js    # 模板加载与写入（从 templates/<id>/ 读取源文件，按 __template.json 的 replacements 清单替换后写入 client/）
│   │   │   ├── official-app-writer.js # 官方应用加载与安装（从根目录 /official-apps/<id>/ 读取 __app.json 元数据（name/desc 基准英文 + i18n 按语言覆盖）+ app.json 版本号，写入虚拟目录 client/）
│   │   │   ├── templates/            # 应用模板资源目录
│   │   │   │   ├── manifest.json     # 模板清单（只登记模板 id，name/desc 从各模板目录的 __template.json 读取）
│   │   │   │   └── <id>/             # 每个模板一个子目录，含 __template.json（元数据 name/desc（基准英文 + i18n 按语言覆盖）+ 文件清单）+ AGENTS.md / CONTEXT.md（供 AI 参考的模板级开发规范与结构说明，随模板一起写入新建应用的 client/）+ .html/.json/.js 源文件；当前有 base（Hello World）、share-link（带参数分享链接）、ping-pong（应用间定时 ping/pong 通信）、tic-tac-toe（应用间井字棋联机对战）
│   │   │   └── app-status.js         # 应用打开状态追踪（BroadcastChannel + LS + window 引用）
│   │   └── lib/              # 主应用专属工具库
│   │       ├── official-app-state.js  # 官方应用 stanz 状态（仅主应用使用）
│   │       └── test/                 # sibyl-test 单元测试（_install-nos.sb.html）
│   │
│   ├── run-app/              # 分享接收应用，URL = /apps/run-app/?u=...&h=...
│   │   ├── index.html        # ofa.js 外壳：<o-router> + <o-app src="./app-config.js">（不校验模块，Core 由页面模块自己装）
│   │   ├── app-config.js     # 声明 home = ./run-app.html（不 init 文件系统，Core 未装时不可用）
│   │   ├── run-app.html      # 页面模块（壳）：内嵌 <nos-version auto-install> 装 Core → 加载 lib/*.js → 编排验签 / 确认 / 安装 / 跳转
│   │   └── lib/              # run-app 的模块化拆分（run-app.html 只做 UI / 状态编排）
│   │       ├── run-app-utils.js      # 纯工具函数（formatStatus / buildErrorDetail / mapAppProgress 等，便于单测）
│   │       ├── install-flow.js       # 安装流程（fetchSharePayload / findInstalled / installAppPackage）
│   │       ├── connection.js         # 连接层（ensureServerConnected / waitForRtcReady / requestChunkWithRetry / readHandshakeStatus）
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
├── mz/                       # Mazmot 平台 API（与 /nos/ 对称的宿主命名空间）
│   ├── app-runner.js         # 应用运行辅助：mount() 本地目录 / 生成运行 URL
│   ├── share-mgr.js          # 分享工具：DataPublisher 单例 / 签名 payload / Base64URL / verifyData
│   ├── test/                 # sibyl-test 单元测试（app-runner.sb.html / share-mgr.sb.html）
│   ├── ai/                   # AI Provider 抽象层（DeepSeek/Kimi，被官方应用当宿主 API 引用，URL = /mz/ai/*）
│   │   ├── main.js           # 入口：saveKey / getAssistant / apiKeys（基于 /nos/storage）
│   │   ├── supplier/         # provider 实现（assistant.js 基类 / deepseek.js / kimi.js）
│   │   ├── chain/            # Agent 循环层（模型 ↔ 工具自动循环，纯函数库）
│   │   ├── test/             # supplier / chain 层 sibyl-test 测试
│   │   └── README.md         # 完整 API 文档
│   ├── cert/                 # 系统级证书能力（封装 noneos-core user.cred，URL = /mz/cert/*）
│   │   ├── main.js           # 入口：issueCert / claimCert / revokeCert / lookupProfile / verifyProfileCard + 签发历史（appendIssueHistory / listIssued / listIssuedBy / mergeIssuedView 纯函数，存 getStorage("mz-cert") issue-history 键，含旧 cred-manager 空间一次性迁移；core 无软删除，历史有而凭证库无 = 已吊销）+ re-export 纯函数（ensureUser / verifyData / storage 按需动态加载，顶层不 import /nos/*）
│   │   ├── ref.js            # 凭证引用语法 [<type>:<payload>]（注册制类型表，本期 chain_key = role-issuer-subject 槽位引用，抗更新）
│   │   ├── chain.js          # 链遍历纯函数 buildChain（环检测 + 深度上限 32，节点状态 ok/expired/missing）+ collectChainFields（单张证书字段分组：普通字段 + 每个链字段展开好的节点列表，缺失引用为单 missing 根）
│   │   ├── fingerprint.js    # certFingerprint = sha256_hex(signature)（版本指纹，跨设备一致，区别于存储主键）
│   │   ├── pairing.js        # 配对码客户端封装（对接 cred-hub /pairing：requestPairingCode 提交签名 profile 卡片换短码（服务端自适应 6/8 位）并返回服务器时间 expiresAt；resolvePairingCard 凭码取回完整卡片——**未验签原始数据，调用方必须照常 verifyProfileCard**；PAIRING_CODE_PATTERN 判定 6-10 位短码输入；服务端地址默认 http://localhost:8787，可经 getStorage("mz-cert") 的 pairing-server 键覆盖）
│   │   └── test/             # ref / chain（含 collectChainFields）/ history（mergeIssuedView）的 sibyl-test 测试
│   ├── org/                  # 系统级组织账户机制（URL = /mz/org/*）
│   │   ├── main.js           # 组织 = 独立 NoneOS 用户（命名空间 org:<name>，**离线身份，从不连服务器**）：createOrg（org 给创建者签 role="owner" 永久证书，extras 带 type:"org"+org:<name> 标记并 cred.import 进创建者凭证库；profile 自定义字段带 type:"org" 标记，isOrgProfile 判别）/ listOrgs / getOrg / updateOrgInfo / issueStaffCert（默认 role="staff"，证书同样带 type/org 标记，签发后自动 cred.import 托管进创建者 default 凭证库，员工用 claimCert(创建者ID, role, {issuerId: 组织ID}) 领取，计入带 issuer 的签发历史）/ listOrgIssued（经 /mz/cert 的 listIssuedBy 查 org 用户凭证库）/ revokeOrgCert / deleteOrg（deleteUser 不可逆）；组织清单存 getStorage("mz-orgs")，业务应用凭「证书 issuer === org userId」做员工权限判断
│   │   └── test/             # validateOrgName 等纯函数测试
│   ├── cloud-drive/          # 云盘套件共享层（URL = /mz/cloud-drive/*，被 official-apps/cloud-drive-client 与 cloud-drive-server 共用）
│   │   ├── protocol.js       # 协议常量与纯工具（APP_SERVICE_ID="cloud-drive-v1" / USER_NAMESPACE="cloud-drive" / CHUNK_SIZE=48KB / RESUME_MIN_SIZE=256KB / MSG 消息类型表 / base64 互转 / formatBytes / newId / sha256Hex / fileIcon）
│   │   ├── reliable.js       # ReliableChannel 可靠投递通道（纯模块可注入 transport 便于模拟丢包）：信封 {msgId, kind:"data"|"ack", payload}，ACK 确认 + 超时重发（复用同一 msgId）+ 接收端去重（TTL 5min + 容量上限）+ 同目标串行队列；ACK 先于去重回；payload 超 112KB 立即 reject
│   │   ├── server-core.js    # CloudDriveServer（构造传 LocalUser + onEvent）：start/stop（registerService cloud-drive-v1）；空间/账号管理 listSpaces / createSpace（虚拟）/ createLocalSpace（挂载本地文件夹：kind:"local"，挂载句柄存 mount:<spaceId>，fileId 为相对路径直读写真实目录，暂不支持重命名）/ deleteSpace / listAccounts（含 passPlain 明文，供管理员 UI 查看；早期账号可能缺失）/ createAccount / updateAccount / deleteAccount / getStats；指令处理（每远端串行）login（SHA-256 密码 + 空间授权校验，token 会话）/ logout（注销会话 + 记审计）/ list / mkdir / rename / remove（递归）/ up-init（按 clientUploadId 幂等续传）/ up-chunk / up-complete（合并入 fs）/ up-cancel / down-init / down-chunk；审计日志 listAudit / clearAudit（storage 键 audit，最新在前上限 500 条：login / refresh-login（客户端刷新后凭 token 恢复，经 MSG.RESUME）/ login-fail / logout，含 username / remoteUserId / token）；远端通道 ReliableChannel 按 remoteUserId 缓存
│   │   ├── client-core.js    # CloudDriveClient（getSharedClient 单例跨页面共享连接与登录态）：connect（connectUser + 注册应答服务 + ping 握手）/ fetchSpaces / login / list / mkdir / rename / remove；uploadFile / downloadFile（48KB 分块走可靠通道，≥256KB 先落本地 fs transfers/ 并写续传记录）；listTransfers / resumeTransfer / cancelTransfer（断点续传：刷新后 UI 询问继续或取消）
│   │   └── test/reliable.sb.html  # reliable.js 单元测试（有损线路模拟：丢包全送达 / 去重 / 保序 / 黑洞 reject / 超限 reject）
│   └── comps/                # 系统级公共组件（URL = /mz/comps/*），详见 mz/comps/CONTEXT.md
│       ├── ercode/           # <m-ercode> 二维码组件（被主应用分享弹窗使用）
│       ├── o-md/             # <o-md> Markdown 渲染组件
│       ├── rdn-network/      # <rdn-network> 浮窗式网络面板（被 apps/main/index.html 挂载）
│       └── rnd-box/          # <m-rnd-box> 可拖拽缩放浮动盒子容器
│
├── official-apps/            # 官方应用资源目录（应用市场），apps/main 通过 fetch("/official-apps/...") 加载
│   ├── manifest.json         # 官方应用清单（只登记 app id）
│   ├── ai-manager/           # AI API Key 管理器（基于 mz/ai/main.js）
│   ├── smart-assistant/      # 智能联络助手（host 填写需求文档生成分享链接，customer 经 P2P 与 host 的 AI 实时对话）
│   ├── cred-manager/         # 凭证管理器（comps/cert-item.html 证书条目组件；home.html 左侧导航 layout：查询用户 / 我的信息 / 已知用户 / 互授 / 组织管理 / 本地证书；query-user.html 查询对方已验证用户卡片并签发证书（角色 + 到期时间 + 自定义字段，可插入链式引用）；claim.html 领取证书页面模块（经 my-certs 右上角按钮在 dialog 内以 o-page 内嵌，不再占导航）；my-certs.html 本地证书（tab：全部/我签发的/签发给我的）；cert-detail.html 证书详情（支持 ?ns=org:<name> 用组织命名空间解析）；known-users.html 已知用户卡片；live-share.html 互授页（配对码连接后自动拉取与自己相关的证书：服务消息只传匹配通知与元数据清单，证书本体走 core 按精确 key 拉取，经 lib/live-share.js 封装 registerService/sendToService 可靠层，详见其应用内 CONTEXT.md）；orgs.html 组织列表（创建组织 / 组织清单，点击条目进入 org-detail.html）；org-detail.html 组织详情管理页（?org=<name>：组织 ID / 改展示名 / 点选已知用户签发员工证书 / 组织已签发列表 / 删除组织，经 /mz/org/main.js）；my-info.html 用户名/userId + 获取配对码（无本地 profile 时失败引导；倒计时基于服务器 expiresAt，过期提示刷新，detached 清理定时器）。查询用户页输入框兼容配对码：命中 PAIRING_CODE_PATTERN 走 resolvePairingCard 解析回卡片后照常本地验签展示。证书 / 链 / 签发历史能力经 /mz/cert/main.js）

│   ├── speed-dial/           # 网页收藏夹（Speed Dial 风格网址快捷入口，分组/搜索/拖拽排序，数据存 getStorage("speed-dial") 的 dials 键，纯单机）
│   ├── cloud-drive/          # P2P 云盘（旧版：服务端管理存储/凭证/分享链接，客户端经 P2P 上传下载管理文件，文件分块 SHA-256 校验 + 二进制 send 传输）
│   ├── cloud-drive-server/   # 云盘服务器（新版，base 模板骨架 + /mz/cloud-drive/server-core.js）：pages/home.html 单页管理「空间管理 / 用户管理」双 tab；服务端文件树存 getStorage("cloud-drive-server")（spaces / accounts / tree:<spaceId> / upload:<id>），文件内容存 fs init("cloud-drive-server") 的 spaces/<spaceId>/<fileId> 与 tmp/<uploadId>/<index>；客户端经 NoneOS 服务消息（cloud-drive-v1）+ ReliableChannel 可靠层访问
│   └── cloud-drive-client/   # 云盘客户端（新版，百度网盘式体验）：home.html 三步登录（连接服务器 userId → 选空间 → 账号密码）+ 未完成传输「继续 / 取消」询问；files.html 文件页（面包屑 / 新建文件夹 / 上传 / 搜索 / 重命名 / 删除 / 下载，底部传输进度条）；核心逻辑在 /mz/cloud-drive/client-core.js（getSharedClient 单例），登录态 / 续传记录存 getStorage("cloud-drive-client") 的 last-server 与 transfers 键
│
│
├── .github/workflows/        # CI：test.yml 跑 sibyl-test 多浏览器矩阵（Chrome/Firefox/WebKit）
│
├── server/                   # 独立后端服务（不随前端静态部署；详见 AGENTS.md「server/」章节）
│   ├── cred-hub/             # cred 凭证数据存储服务器（Rust + axum，详见其 README.md）：POST /creds（校验结构/有效期/ECDSA P-256 签名后存储）+ GET /creds/{key} + GET /health；暂无认证；redb 单文件 KV 持久化；npm run cred-hub 启动；e2e 测试在 e2e/（Playwright + Chrome，Node WebCrypto 本地自造签名数据），CI 见 .github/workflows/cred-hub-e2e.yml
│   ├── cred-hub-cf/          # 同功能的 Cloudflare Workers + D1 版本（接口/校验/配对码语义与 Rust 版完全一致、同密钥下配对码互通；单文件 src/worker.js，冒烟测试 smoke.mjs 复用 Rust 版 e2e 签名工具，详见其 CONTEXT.md / README.md）
│   └── cred-client/          # cred-hub 浏览器端管理器（纯静态零依赖单页：连接 cred-hub 后查看管理 API 的 stats / hot / expiring 只读数据，Rust 版与 CF 版通用；连接信息存 localStorage，详见其 CONTEXT.md / README.md）
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
   │         ├─ 命中且用户点「直接导入」→ importExistingLocalApp：直接 push 到 apps 列表并关闭弹窗（不写模板）
   │         ├─ 命中且用户点「取消」→ 用 manifest.name / description 预填 step2 表单继续
   │         └─ 未命中 → 进入 step2 让用户填名称
   └─ 虚拟目录：确认名称后 (await init("mazmot-apps")).get(name, {create:"dir"}) 建立子目录
   ↓
存入 `getStorage("mazmot")` 的 `apps` 键（本地：存原生 handle；虚拟：namespace=mazmot-apps，handle=null）
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

### 3. 更新官方应用（[apps/main/home.html](apps/main/home.html)）

```
attached / refreshApps → _checkOfficialUpdates
   ↓
遍历 source === "official" 的记录，loadOfficialAppMeta(officialId) 取市场版本
   ↓
compareVersions(市场版本, 本地 client/app.json 的 version) > 0 → hasUpdate = true（列表显示「可更新」徽标 + 更新按钮）
   ↓
handleUpdate → confirm → installOfficialApp({ dirHandle: app._handle, appId: officialId })
   ↓
覆盖写入 client/ 下的源文件（应用自身 IndexedDB 数据不受影响）→ refreshApps
```

> **官方应用运行时自识别（含在线直开调试）**：为方便官方仓库开发者调试分享功能，官方应用可以不安装、直接在线打开（`/official-apps/<id>/...`）来验证分享链接等能力。应用在运行时从 `location.pathname` 识别自身身份，需同时匹配两种模式——本地安装 `/$mazmot-apps/<dirName>/client/index.html` 与在线直开 `/official-apps/<id>/...`。参考 `official-apps/smart-assistant/pages/host.html` 的 `parseSelfIdentity`。生成分享链接统一走 `buildOfficialRunUrl`（HTTP 渠道，不依赖发布者在线），两种模式下产出的链接一致；只识别本地安装路径会导致在线调试时分享链接生成失败。

### 4. 删除应用

```
（已发布 autoShareUrl）→ unpublishApp 撤销发布，让旧分享链接失效
clearOpened → 关闭窗口
（虚拟目录）app._handle.remove() → 移除虚拟子目录
从 `getStorage("mazmot")` 的 `apps` 列表移除记录
```

## 数据模型

### `apps` 数组结构

#### 持久化字段（写入 `getStorage("mazmot")` 的 `apps` 键）

```javascript
{
  name: "my-app",           // 唯一 recordName（字母/数字/_-，不含空格）；运行时常被映射到 _recordName
  desc: "描述",
  handle: FileSystemDirectoryHandle | null, // 本地目录存原生句柄；虚拟目录/官方应用为 null
  dirName: "选择的目录名 / 虚拟命名空间",   // 虚拟目录形如 "mazmot-apps/<name>"
  source: "local" | "virtual" | "official",
  namespace: "mazmot-apps",  // virtual / official 有值，(await init(namespace)).get(name) 即可重建 handle
  appId: "my-app-abc123def456...",  // 稳定 ID = `${应用名}-${LocalUser.userId}`，跨设备识别同一应用
  officialId: "ai-manager", // 仅 official 有值：官方应用 ID，用于市场去重判断
  autoShare: false,          // 是否开启自动分享（开关切换时由 _persistAppField 写回）
  fileHash: "",              // 仅经 run-app 安装的应用有值：应用包内容 SHA-256（= payload.fileHash）
  payloadHash: "",           // 分享清单内容哈希（= URL 的 h），用于"无改动秒跳"。经 run-app 安装、或本机开启自动分享成功后写入
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
  source: "local" | "virtual" | "official",
  namespace: "...",
  appId: "...",
  officialId: "ai-manager",  // 仅 official 有值，检查更新时用它去 /official-apps/<id>/ 拉最新版本
  latestVersion: "",          // 市场最新版本（_checkOfficialUpdates 写入，仅官方应用）
  hasUpdate: boolean,         // latestVersion > version 时为 true，列表显示「可更新」徽标与更新按钮
  updating: boolean,          // 正在执行更新（期间禁用更新/删除按钮）
  updateStatus: "",           // 更新进度或错误文案，空字符串表示无需展示
  isMine: boolean,           // 非 official 应用且 appId 后缀 === 当前用户 userId，标识「自己开发的应用」
  opened: boolean,           // 窗口是否存活（BroadcastChannel + window 引用判定）
  autoShareValue: "on" | "off",   // 供 sync:value 双向绑定用
  autoShareUrl: "",          // 已发布的短链接；空字符串表示尚未就绪
  autoShareState: "idle" | "pending" | "publishing" | "ready" | "error",
  autoShareStatus: "已关闭 / 等待发布 / 发布中... / 已发布，对方可直接连接 / 错误描述",
}
```

> 注意：`app-runner.js` 的 `getRunUrl(app)` 读取的是**运行时对象**：`source` + `namespace` + `virtualDirName || name` + `_handle`。`share-mgr.js` 的 `publishApp(app)` 读取的是 `_handle` + `_recordName` + `name` + `version` + `desc` + `icon` + `appId`。

### 应用数据模型约束（强约定）

以下约束散落在 [add-app.html](apps/main/home/add-app.html) / [home.html](apps/main/home.html) / [app-runner.js](mz/app-runner.js) / [share-mgr.js](mz/share-mgr.js)，新增 / 修改相关代码时必须保持一致：

- **应用目录布局**：每个应用在目标位置（本地目录或 `$mazmot-apps/{recordName}/`）下必须有 `client/` 子目录；`client/` 内必须至少含 `app.json` 与 `index.html`。读取应用文件时优先取 `client/`，缺失时回退到根目录（仅用于兼容老数据，新代码不要再产生这种布局）。
- **应用名规则**：`name`（= `_recordName`）只能含字母、数字、下划线、连字符（`/^[A-Za-z0-9_-]+$/`），不能含空格；由 [add-app.html](apps/main/home/add-app.html) 的 `validateName` 与 `importExistingLocalApp` 双重校验。
- **`appId` 生成规则**：固定为 `` `${name}-${LocalUser.userId}` ``，由 [share-mgr.js](mz/share-mgr.js) 的 `generateAppId` 产生。`userId` = 公钥的 SHA-256 十六进制，跨设备稳定。`appId.endsWith("-" + currentUserId)` 用来判定"自己开发的应用"（`isMine`）。**仅自建应用可拥有 `appId`**：官方应用（`source === "official"`，含 `?app=` 链接与市场安装）不写 `appId`，以 `officialId` 标识来源，`isMine` 判定会显式排除 official 应用。
- **虚拟目录路径推导**：`virtualDirName = dirName.replace(/^mazmot-apps\//, "")`（若 `dirName` 不带前缀则直接用 `dirName`，再兜底到 `name`）；`getRunUrl` 优先用 `virtualDirName`，老数据回退到 `app.name`。
- **持久化字段最小集合**：`name / desc / handle / dirName / source / namespace / appId / autoShare / createdAt`（自建应用；官方应用以 `officialId` 替代 `appId`，经 run-app 安装的应用额外带 `fileHash / payloadHash`）。新增字段必须同步更新 [share-mgr.js](mz/share-mgr.js) 的 payload `meta` 与"数据模型"小节。
- **`app.json` 元数据**：至少包含 `name` / `displayName` / `version` / `icon` / `description`（官方应用的 `displayName`/`description` 基准值须为英文，可用 `i18n` 字段按语言覆盖，如 `"i18n": { "cn": { "displayName": "...", "description": "..." } }`）；`home.html` 的 `loadApps` 读它覆盖持久化的 `name` / `desc` 用于显示（有 `i18n[当前语言]` 覆盖时优先）。

### 应用模板文件（[template-writer.js](apps/main/home/template-writer.js)）

生成 4 个文件，存放在目标目录的 `client/` 子目录下（给用户新建的子应用用的模板）：

- `app.json` — 应用元数据（name / displayName / version / icon / entry / permissions / capabilities）
- `index.html` — 入口 HTML，加载 ofa.js + router + 自带 M3 深浅色配色 + `./app-config.js`
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
- `http://localhost:30031/mz/test/app-runner.sb.html` — 测试 [app-runner.js](mz/app-runner.js) 的 URL 生成与文件读取
- `http://localhost:30031/mz/test/share-mgr.sb.html` — 测试 [share-mgr.js](mz/share-mgr.js) 的 Base64URL、分享链接与打包结构

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

1. 分享入口只剩一个：在应用列表折叠子项开启「自动分享」开关 → `handleAutoShareToggle` → `autoShareApp` → [share-mgr.js](mz/share-mgr.js) 的 `publishApp(app, { appId, onProgress })`，返回 `{ shareUrl, appId, payloadHash }`。操作行不再有独立的「分享应用」按钮。
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
3.5. **前置秒跳（`tryFastJump`，在 Core 检测之前）**：`startFlow` 第一步先跑 `tryFastJump`——内联解析 URL 的 `h`（不加载 `share-mgr.js`，因其顶层 import `/nos/*` 会牵连 Core 依赖），只加载 `https://core.noneos.com/nos/storage/main.js`（直连、不需要 Core SW）读 `getStorage("mazmot")` 的 `apps` 键，`findByPayloadHash` 命中后调 `resolveRunUrl(hit)` 解析运行 URL → `location.replace` 同标签跳转。`resolveRunUrl` 按 source 分流：**virtual** 用 `appDirExists` 校验目录仍在后拼 `/$namespace/{dirName}/client/index.html`；**local**（含开发者自分享的应用）重建 `DirHandle` 后走 `app-runner.js` 的 `getRunUrl`（mount client 子目录）。这样"已装过该应用"的老用户、以及**打开自己分享链接的开发者**都绕过了 nos-version 的版本检测（含网络请求，主要延迟来源）。未命中（含全新用户，`apps` 为空立即返回、不碰 `/nos/*`）、目录失效或任何异常都静默退回下方正常流程，绝不阻断。自我分享能命中的前提：`home.html` 的 `autoShareApp` 在 `publishApp` 成功后把 `payloadHash` 持久化到发布者自己的 app 记录。
4. Core 就绪后使用 `load = lm(import.meta)` 并行加载 `/nos/fs`、`storage`（步骤 3.5 已加载则直接复用）、`share-mgr.js`、`/nos/user`、`/nos/publish`、`/nos/crypto`。`parseShareUrl` 得到 `{ userId, payloadHash }`。（无改动秒跳已在步骤 3.5 前置处理；此处进入正常联网安装流程。）**`ensurePublisher` 后先调用 `ensureServerConnected` 并发连上所有配置的信令服务器（`getServers()` → 并发 `connect()`，2s 上限：全部完成或超时先到者返回，至少一台连上即继续），一是防止 `connectedUrls` 为空导致 `connectUser` 立即抛错，二是让 core 在多台已连服务器间按 RTT 择优（只连一台则无从选最快）；单台失败记进 `errors`，全失败才报"无法连接任何信令服务器"**；`connectUser(userId)` 后调用 `install-flow.js` 的 `fetchSharePayload`（内部：`requestManifest` → `isPublicKeyOfUser` 核对签发者 → `connection.js` 的 `requestChunkWithRetry` × N → `assembleFile`）得到 payload JSON。`connectUser` + `ping` 后刷新握手状态显示：`readHandshakeStatus(user, remoteUser)` 优先用 `remoteUser.getRTT()` 的实际路径——经中继时显示 core 择优后真正使用的最快服务器 `url` + `rtt`（而非配置列表第一台），RTC 直连或尚无 remoteUser 时退回已连接的第一台 `connectedUrls[0]`。
5. `findInstalled(payload)`：
   - 未安装 or 已安装但内容哈希不同 → 走 `installOrUpdate` 流程（复用步骤 4 已建立的 `remoteUser` → `requestManifest(payload.fileHash)` → `requestChunk` × N → `assembleFile` → 写入 `$mazmot-apps/{recordName}/client/`；`recordName` = `payload.appId`，覆盖时沿用旧目录）。安装时把 `payload.fileHash` 与 URL 的 `payloadHash` 一并写进 app 记录，供下次秒跳比对。
   - 已安装且内容哈希一致（`shouldSkipInstall` 比对本地记录 `fileHash` 与 `payload.fileHash`，**不用版本号**——开发者更新内容却不改版本时版本号相同但 `fileHash` 已变，必须重装），或来自本人分享 → 跳过下载直接跳转。
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
| 设置弹窗用户信息（default 用户查看 / 改用户名） | [apps/main/home/settings-user.html](apps/main/home/settings-user.html) |
| 设置弹窗凭证管理（default 用户全部凭证） | [apps/main/home/settings-certs.html](apps/main/home/settings-certs.html) |
| 应用运行 URL 生成 / 文件读取 | [mz/app-runner.js](mz/app-runner.js) |
| 应用模板内容 | [apps/main/home/template-writer.js](apps/main/home/template-writer.js) + [apps/main/home/templates/](apps/main/home/templates/) |
| 应用打开状态 | [apps/main/home/app-status.js](apps/main/home/app-status.js) |
| 分享工具（发布/验签） | [mz/share-mgr.js](mz/share-mgr.js) |
| 系统级证书能力（签发/领取/吊销/卡片验签 + 链式引用与链遍历） | [mz/cert/main.js](mz/cert/main.js)（[ref.js](mz/cert/ref.js) 引用语法 / [chain.js](mz/cert/chain.js) 链遍历 / [fingerprint.js](mz/cert/fingerprint.js) 版本指纹 / [pairing.js](mz/cert/pairing.js) 配对码） |
| 系统级组织账户机制（创建组织 / owner 证书 / 员工证书签发与管理） | [mz/org/main.js](mz/org/main.js) |
| 云盘套件可靠传输通道（ACK + 重发 + 去重 + 串行队列，可注入传输层模拟丢包） | [mz/cloud-drive/reliable.js](mz/cloud-drive/reliable.js)（测试 [mz/cloud-drive/test/reliable.sb.html](mz/cloud-drive/test/reliable.sb.html)） |
| 云盘服务器 / 客户端核心（空间与账号体系、分块上传下载、断点续传） | [mz/cloud-drive/server-core.js](mz/cloud-drive/server-core.js) / [mz/cloud-drive/client-core.js](mz/cloud-drive/client-core.js) / [mz/cloud-drive/protocol.js](mz/cloud-drive/protocol.js) |
| 分享接收页（壳 + 编排） | [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 分享接收页业务逻辑 | [apps/run-app/lib/](apps/run-app/lib/)（install-flow / connection / diag / run-app-utils） |
| 分享一键跳转入口 | [apps/run-app/index.html](apps/run-app/index.html) + [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 静态服务器 / npm 脚本 | [package.json](package.json)（`npm run static` 直接调 http-server，无独立脚本文件） |
| 主应用 ofa.js 配置 | [apps/main/app-config.js](apps/main/app-config.js) |
| 接收应用 ofa.js 配置 | [apps/run-app/app-config.js](apps/run-app/app-config.js) |
| 主 SW | [sw.js](sw.js) |
| 宿主离线缓存文件清单 / 版本 | [host-cache.json](host-cache.json)（改动缓存文件后需同步提升 `version`） |
| 连接状态应用（服务器/用户网格 + 详情页 + 流量监控） | [apps/network/](apps/network/)（含 [traffic.html](apps/network/traffic.html)） |
| 二维码组件（分享弹窗用） | [mz/comps/ercode/ercode.html](mz/comps/ercode/ercode.html) |
| 浮窗式网络面板（主应用挂载） | [mz/comps/rdn-network/rdn-network.html](mz/comps/rdn-network/rdn-network.html) |
| 系统级公共组件说明 | [mz/comps/CONTEXT.md](mz/comps/CONTEXT.md) |
| AI Provider 抽象层 | [mz/ai/](mz/ai/)（[README.md](mz/ai/README.md) 有完整 API 文档） |
| AI API Key 管理官方应用 | [official-apps/ai-manager/pages/home.html](official-apps/ai-manager/pages/home.html) |
| 凭证管理官方应用（查询用户卡片 + 签发/领取/查看证书 + 已知用户 + 我的信息 + 互授） | [official-apps/cred-manager/pages/](official-apps/cred-manager/pages/)（[home.html](official-apps/cred-manager/pages/home.html) layout / [query-user.html](official-apps/cred-manager/pages/query-user.html) / [claim.html](official-apps/cred-manager/pages/claim.html) / [my-certs.html](official-apps/cred-manager/pages/my-certs.html) / [cert-detail.html](official-apps/cred-manager/pages/cert-detail.html) / [known-users.html](official-apps/cred-manager/pages/known-users.html) / [live-share.html](official-apps/cred-manager/pages/live-share.html) + [lib/live-share.js](official-apps/cred-manager/lib/live-share.js) / [my-info.html](official-apps/cred-manager/pages/my-info.html)） |
| 网页收藏夹官方应用（单机 Speed Dial） | [official-apps/speed-dial/pages/home.html](official-apps/speed-dial/pages/home.html) |
| P2P 云盘官方应用（服务端/客户端/角色选择） | [official-apps/cloud-drive/pages/](official-apps/cloud-drive/pages/)（[server.html](official-apps/cloud-drive/pages/server.html) / [client.html](official-apps/cloud-drive/pages/client.html) / [home.html](official-apps/cloud-drive/pages/home.html)） |
