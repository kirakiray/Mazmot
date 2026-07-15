# Mazmot 公共组件上下文

> 本目录存放 Mazmot 系统级可复用的 ofa.js 组件，供主系统或其他应用引用。

## 目录结构

```
comps/
├── rdn-network/          # 浮窗式网络状态面板
│   └── rdn-network.html
├── rnd-box/              # 可拖拽/缩放的浮动盒子容器
│   ├── rnd-box.html
│   ├── demo.html
│   └── README.md
└── user-name/            # 用户名片显示组件
    ├── user-name.html
    └── user-name.sb.html
```

## 组件说明

### `m-rnd-box` — 可拖拽缩放的浮动盒子

- **文件**：[rnd-box/rnd-box.html](rnd-box/rnd-box.html)
- **标签**：`<m-rnd-box>`
- **定位**：底层容器组件，提供可自由定位、拖拽、缩放的浮动盒子能力。
- **核心能力**：
  - 通过 `x` / `y` / `width` / `height` 属性设置初始位置与尺寸。
  - `movable` 布尔属性：启用拖拽移动，限制在父容器边界内。
  - `resizable` 布尔属性：启用 8 方向缩放手柄。
  - `auto-save-id` 属性：自动将位置、尺寸、focus 状态持久化到 `EverCache("mazmot-rnd-box")`（key 规则 `mazmot:rnd-box:${autoSaveId}`）。刷新后按比例恢复，防止越界。
  - 同一 `offsetParent` 内最多只有一个 box 持有 `rnd-focus` 状态（表现为更高 `z-index`）。
- **事件**：`rnd-focus` / `rnd-blur`
- **使用示例**：参考 [rnd-box/README.md](rnd-box/README.md)

### `rdn-network` — 浮窗式网络面板

- **文件**：[rdn-network/rdn-network.html](rdn-network/rdn-network.html)
- **标签**：`<rdn-network>`
- **定位**：系统级浮动入口，将 [apps/network/](apps/network/) 应用以可拖拽缩放的窗口形式嵌入当前页面。
- **核心能力**：
  - 内部使用 `<m-rnd-box>` 承载窗口，支持展开 / 收起两种状态。
  - 展开状态显示 Network 窗口标题栏，主体通过 `<o-app src="../../apps/network/app-config.js">` 加载网络应用。
  - 收起状态渲染为可拖拽的圆形气泡，点击后展开。
  - 使用 `EverCache("mazmot-rdn-network")` 持久化 `collapsed` 状态。
- **注意**：该组件依赖 `rnd-box` 组件，需确保 [rnd-box/rnd-box.html](rnd-box/rnd-box.html) 可被加载。

### `user-name` — 用户显示名组件

- **文件**：[user-name/user-name.html](user-name/user-name.html)
- **标签**：`<user-name>`
- **定位**：根据 `userId` 自动解析并展示用户的 `username`（名片信息），回退显示 `userId`。
- **核心能力**：
  - `user-id` 属性：目标用户 ID。
  - `force` 布尔属性：开启时会先尝试 `connectUser(uid)` 触发名片交换，再刷新缓存读取最新名片。
  - `namespace` 属性：指定 `getUser(namespace)` 的命名空间，默认 `"default"`。
  - 内部通过 `/nos/user/main.js` 的 `getUser` 获取当前用户，再使用 `user.card.get(uid)` 读取名片。
- **测试**：[user-name/user-name.sb.html](user-name/user-name.sb.html)

## 使用方式

在需要使用的页面或组件中通过 ofa.js 的 `l-m` 引入：

```html
<l-m src="/comps/rnd-box/rnd-box.html"></l-m>
<l-m src="/comps/rdn-network/rdn-network.html"></l-m>
<l-m src="/comps/user-name/user-name.html"></l-m>
```

## 开发规范

- 所有组件必须符合 ofa.js 语法（`template component`、`attrs`、`data`、`proto`、`sync:`、`:style.` 等）。
- 涉及本地持久化优先使用 `ever-cache`，禁止直接操作 `localStorage`。
- 图标统一使用 `<n-icon icon="mdi:xxx">`，禁止直接使用 `iconify-icon`。
- 新增组件后应在本文件补充上下文说明，并在 [CONTEXT.md](../CONTEXT.md) 中添加引用路径。
