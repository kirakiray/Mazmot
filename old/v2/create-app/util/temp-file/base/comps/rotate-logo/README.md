# Rotate Logo 组件

一个带有透视效果的3D旋转Logo组件，可以为图片添加流畅的旋转动画效果。

## 功能特性

- 3D透视旋转动画
- 可自定义图片源
- 流畅的缓动效果
- 响应式设计

## 使用方法

### 基本用法

```html
<l-m src="./comps/rotate-logo/rotate-logo.html"></l-m>
<rotate-logo src="your-image-url.svg"></rotate-logo>
```

### 属性说明

| 属性名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `src` | String | 是 | 要旋转的图片URL地址 |

### 示例

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rotate Logo Demo</title>
    <script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs" type="module"></script>
  </head>
  <body>
    <l-m src="./comps/rotate-logo/rotate-logo.html"></l-m>
    <rotate-logo src="https://ofajs.com/img/logo.svg"></rotate-logo>
  </body>
</html>
```

## 动画效果

组件使用以下动画参数：
- 持续时间：2秒
- 缓动函数：ease-in-out
- 旋转轴：Y轴和X轴同时旋转
- 透视距离：800px

## 样式定制

组件默认图片宽度为100px，如需调整可以通过CSS覆盖：

```css
rotate-logo img {
  width: 150px; /* 自定义宽度 */
}
```

## 浏览器兼容性

支持所有现代浏览器，需要浏览器支持：
- CSS3 3D transforms
- CSS animations
- CSS perspective属性