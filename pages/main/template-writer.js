// ofa.js Hello World 应用模板生成与写入
// 负责根据应用名和描述生成模板文件，并逐个写入到目标目录

/**
 * 根据应用名和描述生成模板文件列表
 * @param {{ name: string, desc?: string }} options
 * @returns {Array<{ path: string, content: string }>}
 */
export function buildTemplateFiles({ name, desc }) {
  const appJson = JSON.stringify(
    {
      name,
      displayName: name,
      version: "0.1.0",
      description: desc || "",
      author: "",
      icon: "",
      entry: "./index.html",
      appConfig: "./app-config.js",
      permissions: [],
      capabilities: [],
      createdAt: Date.now(),
      mazmot: {
        source: "self-created",
      },
    },
    null,
    2
  );

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <script src="/common/binding.js"><\/script>
    <script
      src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs"
      type="module"
    ><\/script>
    <script
      src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs"
      type="module"
    ><\/script>
    <link
      rel="stylesheet"
      href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
    />
    <style>
      html,
      body {
        height: 100%;
        padding: 0;
        margin: 0;
        overflow: hidden;
        font-family:
          -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
      }
    </style>
  </head>
  <body>
    <o-router fix-body>
      <o-app src="./app-config.js"></o-app>
    </o-router>
  </body>
</html>
`;

  const appConfigJs = `export const home = "./pages/home.html";

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
};
`;

  const homeHtml = `<template page>
  <style>
    :host {
      display: block;
      height: 100%;
    }
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px;
      text-align: center;
    }
    h1 {
      color: var(--md-sys-color-primary);
      margin-bottom: 12px;
    }
    p {
      color: var(--md-sys-color-on-surface-variant);
      line-height: 1.6;
    }
  </style>
  <div class="welcome">
    <h1>Hello, ${name}!</h1>
    <p>${desc || "Welcome to your new ofa.js application."}</p>
  </div>
  <script>
    export default async () => {
      return {
        data: {},
      };
    };
  <\/script>
</template>
`;

  return [
    { path: "app.json", content: appJson },
    { path: "index.html", content: indexHtml },
    { path: "app-config.js", content: appConfigJs },
    { path: "pages/home.html", content: homeHtml },
  ];
}

/**
 * 将模板文件写入目标目录，通过回调上报进度
 * @param {Object} options
 * @param {Object} options.dirHandle 目标目录句柄（noneos-core DirHandle）
 * @param {string} options.name 应用名称
 * @param {string} [options.desc] 应用描述
 * @param {(payload: { index: number, total: number, path: string, status: 'writing'|'done', progress: number }) => void} [options.onProgress] 进度回调
 * @param {number} [options.stepDelay=120] 每个文件之间的等待时长（用于 UI 平滑，单位 ms）
 * @returns {Promise<Array<{ path: string, content: string }>>} 写入完成的文件列表
 */
export async function writeTemplateFiles({
  dirHandle,
  name,
  desc,
  onProgress,
  stepDelay = 120,
}) {
  if (!dirHandle) {
    throw new Error("缺少目标目录句柄");
  }

  const files = buildTemplateFiles({ name, desc });
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    if (onProgress) {
      onProgress({
        index: i,
        total,
        path: f.path,
        status: "writing",
        progress: Math.round((i / total) * 100),
      });
    }

    const fileHandle = await dirHandle.get(f.path, { create: "file" });
    await fileHandle.write(f.content);

    if (onProgress) {
      onProgress({
        index: i,
        total,
        path: f.path,
        status: "done",
        progress: Math.round(((i + 1) / total) * 100),
      });
    }

    if (stepDelay > 0 && i < files.length - 1) {
      await new Promise((r) => setTimeout(r, stepDelay));
    }
  }

  return files;
}
