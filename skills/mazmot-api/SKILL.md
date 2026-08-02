---
name: "mazmot-api"
description: "Mazmot 自身提供的能力速查：app.json 应用结构、应用运行 / 分享 / 安装 / 状态追踪等 Mazmot 专属 API。当用户在 Mazmot 仓库内编写或修改应用相关代码时调用。"
---

# Mazmot 能力 API 速查

本技能**只讲 Mazmot 自身提供的能力**。底层能力请查对应技能：

- 文件系统（`/nos/fs/main.js`）、用户 / 联机（`/nos/user/main.js`）、P2P 发布（`/nos/publish/*`）、图标（`/nos/n-icon/*`）等 → 查 **noneos-core-docs** 技能。
- `<template page>` / `<template component>` / `o-app` / `o-router` / `proto` / `sync:` / `on:click` 等模板语法、路由、状态管理 → 查 **ofajs-docs** 技能。
- 持久化存储 → 查 **ever-cache** 技能。
- 测试框架本身 → 查 **sibyl-test** 技能。
- AI 助手封装（DeepSeek / Kimi 对话、思考模式、流式输出、API Key 管理、AbortSignal 取消）→ 查 [references/ai.md](./references/ai.md)。
- **应用间 P2P 通信**（生成带身份的分享链接 + 双端握手 + 消息收发 + 连接状态/RTC 升级）→ 查 [references/app-p2p-messaging.md](./references/app-p2p-messaging.md)。

## 1. 应用结构 —— `app.json`

Mazmot 里的每一个应用都遵循统一的目录结构：

```
<app-root>/
├── app.json          # 应用元数据（必需）
├── index.html        # 入口 HTML（必需，挂载 <o-app src="./app-config.js">）
├── app-config.js     # ofa.js app 配置（导出 home / 各路由页面）
├── pages/            # 页面模块（<template page>）
└── ...
```

运行时 Mazmot 要求应用文件放在 **`client/`** 子目录下（安装流程会自动创建）。`client/` 内必须至少包含 `app.json` + `index.html`。

### `app.json` 字段

```json
{
  "name": "my-app",
  "displayName": "My App",
  "version": "0.1.0",
  "description": "应用描述",
  "author": "",
  "icon": "📦",
  "entry": "./index.html",
  "appConfig": "./app-config.js",
  "permissions": [],
  "capabilities": [],
  "createdAt": 1704067200000,
  "mazmot": {
    "source": "self-created"
  }
}
```

| 字段 | 说明 |
| ---- | ---- |
| `name` | 应用唯一标识，需匹配 `/^[A-Za-z0-9_-]+$/` |
| `displayName` | 展示名 |
| `version` | 语义化版本号 |
| `description` | 应用描述 |
| `icon` | 图标，可用 emoji 字符串或图标 URL |
| `entry` | 入口 HTML 相对路径，固定 `./index.html` |
| `appConfig` | ofa.js app 配置相对路径，固定 `./app-config.js` |
| `createdAt` | 创建时间（毫秒时间戳） |
| `mazmot.source` | 来源标记：`self-created`（用户自建）/ `official-market`（官方市场安装）/ `share`（P2P 分享安装） |

`app.json` 在分享时会被读取并打包进 P2P payload，安装时由 `installAppPackage` 写入虚拟目录。

## 2. `apps[]` 持久化记录

Mazmot 把应用列表存在 ever-cache 的 `mazmot` 命名空间下，`storage.apps` 是一个数组，每条记录至少包含：

| 字段 | 说明 |
| ---- | ---- |
| `name` | 记录名（recordName），用作目录名与应用标识 |
| `desc` | 应用描述 |
| `source` | `"local"`（本地目录）/ `"virtual"`（虚拟目录，含分享安装）/ `"official"`（官方市场） |
| `namespace` | 虚拟目录命名空间（虚拟/官方为 `mazmot-apps`） |
| `handle` | 本地目录句柄（本地应用为原生 handle，虚拟/官方为 `null`） |
| `dirName` | 虚拟目录全路径（如 `mazmot-apps/my-app`） |
| `appId` | `` `${name}-${publisherUserId}` ``，用于判定分享归属 |
| `fileHash` | 应用包内容哈希（分享安装记录） |
| `payloadHash` | 分享清单哈希（分享安装记录，即短链接里的 `h`） |
| `officialId` | 官方应用 ID（官方市场记录） |
| `createdAt` | 创建时间戳 |

读写示例：

```js
import { storage } from "/nos/storage/main.js"; // 或 ever-cache 直接实例化
const apps = (await storage.apps) || [];
apps.push({ name: "my-app", source: "local", /* ... */ });
await storage.setItem("apps", apps);
```

## 3. 应用运行 —— `/lib/app-runner.js`

```js
import { getRunUrl, readAppFiles } from "/lib/app-runner.js";

// 生成运行 URL：
//   virtual/official → /$mazmot-apps/{name}/client/index.html
//   local           → mount(client/) → /{mounted}/index.html
const url = await getRunUrl(app);

// 递归读取应用文件（优先 client/，回退根目录）
// 返回 [{ path, content }]，path 已剥离 client/ 前缀
const files = await readAppFiles(app._handle);
```

