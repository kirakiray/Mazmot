# 项目介绍

这是一个基于 [ofa.js](https://ofajs.com/) 开发的示范用基础模板项目，演示了如何构建一个包含组件和页面的 ofa.js 应用。

## 技术栈

- [ofa.js](https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs) - 前端组件化框架
- [ofa-router](https://cdn.jsdelivr.net/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs) - 路由管理
- [Punch UI](https://punch-ui-v2.pages.dev/packages/css/pui-global.css) - UI 样式库

## 项目结构

```
├── /comps                # 可复用组件模块目录
│   └── /rotate-logo      # 3D 旋转 Logo 组件（示范组件）
│       ├── rotate-logo.html
│       ├── README.md
│       ├── SKILL.md
│       └── /demo
├── /pages                # 页面模块目录
│   └── home.html         # 首页
├── index.html            # 应用入口文件
├── app-config.js         # 应用路由配置
├── AGENTS.md             # 开发指南（面向开发者）
└── README.md             # 项目说明（本文档）
```

## 快速开始

本项目通常已在运行环境中，无需额外启动静态服务器。直接在浏览器中打开 `index.html` 即可运行。

## 开发指南

开发前请参阅 [`AGENTS.md`](./AGENTS.md) 了解项目结构、组件规范和开发规则。

## 组件示例

本项目包含一个示范组件 `rotate-logo`，展示了如何开发基于 ofa.js 的自定义组件。详见 [`/comps/rotate-logo/README.md`](./comps/rotate-logo/README.md)。
