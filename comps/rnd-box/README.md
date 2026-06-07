# Rnd Box 拖拽缩放组件

一组基于 ofa.js 的拖拽与缩放组件，支持在区域内自由拖拽移动和调整大小。

## 组件说明

### m-rnd-box

可拖拽/缩放的盒子组件，支持在父容器内自由定位。

## 引入方式

```html
<script
  src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.min.mjs"
  type="module"
></script>
<link
  rel="stylesheet"
  href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
/>

<l-m src="./rnd-box.html"></l-m>
```

## 使用示例

### 基础用法

```html
<m-rnd-box
  style="border: red solid 1px"
  x="100"
  y="100"
  width="200"
  height="200"
  movable
>
  box 1
</m-rnd-box>
<m-rnd-box
  style="border: blue solid 1px"
  x="300"
  y="300"
  width="200"
  height="200"
  resizable
  movable
>
  box 2
</m-rnd-box>
```

### 自动保存定位与尺寸

设置 `auto-save-id` 后，每次拖拽或缩放结束都会把当前的位置、尺寸、focus 状态以及 offsetParent 当时的尺寸写入 ever-cache；下次刷新页面时若存在对应记录，会自动恢复定位、尺寸和 focus（此时会忽略属性上的 `x` / `y` / `width` / `height`）。

如果刷新时 offsetParent 的尺寸与存档不一致，会按比例缩放 `x` / `y` / `width` / `height`，确保 box 在新尺寸的父元素中保持相对位置和大小；缩放后会再做一次边界裁剪，防止越界。

```html
<m-rnd-box
  style="border: red solid 1px"
  x="100"
  y="100"
  width="200"
  height="200"
  movable
  resizable
  auto-save-id="box-1"
>
  box 1
</m-rnd-box>
```

> 存储 key 规则：`mazmot:rnd-box:${autoSaveId}`，使用 [`ever-cache`](https://github.com/kirakiray/ever-cache) 作为存储后端。
> 同一 offsetParent 内最多只有一个 box 持有 `rnd-focus` 属性（表现为 `z-index: 5`）。

## API

### m-rnd-box

#### 属性

| 属性名        | 类型     | 默认值 | 说明                                                                 |
| ------------- | -------- | ------ | -------------------------------------------------------------------- |
| x             | number   | 0      | 盒子的左偏移距离 (px)                                                |
| y             | number   | 0      | 盒子的顶部偏移距离 (px)                                              |
| width         | number   | 0      | 盒子的宽度 (px)                                                      |
| height        | number   | 0      | 盒子的高度 (px)                                                      |
| movable       | boolean  | —      | 是否可拖拽移动                                                       |
| resizable     | boolean  | —      | 是否可调整大小                                                       |
| auto-save-id  | string   | —      | 存在时自动将定位与尺寸保存到 ever-cache，刷新后按该 id 恢复位置      |

> 注：`movable` 和 `resizable` 为布尔属性，无需赋值，存在即生效。

#### 事件

| 事件名     | 触发时机                                                          | event.detail |
| ---------- | ----------------------------------------------------------------- | ------------ |
| rnd-focus  | 当前 box 获得 `rnd-focus`（自身被点击/拖动/缩放，或从存档恢复）时  | —            |
| rnd-blur   | 当前 box 持有的 `rnd-focus` 被同 offsetParent 内的其他 box 抢占时 | —            |

示例：监听 `rnd-focus` / `rnd-blur` 以跟踪当前活动 box：

```js
$("m-rnd-box").on("rnd-focus", () => {
  console.log("本 box 获得 focus");
});
$("m-rnd-box").on("rnd-blur", () => {
  console.log("本 box 失去 focus");
});
```
