# AI 开发指南 — Service Chat 模板

本目录是由 Mazmot 的 **service-chat（服务聊天）模板** 创建的 ofa.js 应用，演示服务商 / 客户双角色点对点聊天。请按以下规则修改代码，避免引入与 Mazmot 主系统冲突的写法。

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
| 联机     | NoneOS Core user          | 服务商 / 客户通过 `registerService` / `connectUser` / `sendToService` 通信，**禁止**绕开 Core 自建信令                  |

## 依赖 URL 规范（重要）

同一份仓库资源，**加载位置不同，前缀不同**：

- **能独立运行的 HTML 文件**（如 [index.html](index.html)、以及任何脱离 Mazmot / NoneOS Core 环境也能被浏览器直接打开的入口 HTML）：必须使用完整 URL `https://cdn.jsdelivr.net/gh/ofajs/...`。因为此时 NoneOS Core Service Worker 未必已注册，`/gh/`、`/npm/` 本地前缀不可用。
- **页面模块 / 组件模块 / 普通模块**（`<template page>` / `<template component>` / 普通 `.js` 模块）：必须使用 `/gh/` 或 `/npm/` 前缀，由 NoneOS Core Service Worker 拦截（离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net/...` 完整 URL。
  - 例外：页面模块内通过 `load(...)` 动态加载 ever-cache 时沿用既有写法 `load("https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js")`，因为 ever-cache 不走 ofa.js 仓库前缀。
- `#debug` 后缀不要去掉，保留调试信息。

## 角色与联机规则（本模板核心）

1. **角色判断只在初始化时做一次**：URL query 带 `host=<userId>` → 客户模式；缺省 → 服务商模式。判定结果决定后续整个生命周期，**禁止**在运行期切换角色。
2. **命名空间与 Service ID 必须两端一致**：服务商和客户必须使用**同一个 `NAMESPACE`（默认 `mazmot`）** 和**同一个 `SERVICE_ID`（默认 `chat`）**，否则互相发现不到。修改其中一处必须同步另一处。
3. **服务商必须先 `registerService` 再等消息**：`initHost` 内 `registerService(SERVICE_ID, { onMessage })` 必须在客户发消息之前完成；客户消息到达时 `onMessage` 才能被触发。
4. **客户必须 `connectUser` + `isRemoteUserOnline` 双检**：仅 `connectUser` 成功不代表对端在线，必须再调用 `isRemoteUserOnline` 确认，否则会误判为"已连接"。
5. **服务商发布链接时必须把自己的 `userId` 带进 `appParams`**：`publishApp(app, { appParams: { host: this.myUserId } })`，客户打开链接后才能从 `host` 参数知道要连谁。**禁止**用其他 query 键（如 `hostId` / `peer`）替代。
6. **P2P 无后端，服务商必须保持在线**：服务商标签页一旦关闭，客户即无法送达消息。涉及关闭 / 切后台 / 断网提醒的 UI 必须以这一前提设计。
7. **`detached` 必须反注册服务**：页面销毁时 `this._svc.unregister()`，避免泄漏服务句柄、客户误判在线。
8. **非响应式引用必须用 `_` 前缀**：`this._user` / `this._customerRemote` / `this._svc` 等不参与模板渲染的对象，**必须**以 `_` 开头，否则会被 ofa.js 当作响应式数据代理，造成性能或行为异常。

## 开发指令

0. **开发前必读（框架）**：先查阅 `ofajs-docs` 技能文档，掌握 ofa.js 组件 / 页面 / 路由 / 状态管理的最新用法后再动手，避免写出不符合框架规范的代码。
1. **开发前必读（项目）**：动手前先阅读 [CONTEXT.md](CONTEXT.md)，可以快速掌握本模板的项目结构、目录用途、关键模块与数据流，避免盲改。
2. **涉及 NoneOS Core 联机能力必读**：使用用户通信相关 API 前，必须先查阅 `noneos-core-docs` 技能文档，按官方 API 调用，禁止凭记忆写。具体可用 API 清单见 [CONTEXT.md](CONTEXT.md)。
3. **涉及分享发布必读**：调用分享相关 API 前，必须先查阅根目录 `lib/share-mgr.js` 的签名与 `appParams` 约定，禁止私自构造 payload。具体可用 API 清单见 [CONTEXT.md](CONTEXT.md)。
4. **异步依赖加载**：需要 NoneOS Core 模块（`/nos/*`）时，只能通过 `const load = lm(import.meta); await load("/nos/xxx/main.js")` 或页面 `export default` 参数里的 `load` 按需加载；**顶层禁止 `import "/nos/*"`**，否则 Core 未就绪会白屏。
5. **涉及数据存储必读**：需要持久化数据时，必须先查阅 `ever-cache` 技能文档，使用 EverCache（`storageName`）进行存储，禁止裸用 `localStorage`。
6. 新增路由 / 子页面时在 [app-config.js](app-config.js) 中导出（如 `export const settings = "./pages/settings.html"`）。
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
