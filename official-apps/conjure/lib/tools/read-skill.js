// 工具插件：read_skill
// 读取框架知识库文档（lib/skills/ 下的技能）。编写 ofa.js 模板 / senti-ui 组件前
// 先查文档拿准确语法，而不是凭模型记忆。
// 依赖注入：ctx = { fs, rootHandle, onAppCreated, onFileWrite, readSkill }
export default {
  key: "readSkill",
  name: "read_skill",
  description:
    "读取框架知识库文档。编写或修改 ofa.js 页面模板、使用 senti-ui 组件之前，必须先读对应技能的 SKILL.md 获取准确语法与组件 API，再按文中引用的 references/xxx.md 深入查阅。",
  schema: {
    skill: {
      type: "string",
      description: "技能 id，如 ofajs-docs / senti-ui",
    },
    path: {
      type: "string",
      description: "技能内文档相对路径，默认 SKILL.md，如 references/components/tabs.md",
      optional: true,
    },
  },
  async exec({ skill, path }, ctx) {
    if (typeof ctx.readSkill !== "function") {
      return "知识库不可用（宿主未注入读取函数）";
    }
    return await ctx.readSkill(skill, path);
  },
};
