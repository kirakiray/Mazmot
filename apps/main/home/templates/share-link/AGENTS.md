# AI 开发指南 — Share Link 模板

本目录是由 Mazmot 的 **share-link（分享链接）模板** 创建的 ofa.js 应用，演示如何生成带业务参数的分享链接，让他人通过链接自动安装应用并接收参数。请按以下规则修改代码，避免引入与 Mazmot 主系统冲突的写法。

## 文档职责划分（重要）

- **AGENTS.md** 只收录**规则性内容**：开发规范、强制约束、技术栈选型、URL 前缀约定、编码禁区等"必须 / 禁止"类条款。
- **CONTEXT.md** 只收录**上下文性内容**：项目结构、目录用途、关键模块清单、公开 API、数据字段、关键流程描述等"当前是什么样的"事实陈述。

> 判断标准：能写成"必须做 X / 禁止做 Y"的放 AGENTS.md；描述"现在系统里有 A、B、C"的放 CONTEXT.md。不要把两类内容混在同一份文档里。

## 技术栈

| 层       | 技术                      | 备注                                                                                                                     |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 应用框架 | **ofa.js**                | 使用 `<template page>`、`<o-if>`、`<o-fill>`、`on:click`、`sync:value`、`proto`/`data` 等语法，**禁止 Vue / React 语法** |
| UI       | 原生 HTML + CSS           | 手写样式，使用 `index.html` 中定义的 Material 主题变量 `--md-sys-color-*`，按钮 / 列表等直接用原生标签实现               |
| 图标     | `<n-icon icon="mdi:xxx">` | 依赖 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`，**禁止**直接使用 `iconify-icon`                                        |
| 存储     | ever-cache                | 需要持久化时用 `storage.xxx`，勿裸用 `localStorage`                                                                      |
| 分享     | lib/share-mgr.js          | 通过 `publishApp` 把应用 + 参数发布到 P2P 分享网络，**禁止**绕开 share-mgr 私自构造 payload                              |

## 依赖 URL 规范（重要）

同一份仓库资源，**加载位置不同，前缀不同**：

- **能独立运行的 HTML 文件**（如 [index.html](index.html)、以及任何脱离 Mazmot / NoneOS Core 环境也能被浏览器直接打开的入口 HTML）：必须使用完整 URL `https://cdn.jsdelivr.net/gh/ofajs/...`。因为此时 NoneOS Core Service Worker 未必已注册，`/gh/`、`/npm/` 本地前缀不可用。
- **页面模块 / 组件模块 / 普通模块**（`<template page>` / `<template component>` / 普通 `.js` 模块）：必须使用 `/gh/` 或 `/npm/` 前缀，由 NoneOS Core Service Worker 拦截（离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net/...` 完整 URL。
  - 例外：页面模块内通过 `load(...)` 动态加载 ever-cache 时沿用既有写法 `load("https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js")`，因为 ever-cache 不走 ofa.js 仓库前缀。
- `#debug` 后缀不要去掉，保留调试信息。

## 分享链接与参数规则（本模板核心）

1. **业务参数只能通过 `appParams` 传递**：调用 `publishApp(app, { appId, appParams, onProgress })` 时，所有业务参数（如 `mood=happy`）必须打包进 `appParams` 对象，由 share-mgr 统一编码进分享 URL。**禁止**手动拼接 query string、**禁止**复用系统保留键 `u` / `h`。
2. **`u` / `h` 是系统保留字段**：分享 URL 中的 `u=<userId>` 与 `h=<payloadHash>` 由 share-mgr 注入，run-app 在接收端会剥离这两个字段；页面内 `new URLSearchParams(location.search)` 拿到的**只剩业务参数**，依赖这一约定做参数解析。
3. **`parseSelfIdentity` 必须按既定正则解析**：路径格式固定为 `/$<namespace>/<dirName>/client/index.html`，正则 `/^\/\$(.+?)\/(.+?)\/client\/index\.html$/` 不能改；解析失败必须抛错或返回 `null`，**禁止**用 `location.pathname` 切片硬编码偏移。
4. **`appId` 必须持久化复用**：从本地 `storage.apps` 记录里找到自己的 `appId` 就直接复用；只有记录缺失 `appId` 时才调 `generateAppId`，并**立即**写回 `record.appId` 后 `await storage.setItem("apps", apps)`，避免每次分享都重新生成。
5. **`payloadHash` 必须回写记录**：`publishApp` 返回的 `payloadHash` 要立即写回 `record.payloadHash` 并持久化，run-app 依赖它做"秒跳"判断。
6. **参数列表至少保留一行**：UI 删除最后一行参数后必须补一行空数据，避免列表清空导致用户无法继续输入。
7. **发布者必须在线**：分享基于 P2P，接收端通过短链接从发布者 IndexedDB 拉 chunk；发布者标签页关闭则未拉完的 chunk 无法继续。设计关闭 / 断网提醒时以此为前提。
8. **提示用户先开"自动分享"**：生成链接前若用户未在应用列表为本应用开启"自动分享"，他人打开链接会因本机未发布而失败。该提示文案必须保留在生成卡片里，**禁止**删除。

