---
name: "mazmot-api"
description: "Mazmot 环境 API 速查：告诉 AI 如何在 Mazmot（noneos-core + ofa.js）代码里正确加载依赖、调用文件系统 / 用户 / P2P 分享 / 应用运行 / 模板写入 / 系统组件等 API。当用户在 Mazmot 仓库内编写或修改代码时调用。"
---

# Mazmot 环境 API 速查

面向在 Mazmot 仓库内写代码的 AI。只讲**怎么调 API**，不讲项目背景。项目结构、数据模型、流程叙述请查 [CONTEXT.md](../../CONTEXT.md) 与 [AGENTS.md](../../AGENTS.md)。

## 0. 依赖 URL 前缀（决定成败）

同一份资源，**加载位置不同前缀不同**：

| 位置 | ofa.js / router | Punch-UI | `/nos/*` 模块 |
| ---- | --------------- | -------- | ------------- |
| 顶层入口 HTML（`index.html` / `apps/*/index.html`） | `https://cdn.jsdelivr.net/gh/ofajs/ofa.js@4.7.1/dist/ofa.mjs#debug` | 只有在**已确认 Core 就绪**时才能 `import "/nos/*"`，否则 `try { await import("/nos/fs/main.js") } catch { location.href = "/?redirect=..." }` |
| 页面模块 / 组件 / 普通模块 / 测试页 | `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`、`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs` | 同上 | **禁止**顶层 `import "/nos/*"`；使用 `const load = lm(import.meta); await load("/nos/fs/main.js")` 在 `attached` 内按需加载 |

- ofa.js 必须带 `#debug`；顶层入口可锁版本，模块位置一律 `@latest`。
- 主入口 [apps/main/app-config.js](../../apps/main/app-config.js) 顶层可 `await init("mazmot")`（前提是 [apps/main/index.html](../../apps/main/index.html) 已校验 Core）；[apps/run-app/app-config.js](../../apps/run-app/app-config.js) **禁止** `init()`（Core 由页面自装）。

## 1. NoneOS Core 文件系统

```js
import { init, mount } from "/nos/fs/main.js";

// 初始化命名空间，返回根 DirHandle
const root = await init("mazmot-apps");

// 目录 / 文件读写
const dir  = await root.get("my-app",     { create: "dir"  });
const file = await dir.get("app.json",    { create: "file" });
await file.write(JSON.stringify({ name: "my-app" }));
const text = await file.text();
const json = await file.json();

// 平铺读取所有文件（含子目录）
const flat = await dir.flat();  // [{ path, text(), ... }, ...]

// 挂载本地目录到主域，得到可 fetch 的路径
const mounted = await mount(clientHandle);
window.open(`/${mounted.path}/index.html`);

// 删除
await file.remove();
```

约定：Mazmot 主命名空间为 `mazmot`；应用虚拟目录命名空间为 `mazmot-apps`；每个应用必须有 `client/` 子目录，`client/` 内必须至少含 `app.json` + `index.html`。

## 2. NoneOS 用户 / 分享 API

```js
import { getUser } from "/nos/user/main.js";
import { DataPublisher } from "/nos/publish/data-publisher.js";
import { getHash } from "/nos/util/hash/main.js";
import { deleteManifest } from "/nos/publish/db.js";

const user = await getUser("mazmot");       // LocalUser，userId = sha256_hex(publicKey)
const publisher = new DataPublisher(user);
publisher.start();

// 发布一个 File → 得到内容 manifest（含 fileHash / chunkHashes / publicKey）
const manifest = await publisher.publish(file);

// 接收端：先连服务器 → connectUser → 请求 manifest → 逐块 → 组装
await user.server.connect(url);
const remoteUser = await user.connectUser(publisherUserId);
const mf = await publisher.requestManifest(remoteUser, hash);
await publisher.requestChunk(remoteUser, chunkHash);
const { blob } = await publisher.assembleFile(hash);

// 校验签名者身份
const ok = (await getHash(mf.publicKey)) === expectedUserId;

// 撤销分享（只删 manifest，保留 chunks 用于秒回复）
await deleteManifest("mazmot", payloadHash);
```

