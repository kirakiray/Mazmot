# 云盘服务器 Context

> 云盘服务器，由 base 模板创建。入口 HTML → app-config → 首页模块。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── app.json          # 应用元数据：name / version / icon / entry / appConfig / permissions
├── index.html        # 入口 HTML：加载 ofa.js + 定义 Material 主题变量 + <o-router>/<o-app>
├── app-config.js     # ofa.js 应用配置：导出 home 路由与页面切换动画 pageAnime
└── pages/
    └── home.html     # 首页模块（<template page>）：展示 appName / appDesc
```

## 关键约定

- **入口链路**：`index.html` → `<o-app src="./app-config.js">` → `app-config.js` 中 `export const home = "./pages/home.html"` → 加载首页模块。
- **主题**：`index.html` 里以 CSS 变量定义 Material Design 3 亮 / 暗色调色板（`--md-sys-color-*`），页面样式统一引用这些变量，方便整套换肤。
- **元数据同步**：修改 [app.json](app.json) 的 `name` / `description` / `icon` 后，如果这些字段也出现在页面文案里，请顺带更新对应模板/页面。

## 扩展指引

- **新增页面**：
  1. 在 [pages/](pages/) 下新建 `<name>.html`，遵循 `<template page>` 结构。
  2. 在 [app-config.js](app-config.js) 导出 `export const <name> = "./pages/<name>.html"`。
  3. 通过 `<a href="//<name>">` 或 `this.app.goto("//<name>")` 跳转。
- **接入 NoneOS Core**：
  - 顶层禁止 `import "/nos/*"`。
  - 在页面模块中：`const load = lm(import.meta); const { init } = await load("/nos/fs/main.js");`
- **持久化数据**：使用 `/nos/storage/main.js`（`getStorage(<id>)` 划分空间），避免直接使用 `localStorage`。
