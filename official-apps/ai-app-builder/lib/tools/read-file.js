// 工具插件：read_file
// 读取应用项目内已有文件的内容（用于迭代修改前查看）。
// 依赖注入：ctx = { fs, rootHandle }
import { readAppFile } from "../builder.js";

export default {
  key: "readFile",
  name: "read_file",
  description: "读取应用项目内已有文件的内容（用于迭代修改前查看）。",
  schema: {
    appName: { type: "string" },
    path: { type: "string" },
  },
  async exec({ appName, path }, ctx) {
    const text = await readAppFile(ctx.fs, appName, path, ctx.rootHandle);
    return text === null ? `文件不存在：${path}` : text;
  },
};