> Mazmot 里请使用 [share-mgr.js](../../lib/share-mgr.js) 已封装的函数，不要直接重复实现（见 §4）。

## 3. `app-runner.js` — 应用运行 URL / 文件读取

[lib/app-runner.js](../../lib/app-runner.js)

```js
import { getRunUrl, readAppFiles } from "/lib/app-runner.js";

// 生成运行 URL：virtual/official → /$<ns>/<name>/client/index.html
//                local           → mount(client) → /<mounted>/index.html
const url = await getRunUrl(app); // 传运行时 app 对象（source/namespace/_handle/name/virtualDirName）

// 递归读取应用文件（优先 client/，回退根目录），返回 [{path, content}]
const files = await readAppFiles(app._handle);
```

`app` 对象至少需要：`source`（`"local"|"virtual"|"official"`）、`namespace`（虚拟）、`_handle`（本地/虚拟句柄）、`name` 或 `virtualDirName`。

## 4. `share-mgr.js` — 分享发布 / 验签 / URL

[lib/share-mgr.js](../../lib/share-mgr.js)

```js
import {
  PACKAGE_VERSION, SHARE_NAMESPACE, RESERVED_SHARE_KEYS,
  ensureUser, ensurePublisher, generateAppId,
  buildPackageFile, buildSharePayloadFile,
  buildRunUrl, parseShareUrl, splitShareQuery,
  isPublicKeyOfUser,
  publishApp, unpublishApp,
} from "/lib/share-mgr.js";

// 一步发布：读文件→打包→publish 内容→publish 清单→拼短链接
const { shareUrl, appId, payloadHash, fileHash } =
  await publishApp(app, {
    appId,                         // 可选，未传则自动 generateAppId
    origin: location.origin,       // 可选
    appParams: { room: "abc" },    // 应用业务参数（透传给应用，禁止用保留键 u/h）
    onProgress: ({ phase, progress, text }) => { /* ... */ },
  });

// URL 结构：{origin}/apps/run-app/?u=<userId>&h=<payloadHash>[&业务参数...]
const parsed = parseShareUrl(location.search);           // { userId, payloadHash } | null
const split  = splitShareQuery(location.search);         // { userId, payloadHash, appParams }

// 撤销分享（只删 manifest，chunks 保留幂等复用）
await unpublishApp({ payloadHash, fileHash });
```

**关键约束**：

- URL 保留键固定 `u` / `h`，其它 query 视为应用业务参数；`buildRunUrl` 的第 4 参数 `appParams` 即为透传参数。
- `appId` = `` `${name}-${LocalUser.userId}` ``；`appId.endsWith("-" + currentUserId)` 判定 `isMine`。
- 只支持 **UTF-8 文本文件**。二进制未来通过 `encoding: "base64"` 扩展，禁止私自塞 base64。
- 发布者标签页必须保持在线，否则接收端拉不到剩余 chunk。

## 5. `run-app/lib/*` — 接收端工具函数

只在 [apps/run-app/run-app.html](../../apps/run-app/run-app.html) 内使用；写测试时可直接 import 纯函数。

```js
// run-app-utils.js —— 纯函数
import { formatStatus, buildErrorDetail, mapAppProgress,
         mapCoreInstallProgress } from "/apps/run-app/lib/run-app-utils.js";

formatStatus("下载中...", 3, 9);    // "3/9 · 下载中..."
buildErrorDetail(err);              // 拼装 name/message/code/cause/stack 多行文本
mapAppProgress(oldPct, coreEnd);    // 把 5-100 映射到 coreEnd-100
mapCoreInstallProgress(step, total, coreEnd);

// connection.js
import { ensureServerConnected, waitForRtcReady,
         requestChunkWithRetry, formatPathHint,
         readHandshakeStatus } from "/apps/run-app/lib/connection.js";

await ensureServerConnected(user, { timeout: 2000 });
await waitForRtcReady(remoteUser, 3000);
await requestChunkWithRetry(publisher, remoteUser, hash,
  { retries: 3, onAttemptFail: ({attempt, err}) => {} });
const status = await readHandshakeStatus(user, remoteUser); // { url, connected, rtt }

// install-flow.js
import { fetchSharePayload, findInstalled,
         installAppPackage } from "/apps/run-app/lib/install-flow.js";

const payload = await fetchSharePayload({
  publisher, remoteUser, payloadHash, publisherUserId,
  isPublicKeyOfUser, onEvent: e => {},
});
const hit = await findInstalled(payload, { storage, init, findAppRecord });
const recordName = await installAppPackage({
  publisher, remoteUser, payload, payloadHash,
  existingRecord: hit?.record, storage, init,
  PACKAGE_VERSION, onEvent: e => {},
});
location.replace(`/$mazmot-apps/${recordName}/client/index.html`);
```

