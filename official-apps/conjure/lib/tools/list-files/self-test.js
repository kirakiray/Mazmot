// list_files 包的内置测试模组（纯插件层：统一虚拟空间模拟 /nos/fs）
// 基座与虚拟空间的用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";
import {
  createVirtualFs,
  createVirtualDir,
  seedVirtualFiles,
} from "../../test-space/virtual-space.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_LIST = "列举已写文件：换行分隔、深度路径含目录段";
const N_EMPTY = "空应用（刚 create_app 无文件写入）返回占位提示";
const N_NO_APP = "应用不存在同样返回占位提示";
const N_LOCAL = "本地渠道（rootHandle）列举 client/ 内文件";

const testPlan = [
  N_SHAPE,
  N_LIST,
  N_EMPTY,
  N_NO_APP,
  N_LOCAL,
];

const listFilesTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "listFiles" &&
        plugin.name === "list_files" &&
        !!plugin.description &&
        !!plugin.schema?.appName &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const fs = createVirtualFs();
    await seedVirtualFiles(await fs.init("ai-apps"), {
      "demo-app/client/app.json": '{"name":"demo-app"}',
      "demo-app/client/index.html": "<!doctype html>",
      "demo-app/client/pages/home.html": "<template page></template>",
    });
    const res = await plugin.exec({ appName: "demo-app" }, { fs });
    await check(
      N_LIST,
      res === "app.json\nindex.html\npages/home.html",
      JSON.stringify(res),
    );

    // 空应用：只有 create_app 落下的 app.json？不——create_app 会写 app.json，
    // 这里构造「目录存在但 client/ 为空」的场景验证占位文案
    const fs2 = createVirtualFs();
    const root2 = await fs2.init("ai-apps");
    await root2.get("empty-app/client", { create: "dir" });
    const emptyRes = await plugin.exec({ appName: "empty-app" }, { fs: fs2 });
    await check(N_EMPTY, emptyRes === "（应用还没有文件）", emptyRes);

    const noAppRes = await plugin.exec({ appName: "ghost-app" }, { fs: fs2 });
    await check(N_NO_APP, noAppRes === "（应用还没有文件）", noAppRes);

    // 本地渠道：rootHandle + client/ 布局
    const rootHandle = createVirtualDir();
    await seedVirtualFiles(rootHandle, {
      "client/app.json": '{"name":"local-app"}',
      "client/pages/home.html": "<template page></template>",
    });
    const local = await plugin.exec({ appName: "local-app" }, { rootHandle });
    await check(
      N_LOCAL,
      local === "app.json\npages/home.html",
      JSON.stringify(local),
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = listFilesTest.runSelfTest;
export { testPlan };
