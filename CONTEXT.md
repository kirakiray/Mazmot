# Mazmot 项目 Context

> 这份 Context 提供项目全局视图，帮助 AI 快速掌握项目结构、技术栈和关键设计。阅读后再针对具体任务查看相关文件即可。

## 项目定位

**Mazmot** 是一个基于浏览器的 **AI 应用启动器 / 迷你操作系统**（README 描述："让你快速的启动 AI 应用。无需配置，无需安装，无需学习"）。用户通过它管理并运行多个独立的 Web 应用，每个应用在**独立源（不同端口）容器**中沙箱运行，与主系统隔离。

## 核心技术栈

| 层级 | 技术 | 用途 |
| ---- | ---- | ---- |
| 底层 | noneos-core | 虚拟文件系统、用户管理、Service Worker、挂载本地目录 |
| 应用框架 | ofa.js | 组件/页面模块、路由、状态管理，无需 Node/Webpack |
| UI | Punch-UI v2 | Material Design 风格组件（`p-list`、`p-dialog`、`p-button`……） |
| 存储 | ever-cache | 基于 IndexedDB 的异步存储（类 localStorage） |
| 图标 | `n-icon` (`/nos/n-icon/n-icon.html`) | 统一使用 `<n-icon icon="mdi:xxx">`，禁止 `iconify-icon` |

**约束**：所有代码必须符合 ofa.js 语法（用 `<o-if>`、`<o-fill>`、`on:click`、`proto`/`data`、`sync:`、`attr:`、`:style.` 等），禁止 Vue/React 语法。详见 `AGENTS.md`。

## 目录结构

```
Mazmot/
├── index.html                # 主系统入口（30031 端口）
├── _install.html             # 首次访问时安装 NoneOS Core
├── app-config.js             # ofa.js 主应用配置（init "mazmot" 命名空间）
├── sw.js                     # NoneOS Core Service Worker
├── AGENTS.md                 # AI 开发规范（必读）
├── CONTEXT.md                # 项目架构上下文（本文档）
├── package.json              # 只提供 static 脚本：node scripts/static.js
│
├── container/                # 独立容器目录（40031-40035 端口分别托管此目录）
│   ├── _install.html         # 容器安装/运行页（NoneOS 安装 + postMessage 接收）
│   ├── _info.html            # 容器用户信息查看页（default 用户资料）
│   └── sw.js                 # 容器专用 SW（importScripts NoneOS Core）
│
├── pages/
│   ├── home.html             # 应用列表主页（页面模块）
│   └── home/
│       ├── add-app.html      # 添加应用 3 步向导（子页面，弹窗内加载）
│       ├── template-writer.js# Hello World 模板：app.json / index.html / app-config.js / pages/home.html
│       ├── app-status.js     # 应用打开状态追踪（BroadcastChannel + LS + window 引用）
│       └── container-mgr.js  # 容器 URL 分配、文件读取、postMessage 通信
│
├── scripts/
│   ├── static.js             # 启动 6 个 http-server：Main(30031) + 5 个容器(40031-40035)
│   └── ...                   # generate-capabilities / update-skill / update-files-json
│
├── comps/                    # 通用组件（现在暂时没有）
├── ai/                       # AI 相关：deepseek、kimi、assistant
└── old/                      # v1/v2/v3 历史版本（不参与新逻辑）
```

## 关键架构：应用容器隔离

### 为什么需要容器？

主系统运行在 `localhost:30031`，如果应用也在同源下运行，恶意应用可访问主系统的 IndexedDB、Service Worker 和用户数据。

### 隔离方案

`scripts/static.js` 启动 **6 个 http-server**：

- `Main` (30031) → 根目录 `./`（主系统）
- `Container-1~5` (40031-40035) → `./container` 目录

**每个容器端口 = 一个独立 Origin = 独立的 NoneOS Core / IndexedDB / SW**，应用运行在容器中无法访问主系统。**一个应用固定占用一个容器端口**（互斥），最多同时存在 5 个应用；删除应用才能释放端口。

### 应用生命周期

#### 1. 添加应用（`pages/home/add-app.html`）