**不要吞错**：任何步骤抛错都应交给 `fail(title, err)` 进入错误页并 `console.error(err)`；禁止用 try/catch 静默。

## 6. 模板 / 官方应用写入

```js
// template-writer.js
import { loadTemplates, buildTemplateFiles,
         writeTemplateFiles } from "/apps/main/home/template-writer.js";

const list  = await loadTemplates();  // 读 templates/manifest.json + 每个 __template.json
const files = await buildTemplateFiles({ name, desc, templateId: "base" });
await writeTemplateFiles({
  dirHandle,           // 目标目录（本地或虚拟），会自动创建 client/
  name, desc,
  templateId: "base",  // "base" | "share-link" | "service-chat"
  onProgress: p => {}, // { index, total, path, status, progress }
});
```

`__template.json` 中 `replacements[].to` 支持变量：`APP_NAME` / `APP_NAMESPACE` / `APP_DESC` / `APP_DESC_HTML` / `APP_DESC_JSON` / `CREATED_AT`。

官方应用（应用市场）用法类似，见 [official-app-writer.js](../../apps/main/home/official-app-writer.js)。**新增模板/官方应用必须在对应 `manifest.json` 登记 id。**

## 7. 应用打开状态追踪

```js
import {
  getBroadcast, startAppStatusWatcher,
  markOpened, clearOpened, focusIfOpened, isWindowAlive,
} from "/apps/main/home/app-status.js";

const stop = startAppStatusWatcher({
  onAlive: name => {},
  onBye:   name => {},
  onTick:  aliveNames => {},   // 每 2s
});

const win = window.open(runUrl);
markOpened(app.name, win);
if (focusIfOpened(app.name)) return;
clearOpened(app.name);
```

底层依赖 `BroadcastChannel("mazmot-app-status")` + `localStorage["mazmot-opened-apps"]`。**这是唯一允许直连 `localStorage` 的场景**；其它持久化必须用 `ever-cache`。

## 8. 本地存储 —— EverCache

```js
import { EverCache } from "https://cdn.jsdelivr.net/npm/ever-cache/dist/ever-cache.mjs";
const storage = new EverCache("mazmot");
const apps = (await storage.apps) || [];
await storage.setItem("apps", apps);
```

Mazmot 使用的 namespace：

| namespace | 用途 |
| --------- | ---- |
| `mazmot` | 主 `apps[]` 列表等核心数据 |
| `mazmot-rnd-box` | `<m-rnd-box>` 位置/尺寸/focus 持久化 |
| `mazmot-rdn-network` | `<rdn-network>` collapsed 状态 |

**新增组件请用独立 namespace（`mazmot-<组件名>`），禁止污染 `mazmot`。**

## 9. `apps[]` 记录字段（写入前必读）

持久化时至少包含：`name`（`/^[A-Za-z0-9_-]+$/`）、`desc`、`handle`（本地存原生 handle，虚拟/官方为 null）、`dirName`、`source`（`"local"|"virtual"|"official"`）、`namespace`、`appId`、`autoShare`、`createdAt`。经 run-app 安装的另带 `fileHash`、`payloadHash`。官方应用另带 `officialId`。

**新增字段必须同步**：`share-mgr.js` 的 payload `meta`（若参与分享）、[home.html](../../apps/main/home.html) `loadApps` 运行时装配、[add-app.html](../../apps/main/home/add-app.html) 写入、[CONTEXT.md](../../CONTEXT.md) 数据模型章节。

