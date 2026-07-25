# AI 开发指南 — Share Link 模板

本目录是由 Mazmot 的 **share-link（分享链接）模板** 创建的应用。除了通用的 ofa.js 规范外，请重点遵守下面与「点对点分享」相关的强约束。

## 通用规范

参见基础模板的开发规范：

| 层 | 技术 | 备注 |
| --- | --- | --- |
| 应用框架 | ofa.js | `<template page>` + `proto` / `data`；禁止 Vue / React 语法 |
| UI | 原生 HTML + CSS | 使用 `index.html` 中的 `--md-sys-color-*` 主题变量；**本模板不依赖 Punch-UI**，输入框 / 按钮 / 卡片等直接用原生标签手写样式实现 |
| 图标 | `<n-icon icon="mdi:xxx">` | 依赖 `<l-m src="/nos/n-icon/n-icon.html"></l-m>` |
| 存储 | ever-cache | `storage.xxx` 而非 `localStorage` |

依赖 URL 一律用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug` 等本地前缀，入口 HTML 里的 ofa.js/router 也不例外，禁止改为 `https://cdn.jsdelivr.net/...` 完整 URL。

## P2P 分享关键约束（**必须遵守**）

分享逻辑基于 NoneOS Core `DataPublisher`，本模板通过主应用暴露的 `/apps/main/lib/share-mgr.js` 生成链接。改动 [pages/home.html](pages/home.html) 里的 `generateLink()` 或类似流程时：

1. **只支持 UTF-8 文本文件**：`publishApp` 会把应用文件按文本读取后塞进 JSON，二进制资源（图片 / 字体 / 音视频）目前不可分享。**禁止**绕过这个限制自行 base64 塞 payload。
2. **发布者必须在线**：接收端通过 `?u=<userId>&h=<payloadHash>` 从发布者 IndexedDB 拉取 chunk。发布者标签页关闭 = 未完成的分享失败。UI 上做提醒时以此为准。
3. **URL 字段固定**：分享链接只有 `u` 与 `h` 两个 query 参数，其他历史格式（`?p=`、`?data=`）已废弃。若需要给对端传参，使用 `publishApp(app, { appId, appParams: { ... } })` 的 `appParams`，run-app 会把它们展开成 URL 上的普通 query。
4. **签名链不可省**：接收端顺序 `connectUser → requestManifest → requestChunk → isPublicKeyOfUser`，任何一步失败即进错误页；**禁止** try/catch 吞错。

## 应用身份识别

页面模块在运行态位于 `/<namespace>/<dirName>/client/index.html` 虚拟目录下（`parseSelfIdentity()` 里通过正则从 `location.pathname` 提取）。修改路径匹配前先确认这套路由约定，否则会拿不到应用目录句柄。

## 开发指令

1. 需要 `/nos/*` 模块时用 `load(...)` 按需加载，**顶层禁止** `import "/nos/*"`。
2. `ever-cache` / `share-mgr.js` 通过 `load(url)` 加载，见 [pages/home.html](pages/home.html) 里的 `Promise.all([...])` 用法。
3. 修改公开 API、数据字段、`app.json` 元数据后，同步更新 [CONTEXT.md](CONTEXT.md)。
4. 只做被要求的事，避免为「未来需求」过度抽象。
