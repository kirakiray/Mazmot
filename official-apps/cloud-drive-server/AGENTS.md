# AI 开发指南

本目录是由 Mazmot 的 **base（基础）模板** 创建的 ofa.js 应用。请按以下规则修改代码，避免引入与 Mazmot 主系统冲突的写法。

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
| 存储     | `/nos/storage/main.js`   | NoneOS Core 官方异步键值存储（IndexedDB）；用 `getStorage(<id>)` 划分空间，勿裸用 `localStorage`                           |

## 依赖 URL 规范（重要）

同一份仓库资源，**加载位置不同，前缀不同**：

- **所有文件（含入口 HTML）**：一律使用 `/gh/`（或 `/npm/`）本地前缀（如 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`），**禁止**写死 `https://cdn.jsdelivr.net/...` 完整 URL。模板应用运行于 Mazmot 运行时内，NoneOS Core Service Worker 必定就绪，本地前缀离线可用、跨域安全。
- **页面模块 / 组件模块 / 普通模块**（`<template page>` / `<template component>` / 普通 `.js` 模块）：必须使用 `/gh/` 或 `/npm/` 前缀，由 NoneOS Core Service Worker 拦截（离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net/...` 完整 URL。
- `#debug` 后缀不要去掉，保留调试信息。

## 开发指令

0. **开发前必读（框架）**：先查阅 `ofajs-docs` 技能文档，掌握 ofa.js 组件 / 页面 / 路由 / 状态管理的最新用法后再动手，避免写出不符合框架规范的代码。
1. **开发前必读（项目）**：动手前先阅读 [CONTEXT.md](CONTEXT.md)，可以快速掌握本模板的项目结构、目录用途、关键模块与数据流，避免盲改。
2. 页面模块采用 `<template page>` + `<script>export default async ({ load }) => { ... }</script>` 结构，见 [pages/home.html](pages/home.html)。
3. **涉及 NoneOS Core 能力必读**：需要使用文件系统（`fs`）、用户通信 / 联机、用户管理等 NoneOS Core 相关能力时，必须先查阅 `noneos-core-docs` 技能文档，按官方 API 调用，禁止凭记忆写。
4. **涉及数据存储必读**：需要持久化数据时，必须先查阅 `noneos-core-docs` 技能文档的 storage 章节，使用 `getStorage(<id>)` 划分空间进行存储，禁止裸用 `localStorage`。
5. **较大逻辑改动后必须同步 [CONTEXT.md](CONTEXT.md)**：文件结构、公开 API、数据字段、关键流程、模块职责等发生变化时，立即更新对应章节，不得事后补。
6. **发现不一致立即修正 [CONTEXT.md](CONTEXT.md)**：查阅 CONTEXT.md 后再去读具体逻辑模块，若发现 CONTEXT 中的描述与实际代码不符（旧描述、字段过期、路径错误、流程改动未同步等），**立即修正 CONTEXT 内容**，让上下文文档与代码保持一致。
7. **组件 / 独立模块开发完成后建立测试**：开发完一个组件或相对独立的逻辑模块后，使用 `sibyl-test` 为该模块建立对应的 `.sb.html` 测试文件（推荐放在模块所在目录的 `test/` 子目录，文件名与被测模块同名），编写前先查阅 `sibyl-test` 技能文档。
8. **sibyl-test 执行方式**：写完 `.sb.html` 测试文件后**不要自动执行测试**，先询问开发者是否让 AI 跑自动化测试；开发者同意后，优先使用 `npx sb-test -f <目标测试文件>.sb.html --browsers chrome` 在 Chrome 中快速验证，根据结果动态修复；完整多浏览器测试用 `npm test`。
9. 只做被要求的事，避免过度设计与冗余抽象。

## 技能资源与导入 (Skill Resources)

若本地环境中缺少相关知识库，请通过以下链接获取最新版本：

- **ofa.js-docs**
  - [GitHub 在线源码](https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/ofa.js/refs/heads/main/skills/ofajs-docs.zip)
- **noneos-core-docs**
  - [GitHub 在线源码](https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/kirakiray/noneos-core/refs/heads/main/skills/noneos-core-docs.zip)
- **sibyl-test**
  - 该项目使用 `sibyl-test` 作为测试模块。
  - 使用前请检查本地是否有 sibyl-test Skill，若无则需导入。
  - [Skill 在线文件](https://raw.githubusercontent.com/ofajs/sibyl-test/refs/heads/main/skills/sibyl-test/SKILL.md)
