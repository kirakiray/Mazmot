// 通用（非视觉）工具包的内置测试基座 —— defineSelfTest
//
// 与 visual-test-kit.js 的 defineVisualSelfTest 同一套消费约定，只是 kit 里
// 没有组件挂载 / 环境守卫（纯插件工具不需要）。包内 self-test.js 用法：
//
//   import { defineSelfTest } from "../../test-space/self-test-kit.js";
//   const t = defineSelfTest({
//     plan: testPlan.map((name) => ({ name })),
//     async run(kit) {
//       await kit.check("用例名", 条件, 说明);
//     },
//   });
//   export const runSelfTest = t.runSelfTest;
//   export { testPlan };
//
// 统一负责：testPlan 导出（对话框运行前渲染「待测 list」）、onCase 逐条回调
// + 每条断言后 100ms 节奏（对话框测试 iframe 实时逐条打勾）。
// 需要虚拟空间（内存 fs / storage）的用例从 ./virtual-space.js 取。

export function defineSelfTest({ plan = [], run }) {
  return {
    testPlan: plan.map((p) => p.name),

    async runSelfTest(onCase) {
      const cases = [];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const kit = {
        wait,

        // 记录一条断言：逐条回调 + 100ms 节奏（逐条打勾的间隔来源）
        async check(name, pass, info) {
          const item = {
            name,
            pass: !!pass,
            info:
              info === undefined ? (pass ? "通过" : "断言未通过") : String(info),
          };
          cases.push(item);
          onCase?.(item);
          await wait(100);
          return item;
        },
      };
      await run(kit);
      return { ok: cases.every((c) => c.pass), cases };
    },
  };
}
