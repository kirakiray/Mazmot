// read_file 包的内置测试模组（纯插件层：统一虚拟空间模拟 /nos/fs）
// 基座与虚拟空间的用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";
import {
  createVirtualFs,
  createVirtualDir,
  seedVirtualFiles,
} from "../../test-space/virtual-space.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_READ = "读取已有文件：内容原样返回";
const N_MISSING = "文件不存在返回可读提示（不抛错）";
const N_APP_MISSING = "应用不存在同样返回文件不存在提示";
const N_LOCAL = "本地渠道（rootHandle）读 client/ 内文件";

const testPlan = [
  N_SHAPE,
  N_READ,
  N_MISSING,
  N_APP_MISSING,
  N_LOCAL,
];

const readFileTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "readFile" &&
        plugin.name === "read_file" &&
        !!plugin.description &&
        !!plugin.schema?.appName &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const fs = createVirtualFs();
    await seedVirtualFiles(await fs.init("ai-apps"), {
      "demo-app/client/app.json": '{"name":"demo-app"}',
      "demo-app/client/lib/util.js": 'export const hi = "你好";\n',
    });
    const ctx = { fs };
    const text = await plugin.exec(
      { appName: "demo-app", path: "lib/util.js" },
      ctx,
    );
    await check(N_READ, text === 'export const hi = "你好";\n', JSON.stringify(text));

    const missing = await plugin.exec(
      { appName: "demo-app", path: "pages/none.html" },
      ctx,
    );
    await check(
      N_MISSING,
      missing === "文件不存在：pages/none.html",
      missing,
    );

    const noApp = await plugin.exec(
      { appName: "ghost-app", path: "index.html" },
      ctx,
    );
    await check(
      N_APP_MISSING,
      noApp === "文件不存在：index.html",
      noApp,
    );

    // 本地渠道：rootHandle + client/ 布局
    const rootHandle = createVirtualDir();
    await seedVirtualFiles(rootHandle, {
      "client/app.json": '{"name":"local-app"}',
      "client/pages/home.html": "<template page></template>",
    });
    const local = await plugin.exec(
      { appName: "local-app", path: "pages/home.html" },
      { rootHandle },
    );
    await check(
      N_LOCAL,
      local === "<template page></template>",
      JSON.stringify(local),
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = readFileTest.runSelfTest;
export { testPlan };