```
选择应用来源 → 输入应用名 → 校验唯一性
   ├─ 本地目录：open() 选择目录，得到原生 FileSystemDirectoryHandle
   └─ 虚拟目录：直接进入下一步，确认名称后 (await init("mazmot-apps")).get(name, {create:"dir"}) 建立应用子目录
   ↓
分配可用容器 URL (findTrulyAvailableUrl，自动跳过被占用的物理容器，5 个全占则报错)
   ↓
存入 ever-cache 的 apps[]（本地：直接存储原生 handle；虚拟：存 namespace=mazmot-apps，handle=null）
   ↓
writeTemplateFiles 写入 4 个模板文件到目标目录（本地/虚拟）的 client/ 子目录下
   ↓
pushFilesToContainer(containerUrl, files, appName) 通过隐藏 iframe + postMessage 推送到容器
```

#### 2. 启动应用（`pages/home.html`）

```
handleOpen / handleOpenWindow / handleOpenTab
   ↓
loadApps 通过 new DirHandle(app.handle) 重新初始化存储的原生句柄为 noneos handle
   ↓
readAppFiles(handle) 读取本地最新文件（优先读取 client/ 子目录，用 handle.flat() + text()，
                    并剥掉 targetHandle.path 前缀，得到相对 client 的相对路径）
   ↓
pushFilesToContainer(app.containerUrl, files, appName) 推送到容器（校验占用情况）
   ↓
window.open(getRunUrl(app.containerUrl))
   → 容器 _install.html?mode=run 加载
   → mount(rootDir) 挂载虚拟目录（rootDir 即 main-app 命名空间）
   → location.replace(`/${mounted.path}/index.html`)
```

#### 3. 删除应用

```
clearOpened → 关闭窗口
clearContainer(app.containerUrl) → 清空容器虚拟文件系统（释放容器）
从 ever-cache.apps 移除记录
```

### 容器页 `_install.html` 三种模式

同一个页面根据 URL 参数区分模式：

- **默认（安装/待命）**：显示遮罩安装 NoneOS Core → 初始化 `main-app` 命名空间 → 向父页面 `postMessage({type:"ready"})`，然后监听 install/clear/ping 消息
- **`?mode=run`**：初始化完成后自动 `mount` + 跳转到 `/{mountedPath}/index.html`
- **`?sw_retry=1`**：Service Worker 刚注册未接管页面时，自动跳一次此参数强制刷新

### postMessage 协议（父页面 ↔ 容器）

| 方向 | type | 说明 |
| ---- | ---- | ---- |
| 容器 → 父 | `ready` | 容器 NoneOS 初始化完成，带上 `{ occupier: {name, parentOrigin, time} }` |
| 父 → 容器 | `install` | `{ files: [{path, content}], appName }` 批量写入并锁定应用名 |
| 容器 → 父 | `install-done` | 写入完成 |
| 父 → 容器 | `clear` | 清空容器虚拟文件 |
| 容器 → 父 | `clear-done` | 清空完成 |
| 父 → 容器 | `ping` | 健康检查 |
| 容器 → 父 | `pong` | 响应 |
| 容器 → 父 | `error` | `{ message }` 错误 |

## 数据模型

### ever-cache `apps` 数组结构

```javascript
{
  name: "my-app",           // 唯一名称（校验：字母/数字/_-，不能空格）
  desc: "描述",
  handle: FileSystemDirectoryHandle | null, // 本地目录存原生句柄；虚拟目录为 null
  dirName: "选择的目录名 / 虚拟命名空间",
  source: "local" | "virtual",
  namespace: "mazmot-apps",  // 仅 virtual 有值，(await init(namespace)).get(name) 即可重建 handle
  containerUrl: "http://localhost:40031",  // 分配的容器地址
  createdAt: timestamp
}
```

### 应用模板文件（`template-writer.js`）

生成 4 个文件，存放在本地目录的 `client/` 子目录下：

- `app.json` — 应用元数据（name / displayName / version / icon / entry / permissions / capabilities）
- `index.html` — 入口 HTML，加载 ofa.js + router + Punch-UI + `./app-config.js`
- `app-config.js` — 定义 `home` 页面路径和过渡动画
- `pages/home.html` — Hello World 页面模块

> ⚠️ 已删除 `/common` 目录（跨域后不可用）。

## UI 关键组件（`pages/home.html`）

### 主界面

- `<p-dialog>` 承载 `<o-page src="./home/add-app.html">` 弹窗
- `<p-list>` + `<o-fill :value="appList">` 渲染应用列表
- 每个 `<p-list-item>` 是 **可折叠**（`collapsible`）：
  - **主行 suffix**：`已打开` 徽章 + `新标签打开`(mdi:tab-plus) + `小窗口打开`(mdi:open-in-new) 两个 icon 按钮
  - **主行点击**：`on:click-main="handleOpen"` 触发打开（区分展开箭头点击）
  - **折叠子列表**：显示应用来源徽章、容器地址徽章、挂载路径、删除按钮

