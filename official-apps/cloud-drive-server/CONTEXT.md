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

## 踩坑指南

开发 / 调试中遇到的坑（按 AGENTS.md 规则持续录入，格式：现象 → 原因 → 正确写法）：

### 1. 页面注册保留名冲突 → 整页白屏
- **现象**：console 报「注册参数有误，'proto'上的'refresh'已被占用」，页面模块不注册、白屏且无其他报错。
- **原因**：`refresh` 是 ofa.js 页面实例保留方法（另有 `back` / `goto` / `replace` / `src` 等；data 上的 `entries` 同样被占用）。
- **正确写法**：业务命名避开保留名（本页用 `refreshAll`）。遇到「xxx 已被占用」先对照保留名清单改名。

### 2. 页面模块内动态 `import("/gh/…")` 报 Failed to resolve module specifier
- **现象**：`alert` / `confirm` / `toast` 在事件回调里 `await import("/gh/ofajs/senti-ui@latest/…")` 抛 `TypeError: Failed to resolve module specifier`。
- **原因**：ofa.js 把页面 `<script>` 编译成 **data: URL 模块**执行，data: 模块没有 base，无法解析 `/` 开头的根路径。
- **正确写法**：模块初始化期统一 `await load("/gh/…")` 预载到闭包（本页预载 confirm / alert / toast 与 `/nos/fs/main.js` 的 `open`）。

### 3. `st-menu-item` 图标必须放 `prefix` 插槽
- **现象**：split button 下拉菜单项里 `<n-icon>` 和文字上下排布。
- **原因**：默认插槽是纯文字区，图标混进去后垂直堆叠。
- **正确写法**：`<n-icon slot="prefix" icon="…"></n-icon>` + 默认插槽放文字，无需手写布局样式。

### 4. 挂载本地文件夹仅 Chromium 系浏览器支持
- **现象**：Firefox / Safari 点「挂载本地文件夹」无目录选择器或直接报错。
- **原因**：依赖 File System Access API（`window.showDirectoryPicker` / `/nos/fs` 的 `open()`），仅 Chrome / Edge 等 Chromium 内核实现。
- **正确写法**：调用前检测 `window.showDirectoryPicker`，缺失时用 `alert` 引导换浏览器（见 `mountLocalFolder()`）。虚拟空间的创建不受影响。

### 5. 挂载句柄的持久化与失效重挂
- 本地空间（`kind: "local"`）的挂载句柄存 `getStorage("cloud-drive-server")` 的 `mount:<spaceId>` 键（nos/fs 句柄可直接入库，读回仍是可用句柄）；页面刷新后系统挂载可能失效，`_getMount()` 会探测并重新 `mount()`。删除本地空间只解除登记，**不删除用户磁盘文件**（删除确认文案已区分）。
