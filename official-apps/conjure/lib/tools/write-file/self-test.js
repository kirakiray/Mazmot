// write_file 包的内置测试模组（纯插件层：统一虚拟空间模拟 /nos/fs）
// 基座与虚拟空间的用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";
import {
  createVirtualFs,
  readVirtualFile,
} from "../../test-space/virtual-space.js";
import { createAppDir } from "../../builder.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_WRITE = "写入 client/ 并回报字节数（UTF-8）";
const N_CALLBACK = "onFileWrite 回调（appName / path / bytes）";
const N_AUTO_INIT = "跳过 create_app 直接写：自动补 app.json 且 onAppCreated 恰一次";
const N_INVALID_PATH = "非法路径返回可读失败文案（逃逸 / 二进制扩展名）";
const N_OVERWRITE = "覆盖重写后读回新内容";

const testPlan = [
  N_SHAPE,
  N_WRITE,
  N_CALLBACK,
  N_AUTO_INIT,
  N_INVALID_PATH,
  N_OVERWRITE,
];

const writeFileTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "writeFile" &&
        plugin.name === "write_file" &&
        !!plugin.description &&
        !!plugin.schema?.appName &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    // 预置已初始化应用，避免与「自动初始化」用例耦合
    const fs = createVirtualFs();
    await createAppDir(fs, { name: "demo-app", displayName: "Demo" });
    const created = [];
    const writes = [];
    const ctx = {
      fs,
      onAppCreated: (i) => created.push(i),
      onFileWrite: (w) => writes.push(w),
    };

    // "héllo"：é 为 2 字节 UTF-8 → Blob size 6
    const res = await plugin.exec(
      { appName: "demo-app", path: "pages/home.html", content: "héllo" },
      ctx,
    );
    const root = await fs.init("ai-apps");
    const text = await readVirtualFile(root, "demo-app/client/pages/home.html");
    await check(
      N_WRITE,
      text === "héllo" && res.includes("pages/home.html") && res.includes("6 字节"),
      `text=${text} res=${res}`,
    );

    await check(
      N_CALLBACK,
      writes.length === 1 &&
        writes[0].appName === "demo-app" &&
        writes[0].path === "pages/home.html" &&
        writes[0].bytes === 6 &&
        created.length === 0, // 已初始化应用写入不应触发 onAppCreated
      JSON.stringify(writes),
    );

    // 模型跳过 create_app：全新应用直接写 → 自动初始化恰触发一次
    const fs2 = createVirtualFs();
    const created2 = [];
    const ctx2 = {
      fs: fs2,
      onAppCreated: (i) => created2.push(i),
      onFileWrite: () => {},
    };
    await plugin.exec(
      { appName: "direct-app", path: "index.html", content: "<!doctype html>" },
      ctx2,
    );
    await plugin.exec(
      { appName: "direct-app", path: "app-config.js", content: "export {};" },
      ctx2,
    );
    const root2 = await fs2.init("ai-apps");
    const appJson = await readVirtualFile(root2, "direct-app/client/app.json");
    await check(
      N_AUTO_INIT,
      !!appJson &&
        JSON.parse(appJson).name === "direct-app" &&
        created2.length === 1 &&
        created2[0].appName === "direct-app",
      `appJson=${appJson} created=${JSON.stringify(created2)}`,
    );

    // 非法路径：逃逸与二进制扩展名都被 validateRelPath 拦下，返回可读文案
    const escapeRes = await plugin.exec(
      { appName: "demo-app", path: "../evil.txt", content: "x" },
      ctx,
    );
    const binaryRes = await plugin.exec(
      { appName: "demo-app", path: "logo.png", content: "x" },
      ctx,
    );
    await check(
      N_INVALID_PATH,
      escapeRes.startsWith("写入失败：") && binaryRes.startsWith("写入失败："),
      `${escapeRes} | ${binaryRes}`,
    );

    // 覆盖重写：读回新内容，字节数随之变化
    const res2 = await plugin.exec(
      { appName: "demo-app", path: "pages/home.html", content: "v2" },
      ctx,
    );
    const text2 = await readVirtualFile(root, "demo-app/client/pages/home.html");
    await check(
      N_OVERWRITE,
      text2 === "v2" && res2.includes("2 字节"),
      `text=${text2} res=${res2}`,
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = writeFileTest.runSelfTest;
export { testPlan };
