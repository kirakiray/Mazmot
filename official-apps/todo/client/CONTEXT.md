# CONTEXT.md — 待办清单（todo）

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个单页的轻量待办清单：添加、勾选完成、删除、按状态筛选、一键清除已完成，数据保存在本机（NoneOS 存储），关掉再回来还在。

## 使用指南

页面自上而下四个区块，对应四条操作路径：

1. **添加**：顶部输入框输入内容 → 回车或点「添加」按钮（输入为空时按钮禁用）。新事项插入列表顶部，输入框自动清空。
2. **筛选**：`全部 / 未完成 / 已完成` 按钮组切换视图，当前选中项为 `filled` 样式，其余为 `text` 样式。空视图时显示对应提示文案（`emptyText` 随筛选切换）。
3. **勾选 / 删除**：每行左侧 `st-checkbox` 勾选完成（文字加删除线并变灰），右侧 `✕` 图标按钮删除该条。
4. **底部栏**：显示「N 项未完成 · 共 M 项」；右侧「清除已完成」按钮在无已完成项时禁用。

## 目录结构

```
client/
├── index.html       # 入口：o-router fix-body > o-app，引 ofa.js / router / st-boot
├── app-config.js    # 仅导出 home 路由（./pages/home.html）
├── app.json         # 应用元信息（name=todo、displayName=待办清单、icon=✅）
└── pages/
    └── home.html    # 唯一页面模块：样式 + 模板 + 脚本（全部逻辑在此）
```

（`pitfalls/` 为踩坑库，`backup/` 为系统自动备份目录，均不属于运行时资源。）

## 数据模型

### 持久化（NoneOS 存储）

- 存储空间：`getStorage("conjure-todo-app")`；键：`"todos"`。
- 值：`Array<{ id: string, text: string, done: boolean }>`，新增项置于数组首位。
- `id` 生成：`Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`。
- 读取时做一次规范化（`String(id)` / `String(text || "")` / `!!done`），非数组或读取异常时保持空列表并 `console.error`。

### 页面状态（data）

| 字段 | 含义 | 初始值 |
| ---- | ---- | ------ |
| `draft` | 输入框草稿（`sync:value` 双向绑定） | `""` |
| `view` | 当前筛选：`all` / `active` / `done` | `"all"` |
| `todos` | 全量待办数组 | `[]` |
| `emptyText` | 空视图提示文案（`setView` 时按筛选切换） | 全部视图的提示语 |

### 计算属性（proto getter）

| getter | 含义 |
| ------ | ---- |
| `visibleTodos` | 按 `view` 过滤后的列表，供 `o-fill` 渲染 |
| `remaining` | 未完成数量 |
| `doneCount` | 已完成数量（同时决定「清除已完成」是否禁用） |
| `isListEmpty` | `visibleTodos.length === 0`，控制 `o-if` 空状态 |

## 关键流程

- **启动**：`index.html` 加载 ofa.js / router / st-boot → `o-app` 按 `app-config.js` 载入 `pages/home.html` → 页面工厂里 `load("/nos/storage/main.js")`、`getStorage("conjure-todo-app")` → `ready()` 调 `loadTodos()` 读存储并渲染 `o-fill`。
- **改动数据**：`addTodo` / `toggleTodo` / `deleteTodo` / `clearDone` 都会重建 `this.todos` 后调 `persistTodos()` 写回存储；模板由 ofa 响应式更新。
- **筛选**：`setView(value)` 只改 `view` 与 `emptyText`，`visibleTodos` 随之重算，不动数据。

**核心链路（实测清单，功能演进时同步扩充）**：① 打开应用渲染列表与计数；② 输入后添加（含按钮禁用态、输入框清空）；③ 勾选/取消勾选（删除线 + 计数变化）；④ 三个筛选视图切换与空状态文案；⑤ 单条删除；⑥ 清除已完成（含无已完成项时的禁用态）；⑦ 重开后数据仍在（持久化）；⑧ 长列表可滚到底。

## 踩坑索引

> 一坑一文件收在 `pitfalls/` 目录（命名与格式见 `pitfalls/README.md`）；本表只放索引，禁止把坑的正文写进本表。使用方式：按标题判断与本回合任务是否相关，命中才精读对应文件。

| 编号 | 标题 | 文件 |
| ---- | ---- | ---- |
| 001 | 页面 `:host` 没做成滚动容器，长列表被裁掉且无法滚动 | `pitfalls/001-host-must-be-scroll-container.md` |
| 002 | 预览通道两个验证陷阱：增量刷新不重置页面状态、应用首帧日志捕获不到 | `pitfalls/002-preview-channel-verification-traps.md` |
