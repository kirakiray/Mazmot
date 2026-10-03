// edit_file 包的内置测试模组（纯插件层：统一虚拟空间模拟 /nos/fs）
// 基座与虚拟空间的用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";
import {
  createVirtualFs,
  readVirtualFile,
  seedVirtualFiles,
} from "../../test-space/virtual-space.js";
import { createAppDir, writeAppFile } from "../../builder.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_APPLY = "唯一命中替换成功，未提及内容原样保留";
const N_MULTI = "一次多条 edits 依序应用（前条结果参与后条匹配）";
const N_CALLBACK = "onFileWrite 回调（op=edit / applied / prevText / nextText）";
const N_MISS = "未命中返回可读失败文案（引导 read_file）";
const N_AMBIGUOUS = "多处命中报错（提示扩大上下文或 replace_all）";
const N_REPLACE_ALL = "replace_all: true 全部替换";
const N_NEW_FILE = "文件不存在报错（引导 write_file）";
const N_INVALID_PATH = "非法路径返回可读失败文案";

const testPlan = [
  N_SHAPE,
  N_APPLY,
  N_MULTI,
  N_CALLBACK,
  N_MISS,
  N_AMBIGUOUS,
  N_REPLACE_ALL,
  N_NEW_FILE,
  N_INVALID_PATH,
];

const editFileTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "editFile" &&
        plugin.name === "edit_file" &&
        !!plugin.description &&
        !!plugin.schema?.appName &&
        !!plugin.schema?.edits &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const fs = createVirtualFs();
    await createAppDir(fs, { name: "demo-app", displayName: "Demo" });
    const root = await fs.init("ai-apps");
    await seedVirtualFiles(root, {
      "demo-app/client/pages/home.html":
        "<template page>\n  <div id=\"box\">旧标题</div>\n  <p>说明文字</p>\n</template>",
    });
    const writes = [];
    const ctx = { fs, onFileWrite: (w) => writes.push(w) };

    // 唯一命中：只动目标片段，其余内容保留
    const res1 = await plugin.exec(
      {
        appName: "demo-app",
        path: "pages/home.html",
        edits: [{ old_string: "旧标题", new_string: "新标题" }],
      },
      ctx,
    );
    const text1 = await readVirtualFile(root, "demo-app/client/pages/home.html");
    await check(
      N_APPLY,
      text1.includes("新标题") &&
        !text1.includes("旧标题") &&
        text1.includes("说明文字") &&
        text1.startsWith("<template page>") &&
        res1.includes("应用 1 处修改"),
      `text=${text1} res=${res1}`,
    );

    // 多条 edits：前条结果参与后条匹配
    const res2 = await plugin.exec(
      {
        appName: "demo-app",
        path: "pages/home.html",
        edits: [
          { old_string: "新标题", new_string: "阶段一" },
          { old_string: "阶段一", new_string: "阶段二" },
        ],
      },
      ctx,
    );
    const text2 = await readVirtualFile(root, "demo-app/client/pages/home.html");
    await check(
      N_MULTI,
      text2.includes("阶段二") && !text2.includes("阶段一") && res2.includes("应用 2 处修改"),
      `text=${text2} res=${res2}`,
    );

    // 回调 payload：op=edit、applied 计数、prev/next 文本供变更卡 diff
    await check(
      N_CALLBACK,
      writes.length === 2 &&
        writes[0].op === "edit" &&
        writes[0].applied === 1 &&
        writes[0].prevText.includes("旧标题") &&
        writes[0].nextText.includes("新标题") &&
        writes[0].path === "pages/home.html",
      JSON.stringify(writes.map((w) => ({ op: w.op, applied: w.applied }))),
    );

    // 未命中：可读文案引导 read_file
    const miss = await plugin.exec(
      {
        appName: "demo-app",
        path: "pages/home.html",
        edits: [{ old_string: "不存在的片段", new_string: "x" }],
      },
      ctx,
    );
    await check(
      N_MISS,
      miss.startsWith("编辑失败：") && miss.includes("read_file"),
      miss,
    );

    // 多处命中：报错并给出命中数
    await writeAppFile(fs, "demo-app", "dup.txt", "a\nb\na\nb\na");
    const ambiguous = await plugin.exec(
      {
        appName: "demo-app",
        path: "dup.txt",
        edits: [{ old_string: "a", new_string: "z" }],
      },
      ctx,
    );
    await check(
      N_AMBIGUOUS,
      ambiguous.startsWith("编辑失败：") && ambiguous.includes("3 处") && ambiguous.includes("replace_all"),
      ambiguous,
    );

    // replace_all：全部替换
    await plugin.exec(
      {
        appName: "demo-app",
        path: "dup.txt",
        edits: [{ old_string: "a", new_string: "z", replace_all: true }],
      },
      ctx,
    );
    const dupText = await readVirtualFile(root, "demo-app/client/dup.txt");
    await check(N_REPLACE_ALL, dupText === "z\nb\nz\nb\nz", `text=${dupText}`);

    // 文件不存在：引导 write_file
    const missing = await plugin.exec(
      {
        appName: "demo-app",
        path: "no-such.js",
        edits: [{ old_string: "x", new_string: "y" }],
      },
      ctx,
    );
    await check(
      N_NEW_FILE,
      missing.startsWith("编辑失败：") && missing.includes("write_file"),
      missing,
    );

    // 非法路径
    const escape = await plugin.exec(
      {
        appName: "demo-app",
        path: "../evil.js",
        edits: [{ old_string: "x", new_string: "y" }],
      },
      ctx,
    );
    await check(N_INVALID_PATH, escape.startsWith("编辑失败："), escape);
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = editFileTest.runSelfTest;
export { testPlan };
