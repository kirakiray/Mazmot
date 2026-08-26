# AI 代理开发指南 (AGENTS.md)

本文件为参与「凭证管理器（cred-manager）」应用开发的 AI 代理提供上下文入口和开发规范，本目录可独立成项目，**规则自包含，不依赖任何上级文件**。在开始任何开发任务前，请务必遵循以下准则。

## 项目上下文入口

- [`CONTEXT.md`](CONTEXT.md) —— 本应用的架构说明（页面结构、凭证数据模型、依赖的平台 API），**首次接手或未读过本目录代码时必须先读**。
- [`__app.json`](__app.json) —— 应用元数据与文件清单（应用市场分发依据）。

## CONTEXT.md 同步维护规则

`CONTEXT.md` 是项目知识的**活文档（living document）**，必须与代码保持一致。

一句话总结：**代码怎么变，`CONTEXT.md` 就怎么改，始终保持一致。** 具体规则如下：

- **凡是修改了本目录下的文件**（新增/删除/重命名文件、调整数据结构、变更平台 API 依赖、修改交互流程、重构结构等），**都必须同步更新 [`CONTEXT.md`](CONTEXT.md)**。
- **发现错误即纠正**：阅读源码后若发现 `CONTEXT.md` 与实际代码不符（字段名、API 名、流程描述过时等），即便不是本次任务引入的，也**有责任顺手修正**。
- **删除模块要同步清理**：删除文件或功能后，必须把 `CONTEXT.md` 中对应的目录树、文件说明、数据模型条目一并移除，不留死描述。
- **路径写法统一用相对路径**：文档内引用项目文件一律用相对路径（如 `pages/home.html`、`AGENTS.md`），**禁止 `file://` 协议、绝对路径和指向本目录之外的 `../` 上级引用**。宿主资源（`/mz/*`、`/nos/*`、`/ncomp/*`）用站内绝对路径描述即可。
- 仅改动注释、格式等不影响语义的修改，可酌情不更新。

## `__app.json` 文件清单同步规则

本应用通过 [`__app.json`](__app.json) 的 `files` 清单对外分发，**清单与实际文件必须一一对应**：

- **新增文件**（新页面、新组件、新资源）→ 必须登记到 `files` 数组，否则分发后应用缺文件。
- **删除 / 重命名文件** → 必须同步从 `files` 移除或更新 `path`。
- `app.json` 条目中的 `replacements`（如 `CREATED_AT` 时间戳替换）只服务于分发时动态替换，**不要在业务代码里依赖被替换后的值**。

## 技术栈与数据约定

- **框架**：ofa.js 页面模块（`<template page>`）+ 组件模块（`<template component>`）。**修改任何 `.html` 页面/组件模块前，必须先调用 `Skill` 工具加载 `ofajs-docs`**，确认模板语法后再动手，禁止凭记忆写模板。
- **依赖 URL（自包含规范）**：
  - **ofa.js**：所有文件（含入口 HTML）一律用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`（本地前缀，由 NoneOS Core Service Worker 拦截），必须带 `#debug`，禁止写死 jsdelivr 完整 URL（完整 URL 仅限仓库根 `index.html` 与 `apps/run-app/` 两个 Core 引导入口）。
  - **ofa.js router**：`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`（无版本号）。
  - **Senti-UI**：组件统一从 `/gh/ofajs/senti-ui@latest/packages/<component>/<component>.html` 加载（本地前缀，始终用 `@latest`，不锁版本）；命令式工具用 `/gh/ofajs/senti-ui@latest/packages/snackbar/toast.js` 与 `/gh/ofajs/senti-ui@latest/packages/dialog/confirm.js`（**default 导出**，页面模块内可顶层 `import`，组件模块内需 `load()` 取值要写 `const { default: confirm } = await load(...)`）。禁止引入其他来源的组件资源。
- **数据存储（重要差异）**：本应用**不直接使用 `/nos/storage`**，所有数据都存在 NoneOS 用户凭证库（`user.cred`）与系统级 API 中：
  - 证书 / 用户资料缓存 → `ensureUser()`（`/mz/share-mgr.js`）得到的 `user.cred`（`values` / `query` / `import` / `delete` / `deleteProfile`）。
  - 证书签发 / 领取 / 吊销 / 历史 / 链式引用 → `/mz/cert/main.js`。
  - 组织（离线身份、owner/staff 证书）→ `/mz/org/main.js`。
  - **修改业务逻辑前先读 [`CONTEXT.md`](CONTEXT.md) 的「依赖的平台 API」章节**，确认函数签名与语义。
