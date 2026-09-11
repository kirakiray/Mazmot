// 视觉交互工具包的组件测试基座（被各工具包目录下的 self-test.js 引用）
//
// 包内 self-test.js 用 defineVisualSelfTest({...}) 声明用例，基座统一负责：
//   - testPlan 导出（宿主对话框在运行前渲染「待测 list」）
//   - onCase 逐条回调 + 每条断言后 100ms 节奏（对话框测试 iframe 实时逐条打勾）
//   - 运行环境守卫：componentReady 标记视觉组件 / senti 控件是否就绪，
//     未就绪时组件类用例由包自行记一条「跳过」占位（保持与计划对齐）
//   - 组件挂载台 bench：挂载被测组件（ofa 代理读写 data / 调 proto 方法、
//     shadow 查询、监听冒泡事件），用例间可卸载，测试结束统一清理
//
// 用法（包内 self-test.js）：
//   export default defineVisualSelfTest({
//     tag: "my-card",                       // 被测组件标签
//     requiredTags: ["st-input", ...],      // 组件类用例依赖的控件
//     plan: testPlan.map((name) => ({ name })),
//     async run(kit) {                      // kit = { wait, componentReady, check, mount }
//       await kit.check("用例名", 条件, 说明);
//       if (!kit.componentReady) return;    // 纯模块环境：组件用例跳过
//       const b = await kit.mount();
//       b.feed({ spec }, "applySpec");      // 命令式喂数据 + 补渲染
//       b.q("input");                       // shadow 查询
//       ...
//       await kit.check(...);
//       b.remove();
//     },
//   });
//   export const testPlan = ...; export const runSelfTest = ...;
// 消费方：宿主对话框「内置测试」Tab（runSelfTest + testPlan）与包内 sb.html。

export function defineVisualSelfTest({ tag, requiredTags = [], plan = [], run }) {
  return {
    testPlan: plan.map((p) => p.name),

    async runSelfTest(onCase) {
      const cases = [];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const componentReady =
        typeof customElements !== "undefined" &&
        !!customElements.get(tag) &&
        requiredTags.every((t) => !!customElements.get(t));

      let host = null;
      const kit = {
        wait,
        componentReady,

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

        // 组件挂载台：挂一个被测组件实例，返回 ofa 代理与查询/卸载句柄。
        // feed 解决「外部属性赋值不触发 watch」的缺口（生产路径是 :prop
        // 声明式绑定触发），renderMethod 由组件 proto 提供同款补渲染。
        async mount() {
          if (!host) {
            host = document.createElement("div");
            document.body.appendChild(host);
          }
          const ele = document.createElement(tag);
          host.appendChild(ele);
          await wait(200); // 等组件初始化
          const $ele = window.$(ele);
          return {
            ele,
            $: $ele, // ofa 代理：读写 data、调 proto 方法
            // shadow 内查询（原生句柄）
            q: (sel) => ele.shadowRoot?.querySelector(sel),
            qa: (sel) => [...(ele.shadowRoot?.querySelectorAll(sel) || [])],
            // 监听从组件冒泡出来的事件（bubbles + composed）
            on(name, fn) {
              host.addEventListener(name, fn);
            },
            // 调用组件 proto 方法（带参调用：方法内的 this 未必能读到
            // 刚通过代理赋值的 data，数据一律走参数传递）
            call(method, ...args) {
              return $ele[method](...args);
            },
            remove() {
              ele.remove();
            },
          };
        },
      };

      try {
        await run(kit);
      } finally {
        host?.remove();
      }
      return { ok: cases.every((c) => c.pass), cases };
    },
  };
}
