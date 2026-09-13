// create_app 包的内置测试模组（纯插件层：统一虚拟空间模拟 /nos/fs）
// 基座与虚拟空间的用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";
import {
  createVirtualFs,
  readVirtualFile,
} from "../../test-space/virtual-space.js";

// 用例名与 run() 里的 check() 一一对应，避免两处漂移
const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_CREATE = "创建应用：client/app.json 落盘且内容正确";
const N_CALLBACK = "onAppCreated 回调（appName 规范化 / displayName / icon）";
const N_DEFAULT_ICON = "icon 缺省时回调补 📦";
const N_INVALID = "非法应用名返回可读失败文案（不抛错）";
const N_OVERWRITE = "同名重建视为覆盖（app.json 更新）";

const testPlan = [
  N_SHAPE,
  N_CREATE,
  N_CALLBACK,
  N_DEFAULT_ICON,
  N_INVALID,
  N_OVERWRITE,
];

const createAppTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "createApp" &&
        plugin.name === "create_app" &&
        !!plugin.description &&
        !!plugin.schema?.name &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const fs = createVirtualFs();
    const created = [];
    const ctx = { fs, onAppCreated: (info) => created.push(info) };
    const res = await plugin.exec(
      { name: "Todo App", displayName: "待办", description: "记事", icon: "🍅" },
      ctx,
    );
    const root = await fs.init("ai-apps");
    const appJson = await readVirtualFile(root, "todo-app/client/app.json");
    const meta = appJson ? JSON.parse(appJson) : null;
    await check(
      N_CREATE,
      !!appJson &&
        meta.name === "todo-app" &&
        meta.entry === "./index.html" &&
        res.includes("todo-app") &&
        res.includes("write_file"),
      appJson || "app.json 未落盘",
    );

    await check(
      N_CALLBACK,
      created.length === 1 &&
        created[0].appName === "todo-app" &&
        created[0].displayName === "待办" &&
        created[0].icon === "🍅",
      JSON.stringify(created),
    );

    // icon 缺省：回调补 📦，应用名规范化（大写空格 → 小写短横线）
    const created2 = [];
    await plugin.exec(
      { name: "My App 2", displayName: "M" },
      { fs: createVirtualFs(), onAppCreated: (i) => created2.push(i) },
    );
    await check(
      N_DEFAULT_ICON,
      created2.length === 1 &&
        created2[0].appName === "my-app-2" &&
        created2[0].icon === "📦",
      JSON.stringify(created2),
    );

    // 纯中文名 sanitize 后为空 → 可读失败文案，不抛错、不触发回调
    const before = created.length;
    const bad = await plugin.exec(
      { name: "番茄钟", displayName: "x" },
      ctx,
    );
    await check(
      N_INVALID,
      bad.startsWith("创建失败：") &&
        bad.includes("应用名不合法") &&
        created.length === before,
      bad,
    );

    // 同名再建：覆盖重建，app.json 换新内容
    await plugin.exec({ name: "todo-app", displayName: "新名字" }, ctx);
    const meta2 = JSON.parse(
      (await readVirtualFile(root, "todo-app/client/app.json")) || "{}",
    );
    await check(
      N_OVERWRITE,
      meta2.displayName === "新名字",
      JSON.stringify(meta2),
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = createAppTest.runSelfTest;
export { testPlan };