- **页面模块 / 组件内加载 `/nos/*`**：顶层**禁止** `import "/nos/*"`（入口 HTML 与页面模块的顶层静态 `import /mz/*`、`/nos/locale-text/get-locale-text.js` 是现行约定，保持一致即可；其余 `/nos/*` 一律 `const load = lm(import.meta); await load(...)` 按需加载，参考 `pages/cert-detail.html` 对 `/nos/user/main.js` 的用法）。
- **图标**：统一 `<n-icon icon="mdi:xxx">`，页面需声明 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`，禁止直接依赖 `iconify-icon`。
- **i18n**：界面文案统一走 `<locale-text>`（`/nos/locale-text/locale-text.html`）+ `getLocaleText`（`/nos/locale-text/get-locale-text.js`），提供 `cn` / `en` 双语。
- **视觉**：UI 组件**不强制**全部使用 senti-ui 组件，可按需自写；但颜色体系**必须**遵循 senti-ui 的 M3 设计语言（CSS 变量 `--md-sys-color-*`，文字/背景用配对 token）。注意组件 API 约定：senti 组件**没有** `size` 预设与 `tonal` variant（用 `style="font-size: 12px"` 等比缩放、tonal 用 container 配对色）；`st-switch` / `st-checkbox` 是 `checked` 布尔属性。

## 凭证业务关键约束

- **证书不推送，只拉取**：core 已移除 `shareCert` 推送，签发后证书保存在签发者本地凭证库，由对方在「领取证书」页按精确 key（role + issuer + subject）在线拉取；领取 / 签发相关的 UI 与提示语都以此模型为前提。
- **保留字段**：证书自定义字段不得占用保留名 `id` / `role` / `issuer` / `subject` / `signTime` / `expire` / `signature` / `publicKey`（签发表单已做校验，勿删）。
- **链式引用**：字段值形如 `[chain_key:<id>]`，解析 / 生成统一走 `/mz/cert/main.js` 的 `buildRef` / `parseRef` / `shortenRef` / `normalizeChainKey` / `collectChainFields`，**禁止**在页面里手写字符串拼接或解析。
- **组织是离线身份**：组织用户不联机，其证书由创建者（owner）托管转发；员工领取时用的是**创建者的用户 ID**，不是组织 ID。`cert-detail` 支持 `?ns=org:<name>` 组织命名空间查询，改路由参数时保持该约定。
- **签名链不可省**：用户卡片展示前必须 `verifyProfileCard` 验签，验签失败要明确提示「不要信任该卡片」，**不要**用 try/catch 吞掉验签失败。

## 自动化测试规则

本项目使用 **sibyl-test**（`.sb.html`）编写客户端测试，测试文件放在本目录 `test/` 下（如 `test/my-certs.sb.html` 对应 `pages/my-certs.html`）。

- **功能怎么变，测试就怎么改**：新增 / 删除 / 重构功能时，同步补 / 删 / 改对应测试，不留死测试。
- **最小覆盖要求**：每个功能至少覆盖：
  - **正常路径**：操作成功且数据正确落库（`user.cred` 读写断言）。
  - **取消/中断路径**：取消签发 / 取消删除时不产生副作用。
  - **异常路径**：非法输入（空 role、保留字段名、非法 JSON 导入）给出正确提示。
- **写测试前必须先调用 `Skill` 工具加载 `sibyl-test` 知识库**。
- **执行前确认**：写完测试后不要擅自执行，先询问开发者是否运行自动化测试并根据反馈修复。

## 踩坑知识沉淀规则

开发中遇到框架陷阱、反复调试才解决的问题时，**任务结束后主动询问用户是否沉淀**。

一句话总结：**遇到坑，问一句要不要记录。**

- 框架/库相关的坑 → 沉淀到对应 Skill（ofa.js 的坑进 `ofajs-docs`，NoneOS 的坑进 `noneos-core-docs`）。
- 项目特定的坑 → 补充到本目录 `CONTEXT.md` 或本文件。
- 已被现有文档覆盖的知识，不重复添加。