## 10. UI 组件

```html
<!-- 图标：业务只用 n-icon，禁止直接调 iconify-icon -->
<l-m src="/nos/n-icon/n-icon.html"></l-m>
<n-icon icon="mdi:share-variant"></n-icon>

<!-- 二维码 -->
<l-m src="/comps/ercode/ercode.html"></l-m>
<m-ercode content="https://..."></m-ercode>

<!-- 可拖拽缩放浮盒 -->
<l-m src="/comps/rnd-box/rnd-box.html"></l-m>
<m-rnd-box movable resizable auto-save-id="my-panel"
           x="20" y="20" width="360" height="240"></m-rnd-box>

<!-- 浮窗式网络面板（主应用挂载） -->
<l-m src="/comps/rdn-network/rdn-network.html"></l-m>
<rdn-network></rdn-network>
```

CSS 选择器统一用 `n-icon`（不要选 `iconify-icon`）。Punch-UI 组件按需 `<l-m>` 加载，遵循 §0 URL 规范。

## 11. ofa.js 主入口配置

```js
// apps/main/app-config.js  —— Core 已就绪时可以顶层 init
import { init } from "/nos/fs/main.js";
await init("mazmot");
export const home = "./home.html";
export const pageAnime = { current: {...}, next: {...}, previous: {...} };
```

```js
// apps/run-app/app-config.js —— 不 init，Core 由 run-app.html 自装
export const home = "./run-app.html";
```

## 12. 测试（sibyl-test）

- 测试文件形如 `xxx.sb.html`，跟随被测模块放到同级 `test/` 子目录，与被测模块同名。
- 测试页头必须引 `sibyl-test`：
  ```html
  <script type="module"
    src="https://cdn.jsdelivr.net/gh/ofajs/sibyl-test/components/sb-test.mjs"></script>
  ```
- 单个测试用 `<sb-test name="..."><template><script type="module">...</script></template></sb-test>`，返回 `{ assert, content }`。
- 运行：`npx sb-test -f <路径>.sb.html --browsers chrome`（快速）/ `npm test`（多浏览器）。
- **CI 跑三浏览器矩阵**（Chrome/Firefox/WebKit），一种通过不等于全绿。
- 测试页需要 **Core 已装** 才可打开；先访问 `/` 让 `<nos-version auto-install>` 装完再进测试页。
- 写测试前必须查 `sibyl-test` 技能。

## 13. 硬约束（AI 必须遵守）

1. 语法只能是 **ofa.js**：`<o-if>` / `<o-fill>` / `on:click` / `proto` / `data` / `sync:` / `:style.`，禁止 Vue / React 语法。
2. 依赖 URL 严格遵守 §0；违反 → 首次访问白屏。
3. 存储只能用 EverCache（唯一例外见 §7）；图标只能用 `<n-icon>`。
4. 分享保留键固定 `u/h`，不得新增；只支持 UTF-8 文本文件。
5. 修改文件 / API / 数据结构 / 流程 / 应用 / 组件 → **必须同步** [CONTEXT.md](../../CONTEXT.md)（目录树 / 速查 / 数据模型 / 流程图）。
6. 只记当前架构，不写"改造前 / 已废弃 / 未来"等冗余；历史进 git commit。
7. 文档 / 注释 / 配置里禁用 `file://` 路径，用仓库相对路径。
8. 写完测试前先询问是否运行；测试前必查 `sibyl-test` 技能；触及 ofa.js / Punch-UI / NoneOS Core / ever-cache 前查各自技能。

## 14. 上游技能包（本地缺失时导入）

- ofajs-docs: https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs
- noneos-core-docs: https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs
- ever-cache: https://github.com/kirakiray/ever-cache/blob/main/skills/ever-cache/SKILL.md
- sibyl-test: https://raw.githubusercontent.com/ofajs/sibyl-test/refs/heads/main/skills/sibyl-test/SKILL.md

导入 zip 时必须包含 `references/` 与 `assets/` 全部文件。
