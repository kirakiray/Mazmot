import { get } from "/nos/fs/main.js";

// 初始化项目代码
export async function initCode(projectPath) {
  const files = {
    "index.html": {
      aimap: `文件类型: HTML 入口文件
主要功能: 应用程序入口，加载 ofa.js 框架和路由系统
关键组件:
  - o-router: 路由容器组件
  - o-app: 应用组件，引用 app-config.js 配置
依赖资源:
  - ofa.js 核心库 (debug 模式)
  - ofa.js 路由插件
  - Punch-UI 全局样式
用途: 作为单页应用的 HTML 入口，初始化整个应用框架`,
      code: `<!DOCTYPE html>
<html lang="en"> 
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/pages/create-app/util/emulator-binding.js"></script>
  <title>My App</title>
  <script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></script>
  <script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs" type="module"></script>
  <link rel="stylesheet" href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css" />
  <style>
    html, body {
      height: 100%;
      padding: 0;
      margin: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
  </style>
</head>
<body>
  <o-router fix-body>
    <o-app src="./app-config.js"></o-app>
  </o-router>
</body>
</html>`,
    },
    "app-config.js": {
      aimap: `文件类型: JavaScript 配置文件
主要功能: ofa.js 应用核心配置
导出配置:
  - home: 首页路由路径，指向 ./pages/home.html
  - pageAnime: 页面切换动画配置
    - current: 当前页面状态 (opacity: 1, 无位移)
    - next: 下一页面进入动画 (从右侧淡入)
    - previous: 上一页面返回动画 (从左侧淡入)
用途: 定义应用路由入口和页面过渡动画效果`,
      code: `export const home = "./pages/home.html";

export const pageAnime = {
  current: {
    opacity: 1,
    transform: "translate(0, 0)",
  },
  next: {
    opacity: 0,
    transform: "translate(30px, 0)",
  },
  previous: {
    opacity: 0,
    transform: "translate(-30px, 0)",
  },
};`,
    },
    "pages/layout.html": {
      aimap: `文件类型: ofa.js 页面模块 (Layout 模板)
主要功能: 应用通用布局模板，提供页面骨架结构
布局结构:
  - header: 顶部导航栏，显示应用标题 "My App"
  - main: 内容区域，使用 <slot> 插槽承载子页面内容
样式特点:
  - 使用 CSS Flexbox 垂直布局
  - header 使用主题色背景 (var(--md-sys-color-primary))
  - main 区域可滚动，使用表面背景色
用途: 作为其他页面的父级布局模板，通过 parent 属性引用`,
      code: `<template page>
  <style>
    :host {
      display: block;
      height: 100%;
    }
    .layout {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    header {
      padding: 15px 20px;
      background: var(--md-sys-color-primary);
      color: var(--md-sys-color-on-primary);
      box-shadow: 0 2px 4px rgb(from var(--md-sys-color-on-primary) r g b / 0.1);
    }
    main {
      flex: 1;
      overflow: auto;
      padding: 20px;
      background: var(--md-sys-color-surface);
    }
  </style>
  <div class="layout">
    <header>
      <h2>My App</h2>
    </header>
    <main>
      <slot></slot>
    </main>
  </div>
  <script>
    export default async () => {
      return {
        data: {},
      };
    };
  </script>
</template>`,
    },
    "pages/home.html": {
      aimap: `文件类型: ofa.js 页面模块 (首页)
主要功能: 应用首页，展示欢迎信息和入门指南
页面结构:
  - 欢迎区域 (.welcome): 居中显示标题和简介
  - 卡片区域 (.card): 展示快速入门指南
    - 列出关键文件说明 (app-config.js, home.html, layout.html)
模块配置:
  - parent: ./layout.html (继承布局模板)
样式特点:
  - 使用 Material Design 配色变量
  - 卡片使用圆角边框和表面变体背景
用途: 作为应用默认首页，引导用户了解项目结构`,
      code: `<template page>
  <style>
    :host {
      display: block;
    }
    .welcome {
      text-align: center;
      padding: 40px 20px;
    }
    h1 {
      color: var(--md-sys-color-on-surface);
      margin-bottom: 20px;
    }
    p {
      color: var(--md-sys-color-on-surface-variant);
      line-height: 1.6;
    }
    .card {
      max-width: 600px;
      margin: 30px auto;
      padding: 20px;
      border: 1px solid rgb(from var(--md-sys-color-on-surface-variant) r g b / 0.2);
      border-radius: 8px;
      background: var(--md-sys-color-surface-variant);
    }
    h3 {
      color: var(--md-sys-color-on-surface);
      margin-top: 0;
    }
    code {
      background: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
  </style>
  <div class="welcome">
    <h1>Welcome to My App</h1>
    <p>This is a simple ofa.js application created with NoneOS Core.</p>
  </div>
  <div class="card">
    <h3>Getting Started</h3>
    <p>Edit the files in the project to customize your application.</p>
    <ul>
      <li><code>app-config.js</code> - Application configuration</li>
      <li><code>pages/home.html</code> - Home page</li>
      <li><code>pages/layout.html</code> - Layout template</li>
    </ul>
  </div>
  <script>
    export const parent = "./layout.html";
    export default async () => {
      return {
        data: {},
      };
    };
  </script>
</template>`,
    },
  };

  for (const [filePath, { code, aimap }] of Object.entries(files)) {
    const handle = await get(`${projectPath}/${filePath}`, { create: "file" });
    await handle.write(code);

    if (aimap) {
      const parts = filePath.split("/");
      const fileName = parts.pop();
      const aimapDir = parts.length > 0 ? `${parts.join("/")}/` : "";
      const aimapHandle = await get(
        `${projectPath}/${aimapDir}.aimap/${fileName}.md`,
        { create: "file" }
      );
      await aimapHandle.write(aimap);
    }
  }
}
