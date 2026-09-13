// 视觉交互工具包的组件测试基座 —— defineVisualSelfTest
//
// 在通用基座 defineSelfTest（./self-test-kit.js，负责 testPlan 导出、onCase
// 逐条回调 + 100ms 节奏）之上，追加视觉包特有的两件事：
//   - 运行环境守卫：componentReady 标记视觉组件 / senti 控件是否就绪，
//     未就绪时组件类用例由包自行记一条「跳过」占位（保持与计划对齐）
//   - 组件挂载台 bench：mount() 直接返回被测组件的 ofa.js 实例（挂到隐藏
//     容器、等初始化），用例用 ofa 自带能力随意操作，测试结束统一清理
//
// 用法（包内 self-test.js）：
//   export default defineVisualSelfTest({
//     tag: "my-card",                       // 被测组件标签
//     requiredTags: ["st-input", ...],      // 组件类用例依赖的控件
//     plan: testPlan.map((name) => ({ name })),
//     async run(kit) {                      // kit = { wait, check, componentReady, mount }
//       await kit.check("用例名", 条件, 说明);
//       if (!kit.componentReady) return;    // 纯模块环境：组件用例跳过
//       const b = await kit.mount();
//       b.applySpec({ spec });               // 调 proto 方法（数据走参数）
//       ...
//       b.remove();
//     },
//   });
//   export const testPlan = ...; export const runSelfTest = ...;
// 消费方：宿主对话框「内置测试」Tab（runSelfTest + testPlan）与包内 sb.html。

import { defineSelfTest } from "./self-test-kit.js";

export function defineVisualSelfTest({ tag, requiredTags = [], plan = [], run }) {
  let host = null;
  const inner = defineSelfTest({
    plan,
    async run(kit) {
      const componentReady =
        typeof customElements !== "undefined" &&
        !!customElements.get(tag) &&
        requiredTags.every((t) => !!customElements.get(t));

      // 组件挂载台：挂一个被测组件实例，直接返回它的 ofa 实例，
      // 用例自行随意操作（读写 data / 调 proto 方法 / shadow.$ 查询 /
      // .on 监听冒泡事件 / .remove 卸载都是 ofa 自带能力）。
      // 注意：proto 方法要带参调用（applySpec(spec)），方法内的 this
      // 读不到刚通过实例赋值的 data（ofa.js 行为），数据一律走参数。
      const mount = async () => {
        if (!host) {
          host = document.createElement("div");
          document.body.appendChild(host);
        }
        const ele = document.createElement(tag);
        host.appendChild(ele);
        await kit.wait(200); // 等组件初始化
        return window.$(ele);
      };

      await run({ ...kit, componentReady, mount });
    },
  });

  const { runSelfTest: innerRun, testPlan } = inner;
  return {
    testPlan,
    async runSelfTest(onCase) {
      try {
        return await innerRun(onCase);
      } finally {
        host?.remove();
        host = null;
      }
    },
  };
}
