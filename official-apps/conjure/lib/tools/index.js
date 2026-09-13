// 工具插件注册中心
// 每个工具是 lib/tools/ 下的一个独立插件文件，默认导出：
//   { key, name, description, schema, exec(args, ctx) }
// ctx 由调用方注入：{ fs, rootHandle, onAppCreated, onFileWrite, readSkill,
//   requestForm, openPreview, previewDebug, onPreviewShot }
//
// 新增工具：在 lib/tools/ 下建 <tool-name>.js 插件文件，
// 然后在下方 import 并加入 TOOL_DEFS 即可（无需改动页面或 builder.js）。

import createApp from "./create-app.js";
import writeFile from "./write-file.js";
import readFile from "./read-file.js";
import listFiles from "./list-files.js";
import readSkill from "./read-skill.js";
import showForm from "./show-form/index.js";
import preview from "./preview-debug.js";

export const TOOL_DEFS = [
  createApp,
  writeFile,
  readFile,
  listFiles,
  readSkill,
  showForm,
  preview,
];

// 视觉交互工具包（目录式包）的约定：包内 index.js 导出
//   visual   —— 配套视觉组件模块地址（下方聚合为 visualModules，宿主页面预载）
//   selfTest —— 内置测试模组地址（工具详情对话框「运行内置测试」加载执行）
// 宿主页面预载后，对应的自定义元素（如 <show-form-card>）才可用
export const visualModules = TOOL_DEFS.map((d) => d.visual).filter(Boolean);

/**
 * 用 chain 层的 `tool` 工厂把插件定义包装成 Agent 可用工具。
 * @param {Object} opts
 * @param {Object} opts.tool /mz/ai/chain/main.js 的 tool 工厂
 * @param {Object} opts.fs /nos/fs/main.js 模块
 * @param {Object} [opts.rootHandle] 本地目录渠道的应用根目录句柄；缺省写 VFS ai-apps/
 * @param {Function} [opts.onAppCreated] create_app 成功回调
 * @param {Function} [opts.onFileWrite] write_file 成功回调
 * @param {Function} [opts.readSkill] 技能文档读取函数 (id, path) => Promise<string>
 * @param {Function} [opts.requestForm] 视觉交互表单（show_form）：渲染表单卡片并等待用户提交，resolve 用户数据
 * @param {Function} [opts.openPreview] preview 工具（action=app）：推送应用到隔离预览窗口
 * @param {Function} [opts.previewDebug] preview 工具的调试指令通道 (cmd, args, timeoutMs) => outcome
 * @param {Function} [opts.onPreviewShot] preview 工具（action=screenshot）：把截图 dataUrl 展示为聊天图片卡片
 * @returns {Object<string, Object>} 按 key 索引的工具映射
 */
export function createTools({
  tool,
  fs,
  rootHandle,
  onAppCreated,
  onFileWrite,
  readSkill,
  requestForm,
  openPreview,
  previewDebug,
  onPreviewShot,
}) {
  const ctx = {
    fs,
    rootHandle,
    onAppCreated,
    onFileWrite,
    readSkill,
    requestForm,
    openPreview,
    previewDebug,
    onPreviewShot,
  };
  const tools = {};
  for (const def of TOOL_DEFS) {
    tools[def.key] = tool(
      (args) => def.exec(args, ctx),
      { name: def.name, description: def.description, schema: def.schema },
    );
  }
  return tools;
}

/** 工具名列表（UI 展示 / 调试用） */
export function toolNames() {
  return TOOL_DEFS.map((d) => d.name);
}