### 状态追踪（`app-status.js`）

用 `BroadcastChannel("mazmot-app-status")` + localStorage `mazmot-opened-apps` 双重追踪应用窗口。**注意**：跨域后 BroadcastChannel 无法工作，主要依靠 `openedWindows` Map 中的 window 引用（`win.closed`）判断。使用 `appName` 作为唯一标识符。

## 开发/调试

### 启动服务

```bash
npm run static
```

启动后：
- 主系统：http://localhost:30031/
- 容器 1~5：http://localhost:40031/ ~ http://localhost:40035/
- 容器信息页（查看 default 用户）：http://localhost:40031/_info.html

### 首次访问

1. 访问 30031 → `fetch("/__config")` 失败 → 跳 `_install.html` → 安装 NoneOS Core
2. 主系统 `app-config.js` 用 `init("mazmot")` 初始化文件系统
3. `pages/home.html` 加载显示应用列表（初始为空）

### 添加第一个应用

1. 点击"添加应用" → 选择本地目录（Chrome 才支持）
2. 输入名称 → 系统分配容器 URL → 写入 4 个模板文件到本地目录 → 推送到容器
3. 应用列表出现新项，容器地址徽章显示 `http://localhost:40031`
4. 点击应用行或 `tab-plus` / `open-in-new` / `handleOpenWindow` 按钮启动

## 关键陷阱

1. **只有 5 个容器**，占满会导致新应用无法安装 —— 必须提示用户先删除
2. **应用改动本地文件后**，重新点击"打开"会自动重新推送最新文件到容器
3. **文件推送首次可能超时**（60s）：容器要首次安装 NoneOS Core
4. **改造前**创建的应用没有 `containerUrl`，无法打开，需删除后重新创建
5. **图标只用 `n-icon`**（`<l-m src="/nos/n-icon/n-icon.html"></l-m>` 引入）—— 项目已从 `iconify-icon` 全部迁移
6. **添加 UI 前必读 SKILL 文档**：`ofajs-docs`、`punch-ui`、`noneos-core-docs`、`ever-cache`
7. **容器占用自动避让**：`findTrulyAvailableUrl` 会实时探测物理容器。如果容器已被其他域名（Origin）的应用占用，系统会自动跳过并尝试下一个可用容器。
8. **`CONTAINER_URLS` 是唯一事实源**：`container-mgr.js` 导出的容器列表统一为 URL 字符串（如 `http://localhost:40031`），不再暴露 `port` / `getContainerUrl` / `extractPort`。上层拿到 `app.containerUrl` 直接传给 `pushFilesToContainer` / `clearContainer` / `checkContainerOccupancy` 即可。

## Skill 资源

若本地缺失请从以下获取（AGENTS.md 列出）：

- ofa.js-docs: https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs
- punch-ui-docs: https://github.com/ofajs/Punch-UI/tree/v2/skills/punch-ui
- noneos-core-docs: https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs
- ever-cache: https://github.com/kirakiray/ever-cache/blob/main/skills/ever-cache/SKILL.md

## 未来扩展方向（预留但未实现）

- **应用市场**：`浏览市场` 按钮 disabled
- **外源下载**：从 URL/ZIP 安装应用，disabled
- **在线联机**：NoneOS Core 提供 `getUser` / `registerService` / `AppManager` 能力尚未接入
- **容器间通信**：目前容器完全隔离，未来可通过 NoneOS 的 user 通信机制打通

## 关键代码文件速查

| 需求 | 打开文件 |
| ---- | -------- |
| 修改应用列表 UI | `pages/home.html` |
| 修改添加应用流程 | `pages/home/add-app.html` |
| 容器分配/通信 | `pages/home/container-mgr.js` |
| 应用模板内容 | `pages/home/template-writer.js` |
| 应用打开状态 | `pages/home/app-status.js` |
| 容器安装/运行页 | `container/_install.html` |
| 容器用户信息页 | `container/_info.html` |
| 静态服务器配置 | `scripts/static.js` |
| ofa.js 主配置 | `app-config.js` |
| 主 SW | `sw.js` |
| 容器 SW | `container/sw.js` |