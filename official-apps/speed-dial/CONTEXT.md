# 网页收藏夹（speed-dial）上下文说明

Speed Dial 风格的网页收藏夹应用：分组筛选、拖拽排序，数据全部保存在本地（NoneOS storage），无需联网。本文件是本应用的**活文档**，与代码保持一致；修改代码必须同步更新本文件（规则见 [AGENTS.md](AGENTS.md)）。

> 注意：`app.json` / `__app.json` 的 description 中提到"搜索"，但当前代码**未实现搜索功能**，仅分组筛选。

## 目录结构

```
speed-dial/
├── index.html          # 入口 HTML：加载 ofa.js + router + pui-global.css，挂载 o-app
├── app-config.js       # 应用配置：home 页面路径 + 页面切换动画参数
├── app.json            # 应用 manifest（name/version/entry/appConfig 等）
├── __app.json          # 应用市场分发元数据（name/icon/desc + files 文件清单）
├── AGENTS.md           # AI 代理开发规范（规则自包含）
├── CONTEXT.md          # 本文件
└── pages/
    ├── home.html       # 主页面：收藏卡片网格 + 分组筛选 + 删除/拖拽排序 + 持久化
    └── dial-form.html  # 添加/编辑弹窗页面模块（内嵌于 home 的 o-page，保存经 dial-save 事件上抛）
```

## 技术栈

- **ofa.js** 页面模块（`<template page>`），单页应用，无路由跳转
- **punch-ui** 组件：`p-input` / `p-button` / `p-dialog`（l-m 从 `https://punch-ui-v2.pages.dev/packages/...` 加载）+ `util.js` 的 `toast` / `confirm`
- **`n-icon`**（`/nos/n-icon/n-icon.html`）提供图标，底层 iconify
- **NoneOS storage**（`/nos/storage/main.js`）持久化，独立空间 `getStorage("speed-dial")`

## 数据模型

存储空间：`speed-dial`；唯一键：`dials`，值为 Dial 对象数组（按下标即展示顺序）：

```js
{
  id: string,        // `${Date.now()}-${随机串}`，创建时生成
  url: string,       // 已规范化的完整 URL（无协议时自动补 https://）
  title: string,     // 留空则自动取 hostname
  group: string,     // 分组名，空输入落库为 "未分组"
  color: string,     // 图标底色，取自 PALETTE 八色
  createdAt: number, // 创建时间戳
}
```

- **PALETTE**：`pages/dial-form.html` 顶部常量，8 个品牌色；新增时按 `dials.length % PALETTE.length` 轮换取色（由 home 传 `count` 参数给 `openForm`）
- **"未分组"** 是保留组名：表单留空保存为 `"未分组"`，编辑回填时反向转回空串

## 关键代码文件速查

| 文件 | 职责 |
|------|------|
| `index.html` | 入口：jsdelivr 加载 ofa.js `@latest#debug` + router，引 pui-global.css，`<o-app src="./app-config.js">` |
| `app-config.js` | 导出 `home`（页面路径）与 `pageAnime`（切换动画：opacity + 左右 30px 平移） |
| `pages/home.html` | 主页面：状态、计算属性、增删、拖拽、持久化；内嵌 `<o-page id="dial-form">` 并监听 `dial-save` 事件落库 |
| `pages/dial-form.html` | 添加/编辑弹窗页面模块：自带 `p-dialog` + 表单状态，暴露 `openForm()` 供宿主打开，保存时校验空 URL 并 `emit("dial-save")` 冒泡上抛表单值 |
| `app.json` | manifest；`createdAt` 在分发时由 `__app.json` 的 replacements 替换 |
| `__app.json` | 分发清单：`files` 列出 app.json / index.html / app-config.js / pages/home.html / pages/dial-form.html |

## home.html 页面要点

状态（`data`）：`dials`（收藏数组）、`activeGroup`（当前筛选组，`""` 为全部）、`draggingId` / `dropTargetId`（拖拽中）。弹窗状态（`dialogOpen` / `form` / `editingId`）已下沉到 `pages/dial-form.html`。

计算属性（`proto` getter）：

- `visibleDials`：`activeGroup` 为空返回全部，否则按 `dial.group === activeGroup` 过滤
- `groups`：由 `dials` 实时聚合出 `[{ name, count }]`，空 group 记作「未分组」

关键方法（`proto`）：

- `normalizeUrl(input)`：trim，已有协议（`scheme://`）原样返回，否则补 `https://`；空串原样返回
- `hostOf(url)`：解析 hostname 并去掉 `www.`，解析失败返回原串
- `openDial(dial)`：`window.open(url, "_blank", "noopener")`；拖拽中（`draggingId` 非空）不触发
- `openAdd()` / `openEdit(event, dial)`：`stopPropagation` 后调用 `getDialForm()?.openForm(...)` 打开弹窗页面（新增传 `count`/默认分组，编辑传 `id`/原值；`"未分组"` 反向转空串）
- `onDialSave(event)`：处理弹窗上抛的 `dial-save` 事件（`event.data` = `{ id, url, title, group, color }`），负责 `normalizeUrl` 归一化、标题/分组兜底、编辑原地改字段或新增 push（生成 id/createdAt），最后 `persist()`
- `removeDial(event, dial)`：punch-ui `confirm` 确认后 splice 删除再 `persist()`
- 拖拽：`onDragStart/onDragOver/onDragLeave/onDrop/onDragEnd`，drop 时在 `plainDials()` 拷贝上 splice 换位后整体回写 `this.dials`
- `plainDials()`：把响应式对象拍平为纯对象数组（仅保留 6 个持久化字段），**写库必须经过它**，避免代理对象入库
- `persist()`：`store.setItem("dials", this.plainDials())`
- `attached()`：读 `store.getItem("dials")`，数组则恢复

## dial-form.html 弹窗页面要点

以 `<o-page id="dial-form">` 常驻内嵌于 home（**o-page 初始化后不允许改 src**，传参走方法调用而非 query）：

- 状态（`data`）：`dialogOpen`（弹窗开关）、`editingId`（空串=新增）、`palette`、`form`（url/title/group/color）
- `openForm({ id, url, title, group, color, count })`：宿主调用的入口，回填表单并打开弹窗；`color` 缺省时按 `count % PALETTE.length` 轮选取默认色
- `save()`：URL 为空 → punch-ui `toast` 报错不关闭；否则 `emit("dial-save", { data: { id, url, title, group, color }, bubbles: true, composed: true })` 冒泡上抛原始表单值（不做事后加工），并关闭弹窗
- 分工约定：**弹窗只管表单完整性（非空校验），home 负责业务归一化与落库**；取消/遮罩关闭仅本页置 `dialogOpen = false`，不通知宿主

交互细节：

- 模板用 `o-fill` 循环渲染分组 chips 与卡片网格（`fill-key` 分别为 `name` / `id`）
- 删除/编辑按钮点击需 `event.stopPropagation()`，避免冒泡触发 `openDial`

## 运行方式

- 在 Mazmot 系统内经应用市场安装后运行（`?app=speed-dial` 官方应用分享格式）
- 依赖宿主环境：NoneOS Core Service Worker 提供 `/nos/*` 与 `/gh/` 前缀，页面模块内用 `load(...)` 按需加载，禁止顶层 `import "/nos/*"`

## 测试

- 测试框架 sibyl-test，测试文件放 `test/` 下（如 `test/home.sb.html`），当前尚无测试
