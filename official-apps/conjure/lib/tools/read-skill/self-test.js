// read_skill 包的内置测试模组（纯插件层：ctx.readSkill 用 fake 替身）
// 基座用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_UNAVAILABLE = "宿主未注入 readSkill 时返回可读提示";
const N_DELEGATE = "参数透传（skill / path 原样交给 readSkill）且返回值透传";
const N_PATH_DEFAULT = "path 缺省时传 undefined（默认 SKILL.md 由读取层处理）";
const N_HINT_PASSTHROUGH = "读取层的提示文案（如「技能未安装」）原样透传";

const testPlan = [
  N_SHAPE,
  N_UNAVAILABLE,
  N_DELEGATE,
  N_PATH_DEFAULT,
  N_HINT_PASSTHROUGH,
];

const readSkillTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "readSkill" &&
        plugin.name === "read_skill" &&
        !!plugin.description &&
        !!plugin.schema?.skill &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const unavailable = await plugin.exec(
      { skill: "ofajs-docs", path: "SKILL.md" },
      {},
    );
    await check(
      N_UNAVAILABLE,
      unavailable === "知识库不可用（宿主未注入读取函数）",
      unavailable,
    );

    // 参数与返回值透传
    let received = null;
    const res = await plugin.exec(
      { skill: "ofajs-docs", path: "references/api.md" },
      {
        readSkill: async (skill, path) => {
          received = { skill, path };
          return "# API 文档";
        },
      },
    );
    await check(
      N_DELEGATE,
      received?.skill === "ofajs-docs" &&
        received?.path === "references/api.md" &&
        res === "# API 文档",
      `received=${JSON.stringify(received)} res=${res}`,
    );

    // path 缺省 → undefined（读取层负责默认到 SKILL.md）
    let received2 = "not-called";
    await plugin.exec(
      { skill: "senti-ui" },
      {
        readSkill: async (skill, path) => {
          received2 = path;
          return "ok";
        },
      },
    );
    await check(N_PATH_DEFAULT, received2 === undefined, String(received2));

    // 读取层的可读提示（技能未安装清单）原样透传，插件不包装
    const hint = await plugin.exec(
      { skill: "ghost" },
      {
        readSkill: async () =>
          "技能未安装：ghost。可用：ofajs-docs、senti-ui",
      },
    );
    await check(
      N_HINT_PASSTHROUGH,
      hint === "技能未安装：ghost。可用：ofajs-docs、senti-ui",
      hint,
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = readSkillTest.runSelfTest;
export { testPlan };
