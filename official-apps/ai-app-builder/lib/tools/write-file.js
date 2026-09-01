// 工具插件：write_file
// 把一个 UTF-8 文本文件写入指定应用的项目根目录，路径如 pages/home.html。
// 依赖注入：ctx = { fs, rootHandle, onFileWrite }
import { writeAppFile } from "../builder.js";

export default {
  key: "writeFile",
  name: "write_file",
  description:
    "把一个 UTF-8 文本文件写入指定应用的项目根目录，路径如 pages/home.html。可覆盖重写以迭代修改。",
  schema: {
    appName: { type: "string", description: "create_app 时确定的应用名" },
    path: { type: "string", description: "相对 client/ 的文件路径" },
    content: { type: "string", description: "完整文件内容" },
  },
  async exec({ appName, path, content }, ctx) {
    try {
      const r = await writeAppFile(ctx.fs, appName, path, content, ctx.rootHandle);
      ctx.onFileWrite?.({ appName, path: r.path, bytes: r.bytes });
      return `已写入 ${r.path}（${r.bytes} 字节）`;
    } catch (err) {
      return `写入失败：${err.message}`;
    }
  },
};
