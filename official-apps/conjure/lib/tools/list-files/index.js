// 工具插件包：list_files
// 列出应用项目内已写入的全部文件。
// 依赖注入：ctx = { fs, rootHandle }
import { listAppFiles } from "../../builder.js";

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "listFiles",
  name: "list_files",
  selfTest, // 内置测试模组地址（工具详情对话框「运行内置测试」加载）
  description: "列出应用项目内已写入的全部文件。",
  schema: {
    appName: { type: "string" },
  },
  async exec({ appName }, ctx) {
    const files = await listAppFiles(ctx.fs, appName, ctx.rootHandle);
    return files.length ? files.join("\n") : "（应用还没有文件）";
  },
};