## 开发指令

0. **开发前必读（框架）**：先查阅 `ofajs-docs` 技能文档，掌握 ofa.js 组件 / 页面 / 路由 / 状态管理的最新用法后再动手，避免写出不符合框架规范的代码。
1. **开发前必读（项目）**：动手前先阅读 [CONTEXT.md](CONTEXT.md)，可以快速掌握本模板的项目结构、目录用途、关键模块与数据流，避免盲改。
2. **涉及分享发布必读**：调用分享相关 API 前，必须先查阅根目录 `lib/share-mgr.js` 的签名、`appParams` 约定与 P2P 约束，禁止凭记忆写参数结构。具体可用 API 清单见 [CONTEXT.md](CONTEXT.md)。
3. **涉及 NoneOS Core 文件系统能力必读**：使用文件系统相关 API 前，必须先查阅 `noneos-core-docs` 技能文档，按官方 API 调用。具体可用 API 清单见 [CONTEXT.md](CONTEXT.md)。
4. **涉及数据存储必读**：需要持久化数据时，必须先查阅 `ever-cache` 技能文档，使用 EverCache（`storageName`）进行存储，禁止裸用 `localStorage`。
5. 新增路由 / 子页面时在 [app-config.js](app-config.js) 中导出（如 `export const history = "./pages/history.html"`）。
7. **较大逻辑改动后必须同步 [CONTEXT.md](CONTEXT.md)**：文件结构、公开 API、数据字段、关键流程、模块职责等发生变化时，立即更新对应章节，不得事后补。
8. **发现不一致立即修正 [CONTEXT.md](CONTEXT.md)**：查阅 CONTEXT.md 后再去读具体逻辑模块，若发现 CONTEXT 中的描述与实际代码不符（旧描述、字段过期、路径错误、流程改动未同步等），**立即修正 CONTEXT 内容**，让上下文文档与代码保持一致。
9. **组件 / 独立模块开发完成后建立测试**：开发完一个组件或相对独立的逻辑模块后，使用 `sibyl-test` 为该模块建立对应的 `.sb.html` 测试文件（推荐放在模块所在目录的 `test/` 子目录，文件名与被测模块同名），编写前先查阅 `sibyl-test` 技能文档。
10. **sibyl-test 执行方式**：写完 `.sb.html` 测试文件后**不要自动执行测试**，先询问开发者是否让 AI 跑自动化测试；开发者同意后，优先使用 `npx sb-test -f <目标测试文件>.sb.html --browsers chrome` 在 Chrome 中快速验证，根据结果动态修复；完整多浏览器测试用 `npm test`。
11. 只做被要求的事，避免过度设计与冗余抽象。

## 技能资源与导入 (Skill Resources)

若本地环境中缺少相关知识库，请通过以下链接获取最新版本：

- **ofa.js-docs**
  - [GitHub 在线源码](https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/ofa.js/refs/heads/main/skills/ofajs-docs.zip)
- **noneos-core-docs**
  - [GitHub 在线源码](https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/kirakiray/noneos-core/refs/heads/main/skills/noneos-core-docs.zip)
- **ever-cache**
  - 涉及存储数据（如 localStorage）时，应优先使用 EverCache 替代原生存储方案。
  - 使用前请检查本地是否有 ever-cache Skill，若无则需导入。
  - [Skill 在线文件](https://github.com/kirakiray/ever-cache/blob/main/skills/ever-cache/SKILL.md)
- **sibyl-test**
  - 该项目使用 `sibyl-test` 作为测试模块。
  - 使用前请检查本地是否有 sibyl-test Skill，若无则需导入。
  - [Skill 在线文件](https://raw.githubusercontent.com/ofajs/sibyl-test/refs/heads/main/skills/sibyl-test/SKILL.md)
