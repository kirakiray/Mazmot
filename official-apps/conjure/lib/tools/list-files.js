// 工具插件：list_files
// 列出应用项目内已写入的全部文件。
// 依赖注入：ctx = { fs, rootHandle }
import { listAppFiles } from "../builder.js";

export default {
  key: "listFiles",
  name: "list_files",
  description: "列出应用项目内已写入的全部文件。",
  schema: {
    appName: { type: "string" },
  },
  async exec({ appName }, ctx) {
    const files = await listAppFiles(ctx.fs, appName, ctx.rootHandle);
    return files.length ? files.join("\n") : "（应用还没有文件）";
  },
};
