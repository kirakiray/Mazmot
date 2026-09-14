// 工具插件包：create_app
// 生成一个新应用前必须先调用：创建 <name>/client/ 载体目录并写入 app.json。
// 依赖注入：ctx = { fs, rootHandle, onAppCreated }
import { createAppDir } from "../../builder.js";

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "createApp",
  name: "create_app",
  selfTest, // 内置测试模组地址（工具详情对话框「运行内置测试」加载）
  description:
    "生成一个新应用前必须先调用它：创建应用目录并写入 app.json。name 用小写英文短横线命名（如 todo-app）。",
  schema: {
    name: { type: "string", description: "应用标识，小写字母/数字/-" },
    displayName: { type: "string", description: "应用展示名" },
    description: { type: "string", description: "应用一句话描述" },
    icon: { type: "string", description: "一个 emoji 图标", optional: true },
  },
  async exec({ name, displayName, description, icon }, ctx) {
    try {
      const app = await createAppDir(
        ctx.fs,
        { name, displayName, description, icon },
        ctx.rootHandle,
      );
      ctx.onAppCreated?.({
        appName: app.name,
        displayName: app.displayName,
        icon: icon || "📦",
      });
      return `应用已创建：${app.name}（后续文件用 write_file 写入，路径相对 client/ 目录）`;
    } catch (err) {
      return `创建失败：${err.message}`;
    }
  },
};
