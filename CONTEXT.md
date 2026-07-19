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
| 图标 | `n-icon` (`/nos/n-icon/n-icon.html`) | 统一使用 `<n-icon icon="mdi:xxx">`，禁止 `iconify-icon` |

**约束**：所有代码必须符合 ofa.js 语法（`<o-if>`、`<o-fill>`、`on:click`、`proto`/`data`、`sync:`、`:style.` 等），禁止 Vue/React 语法。详见 [AGENTS.md](AGENTS.md)。

## 目录结构

```
Mazmot/
├── index.html                # 根入口：初始化/升级 NoneOS Core，完成后跳转 /apps/main/ 或 ?redirect=
├── sw.js                     # NoneOS Core Service Worker（在根入口注册，scope=/）
├── AGENTS.md                 # AI 开发规范（必读）
├── CONTEXT.md                # 项目架构上下文（本文档）
├── package.json              # 只提供 static 脚本：node scripts/static.js
│
├── apps/                     # 应用（monorepo 风格）
│   ├── main/                 # 主应用：应用列表 / 添加 / 分享入口，URL = /apps/main/
│   │   ├── index.html        # 应用入口 HTML：先校验 Core 模块，缺失则回根入口升级；再装载 ./app-config.js
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
│   │       └── test/                 # sibyl-test 单元测试（app-runner.sb.html / share-mgr.sb.html）
│   │
│   ├── run-app/              # 分享接收应用，URL = /apps/run-app/?p=...
│   │   ├── index.html        # ofa.js 外壳：<o-router> + <o-app src="./app-config.js">
│   │   ├── app-config.js     # 声明 home = ./run-app.html（不 init 文件系统，Core 未装时不可用）
│   │   └── run-app.html      # 页面模块：内嵌 <nos-version auto-install> 装 Core → 验签 → 已装弹确认 → 安装 → location.replace
│   │
│   └── network/              # 网络应用（服务器/用户连接状态与后续网络配置），URL = /apps/network/
│       ├── index.html        # 应用入口 HTML：校验 /nos/fs、/nos/user 模块
│       ├── app-config.js     # ofa.js 配置（home = ./home.html，init "mazmot"）
│       ├── home.html         # 首页：上部服务器网格 + 下部已连接 RemoteUser 网格，点击跳转详情
│       ├── server-detail.html # 服务器详情：连接状态 / 版本 / 延迟 / 连接·断开·测试延迟
│       └── user-detail.html  # 用户详情：在线状态 / SessionIds / RTT / Ping / 断开
│
├── scripts/
│   ├── static.js             # 启动 http-server：Main(30031)
│   └── ...                   # generate-capabilities / update-skill / update-files-json
│
├── comps/                    # 系统级公共组件（rdn-network / rnd-box）
│   └── CONTEXT.md            # 组件上下文说明
│
├── ai/                       # AI 相关：deepseek、kimi、assistant
└── old/                      # v1/v2/v3 历史版本（不参与新逻辑）
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

```javascript
{
  name: "my-app",           // 唯一名称（字母/数字/_-，不含空格）
  desc: "描述",
  handle: FileSystemDirectoryHandle | null, // 本地目录存原生句柄；虚拟目录为 null
  dirName: "选择的目录名 / 虚拟命名空间",
  source: "local" | "virtual",
  namespace: "mazmot-apps",  // 仅 virtual 有值，(await init(namespace)).get(name) 即可重建 handle
  appId: "my-app-abc123def456...",  // 稳定 ID = `${应用名}-${LocalUser.userId}`，跨设备识别同一应用
  createdAt: timestamp
}
```

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
2. 进入 `apps/main/index.html` → 先动态导入 `/nos/fs/main.js` 校验 Core 模块；若缺失则回根入口升级，再装载 `./app-config.js`（`init("mazmot")` 初始化文件系统）
3. `apps/main/home.html` 加载显示应用列表（初始为空）

> 直接打开分享链接（`/apps/run-app/?p=...`）时，`run-app/index.html` 会先校验 `/nos/fs/main.js`、`/nos/user/main.js`、`/nos/publish/data-publisher.js`、`/nos/crypto/crypto-verify.js`；任一模块缺失都会先回根入口升级，再返回继续安装。

### 运行测试

使用 [sibyl-test](https://github.com/ofajs/sibyl-test) 编写浏览器端单元测试。测试页为普通 HTML，需先完成 NoneOS Core 安装后再打开：

- `http://localhost:30031/apps/main/lib/test/app-runner.sb.html` — 测试 [app-runner.js](apps/main/lib/app-runner.js) 的 URL 生成与文件读取
- `http://localhost:30031/apps/main/lib/test/share-mgr.sb.html` — 测试 [share-mgr.js](apps/main/lib/share-mgr.js) 的 Base64URL、分享链接与打包结构

