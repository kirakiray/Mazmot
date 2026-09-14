// 工具插件包：read_file
// 读取应用项目内已有文件的内容（用于迭代修改前查看）。
// 依赖注入：ctx = { fs, rootHandle }
import { readAppFile } from "../../builder.js";

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "readFile",
  name: "read_file",
  selfTest, // 内置测试模组地址（工具详情对话框「运行内置测试」加载）
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
