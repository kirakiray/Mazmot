# AI 开发指南 — Service Chat 模板

本目录是由 Mazmot 的 **service-chat（服务聊天）模板** 创建的应用，演示「服务商 / 客户」双角色的点对点聊天。除通用 ofa.js 规范外，请遵守下面与 NoneOS Core 用户服务、P2P 分享相关的强约束。

## 通用规范

| 层 | 技术 | 备注 |
| --- | --- | --- |
| 应用框架 | ofa.js | `<template page>` + `proto` / `data`；禁止 Vue / React 语法 |
| UI | 原生 HTML + CSS | 使用 `index.html` 中的 `--md-sys-color-*` 主题变量，聊天气泡、输入框等直接用原生标签手写样式实现 |
| 图标 | `<n-icon icon="mdi:xxx">` | 依赖 `<l-m src="/nos/n-icon/n-icon.html"></l-m>` |
| 存储 | ever-cache | `storage.xxx` 而非 `localStorage` |

- 依赖 URL 一律用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug` 等本地前缀，**禁止**改成 `https://cdn.jsdelivr.net/...` 完整 URL。
- 顶层 **禁止** `import "/nos/*"`，`/nos/user/main.js` 等只能在页面模块里通过 `load(...)` 按需加载。

## 用户服务约束（**必须遵守**）

聊天基于 `getUser(NAMESPACE)` 拿到的 NoneOS Core 用户对象。修改 [pages/home.html](pages/home.html) 时注意：

1. **NAMESPACE 必须一致**：模板默认 `"service-chat"`。服务商与客户必须处于同一 namespace 才能互相发现。改 namespace 就要两端同改，否则 `connectUser` 会失败。
2. **SERVICE_ID 必须一致**：模板默认 `"chat"`。`registerService(SERVICE_ID, { onMessage })` 与 `sendToService(SERVICE_ID, ...)` 需成对匹配。
3. **user 对象非响应式**：`this._user = user` 必须用 `_` 前缀，否则会被 ofa.js 代理后丢失原型方法（同理 `_remoteUser` / `_customerRemote` / `_svc`）。
4. **detached 必须反注册**：模板已在 `detached()` 里调用 `this._svc.unregister()`；新增服务时保持同一模式，避免僵尸监听。
5. **isRemoteUserOnline / waitForService**：判断对端在线状态用 `user.isRemoteUserOnline(userId)`；给 `sendToService` 传 `waitForService: 3000` 等待对端服务就绪。

## 分享链接约束（同 share-link）

服务商入口的 `generateChatLink()` 通过 `/apps/main/lib/share-mgr.js` 的 `publishApp` 生成链接，特别之处是把自己的 `userId` 作为 `appParams.host` 传入，客户端根据 `?host=` 判断角色。

同样约束：

- 分享内容 **只支持 UTF-8 文本文件**，禁止塞二进制。
- 发布者（服务商）标签页必须保持打开，客户才能拉到 chunk。
- URL 字段固定 `u` / `h`，其余参数走 `appParams`；不要拼接 `?p=` / `?data=` 等历史格式。
- 签名链不可省，禁止 try/catch 吞错。

## 应用身份识别

`parseSelfIdentity()` 从 `location.pathname` 匹配 `/$<namespace>/<dirName>/client/index.html`。修改虚拟目录结构前请确认这套路由约定，否则拿不到应用目录句柄，`generateChatLink` 会失败。

## 开发指令

0. **开发前必读**：先查阅 `ofajs-docs` 技能文档，掌握 ofa.js 组件 / 页面 / 路由 / 状态管理的最新用法后再动手，避免写出不符合框架规范的代码。
1. 新增消息类型（如图片 / 富文本）时，注意 P2P payload 大小与文本编码限制。
2. UI 状态（`role` / `hostStatus` / `customerStatus` 等）尽量放 `data`，业务对象放 `_` 前缀字段。
3. **每次改动后**都要检查是否需要同步 [CONTEXT.md](CONTEXT.md)（文件结构 / 公开 proto 方法 / 数据字段 / `NAMESPACE` / `SERVICE_ID` / 关键流程有变化就要更新）。
4. 若发现 [CONTEXT.md](CONTEXT.md) 与实际代码不符（旧描述、字段过期、路径错误等），**立即修正 CONTEXT 内容**，让上下文文档与代码保持一致。
5. 只做被要求的事，避免过度设计。
