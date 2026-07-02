---
name: rotate-logo
description: 基于 ofa.js 的 3D 旋转 Logo 组件，提供带透视效果的旋转动画；这是一个示范案例组件；
---

# Rotate Logo 组件

## 用途

用于在页面中展示带有 3D 透视旋转效果的 Logo 动画。

## 使用方法

在页面或其他组件的模板中，通过 `<l-m>` 标签引入后使用：

```html
<!-- 引入组件 -->
<l-m src="./comps/rotate-logo/rotate-logo.html"></l-m>

<!-- 使用组件 -->
<rotate-logo></rotate-logo>
```

## 注意事项

- 组件默认宽度为 `100px`，可通过 CSS 覆盖调整大小
- 确保正确引入 ofa.js 库，且 `<l-m>` 标签的 `src` 路径正确
