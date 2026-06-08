---
name: rotate-logo
description: 基于 ofa.js 的 3D 旋转 Logo 组件，提供带透视效果的旋转动画
---

# Rotate Logo 组件开发指南

## 组件概述

`rotate-logo` 是一个基于 ofa.js 框架开发的3D旋转Logo组件，主要用于展示带有透视效果的旋转动画。

## 技术实现

### 核心技术
- 使用ofa.js组件框架
- CSS3 3D transforms实现旋转效果
- CSS perspective实现透视效果

### 关键代码结构

```html
<template component>
  <style>
    :host {
      perspective: 800px; /* 透视距离，影响3D效果强度 */
    }
    img {
      animation: rotate 2s ease-in-out infinite;
    }
    @keyframes rotate {
      0% { transform: rotateY(0deg) rotateX(0deg); }
      100% { transform: rotateY(360deg) rotateX(360deg); }
    }
  </style>
  <img attr:src="src" alt="logo" />
  <script>
    export default async ({ load }) => {
      return {
        tag: "rotate-logo",
        attrs: { src: null }
      };
    };
  </script>
</template>
```

## 开发注意事项

### 1. 透视效果配置
- `perspective` 属性必须在父容器（`:host`）上设置
- 建议值范围：500px - 1200px
- 值越小，透视效果越强烈

### 2. 动画参数调整
修改动画时需要注意：
- 必须指定持续时间（如 `2s`）
- 缓动函数只使用一个，避免冲突
- 使用 `infinite` 保持持续旋转

### 3. 性能优化
- 使用 `transform` 而非 `left/top` 等属性进行动画
- 避免在动画中使用 `box-shadow` 等高消耗属性
- 图片建议使用SVG或优化过的PNG

### 4. 响应式考虑
- 组件默认宽度100px，可通过CSS覆盖
- 确保图片在不同尺寸下保持清晰度
- 考虑移动设备上的性能表现

## 常见问题

### 动画不显示
检查以下几点：
1. animation属性是否包含持续时间
2. timing-function是否重复定义
3. 浏览器是否支持CSS3 3D transforms

### 透视效果不明显
调整 `perspective` 值：
- 增大值（如1000px）会减弱透视效果
- 减小值（如500px）会增强透视效果

### 组件加载失败
确保：
1. 正确引入ofa.js库
2. `<l-m>` 标签的 `src` 路径正确
3. 组件文件路径可访问

## 扩展建议

### 添加旋转速度控制
可以通过添加属性来控制旋转速度：

```javascript
attrs: {
  src: null,
  duration: 2 // 旋转周期（秒）
}
```

### 添加旋转方向控制
可以通过属性控制旋转方向：

```javascript
attrs: {
  src: null,
  direction: 'clockwise' // 或 'counterclockwise'
}
```

### 添加暂停/播放功能
可以通过JavaScript API控制动画状态：

```javascript
// 暂停动画
element.querySelector('img').style.animationPlayState = 'paused';

// 恢复动画
element.querySelector('img').style.animationPlayState = 'running';
```