`getRunUrl` 的 `app` 参数需要：`source`、`namespace`（虚拟）、`_handle`（本地）以及 `name` / `virtualDirName` / `dirName` 之一。

`readAppFiles` 是分享打包的前置步骤：它把应用目录平铺成 `{ path, content }` 数组。**只支持 UTF-8 文本文件**——二进制资源（图片 / 字体 / 音视频）无法进入分享 payload。

## 4. 应用分享（P2P）—— `/lib/share-mgr.js`

基于 noneos-core `DataPublisher` 封装的"一键分享"层。

```js
import {
  ensureUser, ensurePublisher, generateAppId,
  buildRunUrl, parseShareUrl, splitShareQuery,
  isPublicKeyOfUser,
  publishApp, unpublishApp,
} from "/lib/share-mgr.js";

// 一步发布：读文件 → 打包 → publish 内容 → publish 分享清单 → 拼短链接
const { shareUrl, appId, payloadHash, fileHash } =
  await publishApp(app, {
    appId,                       // 可选，未传则自动 generateAppId
    origin: location.origin,     // 可选
    appParams: { room: "abc" },  // 应用业务参数（透传给应用）
    onProgress: ({ phase, progress, text }) => {},
  });

// 撤销分享（只删 manifest，保留 chunks 做幂等复用）
await unpublishApp({ payloadHash, fileHash });
```

### 短链接结构

```
{origin}/apps/run-app/?u=<publisherUserId>&h=<payloadHash>[&应用业务参数...]
```

- **保留键固定为 `u` / `h`**，其它 query 视为应用业务参数。
- `u` = 发布者 userId（公钥 sha256_hex）；`h` = 分享清单内容哈希。
- 接收端按 `connectUser → requestManifest(h) → 校验签名者 → 逐块下载 → 组装写入` 的顺序处理，任何一步失败即进错误页。

```js
// URL 解析
parseShareUrl(location.search);   // { userId, payloadHash } | null（缺一即 null）
splitShareQuery(location.search); // { userId, payloadHash, appParams }（永远完整返回）
```

### 关键约束

- **只支持 UTF-8 文本文件**。二进制未来通过 `app.json` 加 `encoding: "base64"` 字段扩展，禁止私自塞 base64。
- **发布者必须在线**。接收端从发布者 IndexedDB 拉 chunk，发布者标签页关闭后未拉完的 chunk 无法继续。
- `appId` = `` `${name}-${userId}` ``；`appId.endsWith("-" + currentUserId)` 用于判定"是不是我自己分享的"（自我分享可跳过安装）。

## 5. 应用模板（创建新应用）

Mazmot 提供模板系统，让用户从预置模板创建新应用。模板位于 `apps/main/home/templates/<id>/`，通过 `__template.json` 描述元数据与文件清单。

```js
import {
  loadTemplates, buildTemplateFiles, writeTemplateFiles,
} from "/apps/main/home/template-writer.js";

// 加载模板列表（读 templates/manifest.json + 各 __template.json）
const list = await loadTemplates(); // [{ id, name, desc }]

// 生成文件列表（不写盘）
const files = await buildTemplateFiles({
  name: "my-app",
  desc: "描述",
  templateId: "base",  // "base" | "share-link" | "ping-pong" | "tic-tac-toe"
});

// 写入目标目录（自动创建 client/）
await writeTemplateFiles({
  dirHandle,           // noneos-core DirHandle
  name, desc,
  templateId: "base",
  onProgress: p => {}, // { index, total, path, status, progress }
});
```

`__template.json` 的 `replacements[].to` 支持变量：`APP_NAME` / `APP_NAMESPACE` / `APP_DESC` / `APP_DESC_HTML` / `APP_DESC_JSON` / `CREATED_AT`。

**新增模板必须在 `templates/manifest.json` 登记 id。**

## 6. 官方应用（应用市场）

官方应用位于 `official-apps/<id>/`，结构同模板，清单文件名为 `__app.json`。

```js
import {
  loadOfficialApps, loadOfficialAppMeta, compareVersions, installOfficialApp,
} from "/apps/main/home/official-app-writer.js";

const list = await loadOfficialApps(); // [{ id, name, icon, desc, version }]（version 读自应用自身的 app.json）

const meta = await loadOfficialAppMeta("hello-world"); // 单个应用元数据，null 表示不存在
compareVersions("1.1.0", "1.0.0"); // 1 / 0 / -1，用于判断是否有新版本

const result = await installOfficialApp({
  dirHandle,     // 虚拟目录句柄
  appId: "hello-world",
  onProgress: p => {},
});
// 返回 { name, desc, icon, files }
// 对已安装应用重复调用即为「更新」：覆盖写入 client/ 下的源文件
```

官方应用记录的 `source` 为 `"official"`，`mazmot.source` 标记为 `"official-market"`。**新增官方应用必须在 `official-apps/manifest.json` 登记 id。**

## 7. 应用打开状态追踪 —— `/apps/main/home/app-status.js`

跨标签页追踪"哪些应用窗口还活着"，基于 `BroadcastChannel("mazmot-app-status")`。

