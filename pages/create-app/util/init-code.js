import { get } from "/nos/fs/main.js";

export async function initCode(projectPath) {
  const indexHtml = await get(`${projectPath}/index.html`, { create: "file" });
  await indexHtml.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></script>
  <script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs" type="module"></script>
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
</html>`);

  const appConfig = await get(`${projectPath}/app-config.js`, {
    create: "file",
  });
  await appConfig.write(`export const home = "./pages/home.html";

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
};`);

  const pagesDir = await get(`${projectPath}/pages`, { create: "dir" });

  const layoutHtml = await get(`${projectPath}/pages/layout.html`, {
    create: "file",
  });
  await layoutHtml.write(`<template page>
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
      background: #4a90e2;
      color: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    main {
      flex: 1;
      overflow: auto;
      padding: 20px;
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
</template>`);

  const homeHtml = await get(`${projectPath}/pages/home.html`, {
    create: "file",
  });
  await homeHtml.write(`<template page>
  <style>
    :host {
      display: block;
    }
    .welcome {
      text-align: center;
      padding: 40px 20px;
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
    .card {
      max-width: 600px;
      margin: 30px auto;
      padding: 20px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      background: #f9f9f9;
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
</template>`);

  console.log("App initialized successfully at:", projectPath);
}
