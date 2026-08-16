# AI 代理开发指南 (AGENTS.md)

本文件为参与「网页收藏夹（speed-dial）」应用开发的 AI 代理提供上下文入口和开发规范，本目录可独立成项目，**规则自包含，不依赖任何上级文件**。在开始任何开发任务前，请务必遵循以下准则。

## 项目上下文入口

- [`CONTEXT.md`](CONTEXT.md) —— 本应用的架构说明（页面结构、数据模型、存储约定），**首次接手或未读过本目录代码时必须先读**。
- [`__app.json`](__app.json) —— 应用元数据与文件清单（应用市场分发依据）。

## CONTEXT.md 同步维护规则

`CONTEXT.md` 是项目知识的**活文档（living document）**，必须与代码保持一致。

一句话总结：**代码怎么变，`CONTEXT.md` 就怎么改，始终保持一致。** 具体规则如下：

- **凡是修改了本目录下的文件**（新增/删除/重命名文件、调整数据结构、变更存储键、修改交互流程、重构结构等），**都必须同步更新 [`CONTEXT.md`](CONTEXT.md)**。
- **发现错误即纠正**：阅读源码后若发现 `CONTEXT.md` 与实际代码不符（字段名、存储键、流程描述过时等），即便不是本次任务引入的，也**有责任顺手修正**。
- **删除模块要同步清理**：删除文件或功能后，必须把 `CONTEXT.md` 中对应的目录树、文件说明、数据模型条目一并移除，不留死描述。
- **路径写法统一用相对路径**：文档内引用项目文件一律用相对路径（如 `pages/home.html`、`AGENTS.md`），**禁止 `file://` 协议、绝对路径和指向本目录之外的 `../` 上级引用**。
- 仅改动注释、格式等不影响语义的修改，可酌情不更新。

## `__app.json` 文件清单同步规则

本应用通过 [`__app.json`](__app.json) 的 `files` 清单对外分发，**清单与实际文件必须一一对应**：

- **新增文件**（新页面、新 lib、新资源）→ 必须登记到 `files` 数组，否则分发后应用缺文件。
- **删除 / 重命名文件** → 必须同步从 `files` 移除或更新 `path`。
- `app.json` 条目中的 `replacements`（如 `CREATED_AT` 时间戳替换）只服务于分发时动态替换，**不要在业务代码里依赖被替换后的值**。

## 技术栈与数据约定

- **框架**：ofa.js 页面模块（`<template page>`）。**修改任何 `.html` 页面/组件模块前，必须先调用 `Skill` 工具加载 `ofajs-docs`**，确认模板语法后再动手，禁止凭记忆写模板。
- **依赖 URL（自包含规范）**：
  - **ofa.js**：入口 HTML 用 `https://cdn.jsdelivr.net/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`；页面 / 组件模块一律用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`（本地前缀，由 NoneOS Core Service Worker 拦截），必须带 `#debug`，禁止写死 jsdelivr 完整 URL。
  - **ofa.js router**：`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`（无版本号）。
  - **Punch-UI**：组件不强制使用，但**用到时**必须从 `https://punch-ui-v2.pages.dev/packages/<component>/<component>.html` 加载，CSS 用 `https://punch-ui-v2.pages.dev/packages/css/pui-global.css`，禁止引入其他来源的 punch-ui 资源。
- **存储**：数据统一存 `/nos/storage/main.js` 的 `getStorage("speed-dial")` 独立空间；**禁止** `localStorage`、禁止塞进默认空间。页面模块内必须 `const load = lm(import.meta); await load("/nos/storage/main.js")` 按需加载，**禁止顶层 `import "/nos/*"`**。
- **图标**：统一 `<n-icon icon="mdi:xxx">`，页面需声明 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`，禁止直接依赖 `iconify-icon`。
- **视觉**：UI 组件**不强制**使用 punch-ui 组件，可按需自写；但颜色体系**必须**遵循 punch-ui 设计语言（CSS 变量 `--md-sys-color-*`）。`prompt` / `alert` / `confirm` 这类 JS 层直接调用的对话框，**尽量**使用 punch-ui 提供的对应 API（如 `util.js` 的 `toast` / `confirm`），保持视觉统一。

## 自动化测试规则

本项目使用 **sibyl-test**（`.sb.html`）编写客户端测试，测试文件放在本目录 `test/` 下（如 `test/home.sb.html` 对应 `pages/home.html`）。

- **功能怎么变，测试就怎么改**：新增 / 删除 / 重构功能时，同步补 / 删 / 改对应测试，不留死测试。
- **最小覆盖要求**：每个功能至少覆盖：
  - **正常路径**：操作成功且数据正确落库（storage 读写断言）。
  - **取消/中断路径**：取消编辑 / 取消删除时不产生副作用。
  - **异常路径**：非法输入（空 URL、空名称）给出正确提示。
- **写测试前必须先调用 `Skill` 工具加载 `sibyl-test` 知识库**。
- **执行前确认**：写完测试后不要擅自执行，先询问开发者是否运行自动化测试并根据反馈修复。

## 踩坑知识沉淀规则

开发中遇到框架陷阱、反复调试才解决的问题时，**任务结束后主动询问用户是否沉淀**。

一句话总结：**遇到坑，问一句要不要记录。**

- 框架/库相关的坑 → 沉淀到对应 Skill（ofa.js 的坑进 `ofajs-docs`，NoneOS 的坑进 `noneos-core-docs`）。
- 项目特定的坑 → 补充到本目录 `CONTEXT.md` 或本文件。
- 已被现有文档覆盖的知识，不重复添加。