```js
import {
  startAppStatusWatcher,
  markOpened, clearOpened, focusIfOpened, isWindowAlive,
} from "/apps/main/home/app-status.js";

const stop = startAppStatusWatcher({
  onAlive: name => {},        // 收到 alive/pong
  onBye:   name => {},        // 收到 bye
  onTick:  aliveNames => {},  // 每 2s 探测后回调
});

const win = window.open(runUrl);
markOpened(app.name, win);           // 记录窗口引用
if (focusIfOpened(app.name)) return; // 已打开则聚焦
clearOpened(app.name);               // 删除时清理
```

这是 Mazmot 唯一允许直连 `localStorage`（键 `mazmot-opened-apps`）的场景，用于跨刷新恢复 UI 状态。其它持久化请用 ever-cache。

## 8. run-app 接收端工具函数

仅在 `/apps/run-app/` 内使用，写测试时可 import 纯函数：

```js
// /apps/run-app/lib/run-app-utils.js —— 纯函数（不依赖 DOM / 网络）
import {
  formatStatus, buildErrorDetail,
  mapAppProgress, mapCoreInstallProgress,
  findAppRecord, filterOtherApps, formatOtherAppEntry,
  findByPayloadHash, shouldSkipInstall,
  buildAppUrlWithParams,
} from "/apps/run-app/lib/run-app-utils.js";

formatStatus("下载中", 3, 9);          // "3/9 · 下载中"
buildAppUrlWithParams(baseUrl, appParams); // 把业务参数拼到应用入口 URL
shouldSkipInstall(installed, payload, isSelfShare); // 是否可跳过安装
```

```js
// /apps/run-app/lib/install-flow.js —— 安装流程（依赖通过参数注入）
import {
  fetchSharePayload, findInstalled, installAppPackage,
} from "/apps/run-app/lib/install-flow.js";

const payload = await fetchSharePayload({
  publisher, remoteUser, payloadHash, publisherUserId,
  isPublicKeyOfUser, onEvent: e => {},
});

const recordName = await installAppPackage({
  publisher, remoteUser, payload, payloadHash,
  existingRecord: hit?.record,
  storage, init, PACKAGE_VERSION,
  onEvent: e => {},
});

location.replace(`/$mazmot-apps/${recordName}/client/index.html`);
```

**不要吞错**：任何步骤抛错都应交给 `fail(title, err)` 进入错误页并 `console.error(err)`，禁止 try/catch 静默。

## 9. 测试（sibyl-test）

Mazmot 的每个库模块都配有 `.sb.html` 测试，测试 API 形如：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>xxx 单元测试</title>
    <script type="module"
      src="https://cdn.jsdelivr.net/gh/ofajs/sibyl-test/components/sb-test.mjs"></script>
  </head>
  <body>
    <sb-test name="用例标题">
      <template>
        <script type="module">
          import { getRunUrl } from "../app-runner.js";
          {
            const url = await getRunUrl({
              source: "virtual",
              namespace: "mazmot-apps",
              name: "demo-app",
            });
            return {
              assert: url === "/$mazmot-apps/demo-app/client/index.html",
              content: { url },
            };
          }
        </script>
      </template>
    </sb-test>
  </body>
</html>
```

### Mazmot 测试约定

- **位置**：被测模块同级 `test/` 子目录，文件名与被测模块同名（如 `app-runner.js` → `test/app-runner.sb.html`）。
- **结构**：每个 `<sb-test name="...">` 内一个 `<template><script type="module">`，返回 `{ assert: boolean, content: any }`。
- **import 路径**：从测试文件相对引用被测模块（`../app-runner.js`）；如需 noneos-core 能力（如 `init`），顶层 `import "/nos/fs/main.js"` 在测试页可用（测试页打开时 Core 应已就绪）。
- **运行**：`npx sb-test -f <路径>.sb.html --browsers chrome`（快速）/ `npm test`（多浏览器）。
- **前置条件**：测试页需要 Core 已装才能打开涉及 `/nos/*` 的用例；先访问 `/` 让 `<nos-version auto-install>` 装完再进测试页。

### 测试 Mazmot API 的典型模式

- **纯函数**（`run-app-utils.js`、`share-mgr.js` 的 URL 拼装 / 解析）：直接 import，断言返回值。
- **依赖文件系统的函数**（`readAppFiles`）：在测试内 `await init("mazmot-test-apps")` 建临时目录、写文件、调被测函数、断言结果。
- **依赖 P2P 网络的函数**（`publishApp`、`fetchSharePayload`）：拆成纯函数 + 注入依赖的形式单测，端到端流程留给手动验证。

## 10. 能力边界（什么不做）

- **不重新封装 noneos-core**：`fs` / `user` / `DataPublisher` / `n-icon` 等 API 直接按 noneos-core 文档调用，Mazmot 只在上层（`share-mgr.js` 等）做业务编排。
- **不支持二进制分享**：当前只支持 UTF-8 文本文件（见 §3 / §4）。
- **应用不跑在沙箱**：应用直接在主域通过 NoneOS 挂载路径运行，没有 iframe 容器。
