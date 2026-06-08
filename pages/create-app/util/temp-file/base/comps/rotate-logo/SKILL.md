---
name: rotate-logo
description: 基于 ofa.js 的 3D 旋转 Logo 组件，提供带透视效果的旋转动画；这是一个示范案例组件；
---

# Rotate Logo 组件开发指南

## 组件概述

`rotate-logo` 是一个基于 ofa.js 框架开发的3D旋转Logo组件，主要用于展示带有透视效果的旋转动画。

## 技术实现

- 使用 ofa.js 组件框架
- CSS3 3D transforms 实现旋转效果
- CSS perspective 实现透视效果

## 开发注意事项

1. **透视效果配置**：`perspective` 属性必须在 `:host` 上设置，建议值 500px - 1200px
2. **动画参数**：必须指定持续时间，缓动函数只使用一个，避免冲突
3. **性能优化**：使用 `transform` 进行动画，避免 `box-shadow` 等高消耗属性
4. **响应式**：组件默认宽度 100px，可通过 CSS 覆盖

## 常见问题

- **动画不显示**：检查 animation 属性是否包含持续时间，浏览器是否支持 CSS3 3D transforms
- **透视效果不明显**：调整 `perspective` 值，增大减弱效果，减小增强效果
- **组件加载失败**：确保正确引入 ofa.js 库，`<l-m>` 标签的 `src` 路径正确
