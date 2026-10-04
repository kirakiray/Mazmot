// 工具插件包：edit_file
// 对已有文件做差量编辑（old_string → new_string 字面量替换，一次可多处）。
// 相比 write_file 整文件重写：省 token、不动未提及的部分、防回归。修改
// 已有应用的首选；新建文件 / 整体重构仍用 write_file。
// 依赖注入：ctx = { fs, rootHandle, onFileWrite }

import { editAppFile } from "../../builder.js";

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "editFile",
  name: "edit_file",
  selfTest,
  description:
    "差量编辑一个已有文件：edits 数组逐条应用（old_string → new_string 字面量替换）。old_string 必须与文件原文完全一致（含空格缩进换行）且唯一命中——找不到或多处命中都会报错，此时先 read_file 读取当前内容再按原文引用，或扩大上下文使其唯一，或对该条设 replace_all: true。修改已有应用优先用本工具（省 token、不碰未提及内容）；新建文件与整体重写用 write_file。",
  schema: {
    appName: { type: "string", description: "create_app 时确定的应用名" },
    path: { type: "string", description: "相对 client/ 的已有文件路径" },
    edits: {
      type: "array",
      description:
        '编辑条目数组，如 [{ "old_string": "旧代码片段", "new_string": "新代码片段", "replace_all": false }]；replace_all 可选，默认 false',
    },
  },
  async exec({ appName, path, edits }, ctx) {
    try {
      const r = await editAppFile(ctx.fs, appName, path, edits, ctx.rootHandle);
      ctx.onFileWrite?.({
        appName: r.name,
        path: r.path,
        bytes: r.bytes,
        op: "edit",
        applied: r.applied,
        prevText: r.prevText,
        nextText: r.nextText,
      });
      // 回报里带关键摘要，模型可自查替换结果是否符合预期
      const preview =
        r.nextText.length > 400
          ? r.nextText.slice(0, 200) + "\n…\n" + r.nextText.slice(-160)
          : r.nextText;
      return `已编辑 ${r.path}（应用 ${r.applied} 处修改，文件现 ${r.bytes} 字节）。当前文件内容：\n${preview}`;
    } catch (err) {
      return `编辑失败：${err.message}`;
    }
  },
};
