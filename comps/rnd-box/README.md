# Rnd Box 拖拽缩放组件

一组基于 ofa.js 的拖拽与缩放组件，支持在区域内自由拖拽移动和调整大小。

## 组件说明

### m-rnd-area

拖拽容器组件，作为 `m-rnd-box` 的父容器，提供相对定位上下文。

### m-rnd-box

可拖拽/缩放的盒子组件，支持在 `m-rnd-area` 内自由定位。

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

<l-m src="./rnd-area.html"></l-m>
<l-m src="./rnd-box.html"></l-m>
```

## 使用示例

### 基础用法

```html
<m-rnd-area>
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
</m-rnd-area>
```

## API

### m-rnd-box

#### 属性

| 属性名   | 类型     | 默认值 | 说明                   |
| -------- | -------- | ------ | ---------------------- |
| x        | number   | 0      | 盒子的左偏移距离 (px)  |
| y        | number   | 0      | 盒子的顶部偏移距离 (px) |
| width    | number   | 0      | 盒子的宽度 (px)         |
| height   | number   | 0      | 盒子的高度 (px)         |
| movable  | boolean  | —      | 是否可拖拽移动          |
| resizable| boolean  | —      | 是否可调整大小          |

> 注：`movable` 和 `resizable` 为布尔属性，无需赋值，存在即生效。

### m-rnd-area

当前为容器组件，无额外属性配置。