### 添加并运行第一个应用

1. 点击"添加应用" → 选择本地目录（Chrome 才支持）或虚拟目录
2. 输入名称 → 写入 4 个模板文件到目标目录的 `client/` 子目录
3. 应用列表出现新项
4. 点击应用行或 `tab-plus` / `open-in-new` 按钮启动

## 应用分享（基于 DataPublisher）

用点对点方式把应用发给别人，无需 zip、无需后端。

### 分享（发布端）

1. 在应用列表折叠子项中点击"分享应用" → [apps/main/home.html](apps/main/home.html) 的 `handleShare`。
2. `readAppFiles(handle)` 读取 `client/` 下所有文件（`{ path, content }` 数组）。
3. `ensurePublisher()` 单例获取 `LocalUser("mazmot")` + `DataPublisher`；`user.ready()` 自动连接默认信令服务器。
4. `buildPackageFile(files, meta)` 将 `{ mazmotPackage, meta, files }` 打包成 UTF-8 JSON `File`。
5. `publisher.publish(file)` 分块签名 → 得到应用包的 `manifest.fileHash`。
6. 拼装扁平 `payloadData`（展示元数据 + `publisherUserId` + 应用包 `fileHash`），`buildSharePayloadFile(payloadData)` 打成 `File`，再 `publisher.publish(payloadFile)` 得到 `payloadManifest.fileHash`——core manifest 已自带 ECDSA 签名。
7. `buildRunUrl(origin, user.userId, payloadManifest.fileHash)` → `{origin}/apps/run-app/?u={userId}&h={payloadHash}`（两个字段，短链接）。
8. 弹窗展示只读自动跳转链接 + "复制链接" 按钮。提醒用户保持页面开启（P2P 依赖发布者在线）。

### 接收（`/apps/run-app/?u=...&h=...` → [run-app/index.html](apps/run-app/index.html) → [run-app.html](apps/run-app/run-app.html)）

用于「分享 → 一键进入」场景，全流程静默；若本地已装其他应用则弹窗确认，其余步骤自动完成：

1. `index.html` 只承担 ofa.js 外壳（`<o-router>` + `<o-app src="./app-config.js">`），`app-config.js` 声明 `home = "./run-app.html"`；由于 Core 可能尚未安装，`app-config.js` **不** `init("mazmot")`。
2. 页面模块内嵌隐藏的 `<nos-version auto-install>` 组件，通过模板 `on:check-start` / `on:uninstalled` / `on:upgradable` / `on:install-start` / `on:install-progress` / `on:installed` / `on:error="onCoreError($event)"` 声明式绑定到 `proto.onCoreXxx` 方法；`coreReady` Promise 由 `onCoreInstalled` / `onCoreError` 通过闭包变量兑现。Core 检测/安装占进度条前 40%。
3. 步骤计数：模块顶部有 `STEPS` 数组（共 9 步），进度条上方的 `statusText` 一律带 `n/N · 描述` 前缀，通过 `enterStep(index)` + `setProgress(percent, text)` 联动。
4. Core 就绪后使用 `load = lm(import.meta)` 并行加载 `/nos/fs`、`ever-cache`、`share-mgr.js`、`/nos/user`、`/nos/publish`、`/nos/crypto`。`parseShareUrl` 得到 `{ userId, payloadHash }`；`connectUser(userId)` 后 `publisher.requestManifest(remoteUser, payloadHash)` 拉分享清单，用 `isPublicKeyOfUser(pmf.publicKey, userId)` 核对签发者，再 `requestChunk` × N + `assembleFile` 得到 payload JSON。
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
| 分享接收页 | [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 分享一键跳转页 | [apps/run-app/index.html](apps/run-app/index.html) + [apps/run-app/run-app.html](apps/run-app/run-app.html) |
| 静态服务器配置 | [scripts/static.js](scripts/static.js) |
| 主应用 ofa.js 配置 | [apps/main/app-config.js](apps/main/app-config.js) |
| 接收应用 ofa.js 配置 | [apps/run-app/app-config.js](apps/run-app/app-config.js) |
| 主 SW | [sw.js](sw.js) |
| 连接状态应用（服务器/用户网格 + 详情页） | [apps/network/](apps/network/) |
| 系统级公共组件说明 | [comps/CONTEXT.md](comps/CONTEXT.md) |
