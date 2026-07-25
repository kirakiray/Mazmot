# Share Link 模板 Context

> 演示带参数分享链接：用户在页面输入业务参数，生成分享链接；他人打开链接后自动安装应用，URL 上携带的业务参数会被页面读取并展示。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── __template.json   # 模板元数据 + 生成时替换规则（APP_NAME / APP_DESC_JSON / CREATED_AT）
├── app.json          # 应用元数据：name / version / icon / entry / appConfig
├── index.html        # 入口 HTML：加载 ofa.js + Material 主题变量 + <o-router>/<o-app>
├── app-config.js     # 应用配置：导出 home 路由 + pageAnime 切换动画
└── pages/
    └── home.html     # 首页模块（<template page>）：参数输入 + 链接生成 + 收参展示
```

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`）。
- **模板替换**：`__template.json` 声明 `app.json` / `index.html` / `pages/home.html` 中的 `Mazmot Share Link Demo` 字符串在生成实例时替换为 `APP_NAME`。
- **P2P 无后端**：分享基于点对点，接收端通过短链接从发布者 IndexedDB 拉 chunk；发布者标签页关闭则未拉完的 chunk 无法继续。涉及关闭 / 断网提醒的 UI 均以此为前提。
- **"自动分享"提示文案**：生成链接卡片里保留一条固定提示——生成链接前需先在应用列表为本应用开启「自动分享」，否则他人打开链接会因本机未发布而失败。

## 首页模块数据字段（`pages/home.html`）

`export default async ({ load }) => ({ data, proto })` 返回的实例状态：

| 字段           | 类型     | 用途                                                       |
| -------------- | -------- | ---------------------------------------------------------- |
| `paramList`    | array    | 待发布参数编辑列表，每项 `{ key, value }`；至少保留一行    |
| `receivedList` | array    | 从当前 URL 解析出的接收参数，每项 `{ key, value }`         |
| `shareUrl`     | string   | 已生成的分享链接                                           |
| `generating`   | boolean  | 是否正在生成链接                                           |
| `genStatus`    | string   | 生成进度文案                                               |
| `genError`     | string   | 生成失败时的错误信息                                       |
| `copyText`     | string   | 复制按钮文案（"复制" / "已复制 ✓" / "复制失败"）           |

非响应式实例属性：`this._copyTimer`（复制按钮状态还原定时器句柄）。

## URL 参数约定

- **系统保留字段**：`u`（发布者 userId）、`h`（payloadHash）由 `lib/share-mgr.js` 注入；接收端 `apps/run-app` 会剥离这两个字段，页面内 `new URLSearchParams(location.search)` 拿到的只剩业务参数。
- **业务参数**：由用户在页面输入，通过 `publishApp` 的 `appParams` 选项统一编码进分享 URL。

## 依赖的外部 API

### share-mgr（仓库根 `lib/share-mgr.js`）

通过 `const { publishApp, generateAppId } = await load("/lib/share-mgr.js")` 获取：

- `generateAppId(dirName)`：根据目录名生成稳定的应用 ID。
- `publishApp(app, options)`：发布应用到 P2P 网络。
  - `app` 形状：`{ _handle, _recordName, name, version, desc, icon, appId }`。
  - `options`：`{ appId, appParams, onProgress }`。`appParams` 是业务参数对象（如 `{ mood: "happy" }`）。
  - 返回 `{ shareUrl, payloadHash }`。

### ever-cache（`https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js`）

通过 `const { storage } = await load(...)` 获取：

- `await storage.apps`：读取本地应用记录数组（每项含 `name` / `virtualDirName` / `dirName` / `appId` / `payloadHash` 等）。
- `await storage.setItem("apps", apps)`：写回记录。

### NoneOS Core fs（`/nos/fs/main.js`）

- `const { init } = await load("/nos/fs/main.js"); const rootDir = await init(namespace);`
- `await rootDir.get(dirName)`：获取应用目录句柄（供 `publishApp` 读取文件清单）。

## 关键流程

### 1. 接收参数解析（模块加载时一次性完成）

`export default async ({ load }) => { ... }` 顶层 `new URLSearchParams(location.search)` 遍历所有 query 项，转成 `receivedList` 初始化进 `data`。

### 2. 参数编辑（`addParam` / `removeParam`）

- `addParam()`：往 `paramList` 推 `{ key: "", value: "" }`。
- `removeParam(event, item)`：从 `paramList` 移除指定项；若清空则补一行空数据，保证至少一行可输入。

### 3. 生成分享链接（`generateLink`）

1. `collectParams()` 过滤出 key/value 均非空的项组成对象；为空则报错返回。
2. `parseSelfIdentity()` 从 `location.pathname`（格式 `/$<namespace>/<dirName>/client/index.html`）解析自身身份。
3. 并行加载 `fs` / `ever-cache` / `share-mgr`。
4. 从 `storage.apps` 查记录（按 `name` / `virtualDirName` / `dirName` 三级匹配）；缺 `appId` 则 `generateAppId` 并写回。
5. `rootDir.get(dirName)` 取目录句柄，组装 `app` 对象。
6. `publishApp(app, { appId, appParams, onProgress })`。
7. `payloadHash` 写回 `record.payloadHash`，`shareUrl` 展示在链接框。

### 4. 复制链接（`copyLink`）

优先用 `navigator.clipboard.writeText`，回退到隐藏 `textarea` + `execCommand("copy")`。复制后 `copyText` 切到"已复制 ✓"，1.8s 后由 `_copyTimer` 还原。

## 自身身份解析

`parseSelfIdentity()` 使用正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 匹配 `location.pathname`，捕获 `{ namespace, dirName }`。匹配失败返回 `null`，由调用方抛错。
