# AI 开发指南 — Base 模板

本目录是由 Mazmot 的 **base（基础）模板** 创建的 ofa.js 应用。请按以下规则修改代码，避免引入与 Mazmot 主系统冲突的写法。

## 技术栈

| 层 | 技术 | 备注 |
| --- | --- | --- |
| 应用框架 | **ofa.js** | 使用 `<template page>`、`<o-if>`、`<o-fill>`、`on:click`、`sync:value`、`proto`/`data` 等语法，**禁止 Vue / React 语法** |
| UI | 原生 HTML + CSS | 手写样式，使用 `index.html` 中定义的 Material 主题变量 `--md-sys-color-*`；**本模板不依赖 Punch-UI**，需要按钮 / 列表等直接用原生标签实现 |
| 图标 | `<n-icon icon="mdi:xxx">` | 依赖 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`，**禁止**直接使用 `iconify-icon` |
| 存储 | ever-cache | 需要持久化时用 `storage.xxx`，勿裸用 `localStorage` |

## 依赖 URL 规范（重要）

- **入口 HTML**（[index.html](index.html)）加载 ofa.js 用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`，由 NoneOS Core Service Worker 拦截解析，**禁止**改成 `https://cdn.jsdelivr.net/...` 完整 URL。
- **页面 / 组件模块**同样只用 `/gh/` 或 `/npm/` 前缀。
- `#debug` 后缀不要去掉，保留调试信息。

## 开发指令

0. **开发前必读**：先查阅 `ofajs-docs` 技能文档，掌握 ofa.js 组件 / 页面 / 路由 / 状态管理的最新用法后再动手，避免写出不符合框架规范的代码。
1. 页面模块采用 `<template page>` + `<script>export default async ({ load }) => { ... }</script>` 结构，见 [pages/home.html](pages/home.html)。
2. **异步依赖加载**：需要 NoneOS Core 模块（`/nos/*`）时，只能通过 `const load = lm(import.meta); await load("/nos/xxx/main.js")` 或页面 `export default` 参数里的 `load` 按需加载；**顶层禁止 `import "/nos/*"`**，否则 Core 未就绪会白屏。
3. 新增路由/子页面时在 [app-config.js](app-config.js) 中导出（如 `export const about = "./pages/about.html"`）。
4. **每次改动后**都要检查是否需要同步 [CONTEXT.md](CONTEXT.md)（文件结构 / 公开 API / 数据字段 / 关键流程有变化就要更新）。
5. 若发现 [CONTEXT.md](CONTEXT.md) 与实际代码不符（旧描述、字段过期、路径错误等），**立即修正 CONTEXT 内容**，让上下文文档与代码保持一致。
6. 只做被要求的事，避免过度设计与冗余抽象。

## 常见坑

- ofa.js 页面 `data` 中的非响应式对象请以 `_` 前缀存放（例：`this._user = ...`），否则会被代理后失去原型方法。
- CSS 引用图标节点用 `n-icon` 选择器，不要直接选 `iconify-icon`。
- 若要接入分享 / 联机能力，参考 Mazmot 主仓库的 `share-link` 或 `service-chat` 模板。
