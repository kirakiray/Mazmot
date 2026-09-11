# visual-test-kit — 视觉交互工具的组件测试基座

> 给谁看：人类开发者和 AI 代理。任何「给 Agent 新增视觉交互工具（带可交互 UI 组件的工具包）」的任务，都需要按本文件的约定编写其内置测试模组。

## 它解决什么问题

`official-apps/conjure` 里，视觉交互工具（如 `lib/tools/show-form/`）的目录结构是「工具插件 + ofa.js 视觉组件 + 内置测试模组 `self-test.js`」。每个包的 `self-test.js` 都要做同一堆样板事：

1. 导出 `testPlan`（用例名清单）——工具详情对话框在运行前用它渲染「待测 list」；
2. 导出 `runSelfTest(onCase)`——对话框的测试 iframe 实际执行它，每完成一条断言就回调 `onCase`（左列逐条打勾）+ 停 100ms（可感知的逐条节奏）；
3. 环境守卫——被测视觉组件 / senti-ui 控件未注册的环境（sb-test 纯模块环境）下，组件类用例记一条「跳过」占位；
4. 组件挂载台——创建被测组件、ofa 代理读写、shadow DOM 查询、监听冒泡事件、用例间卸载、结束清理。

`defineVisualSelfTest` 把 1–4 全部收编，包内 self-test.js **只写用例本身**。

## API

```js
import { defineVisualSelfTest } from "../visual-test-kit.js"; // 相对包目录的路径

export default defineVisualSelfTest({
  // 被测视觉组件的自定义元素标签（<template component> 的 tag）
  tag: "my-card",
  // 组件类用例依赖的 senti-ui 控件标签；任一未注册时 componentReady = false
  requiredTags: ["st-input", "st-select"],
  // 用例名清单（顺序即执行顺序），运行前渲染待测 list 用
  plan: [{ name: "用例一" }, { name: "用例二" }],
  // 用例本体：依次 kit.check(...)；组件类用例包在 componentReady 分支里
  async run(kit) { /* ... */ },
});
```

### `run(kit)` 里可用的 kit API

| API | 作用 |
|-----|------|
| `await kit.check(name, pass, info?)` | 记录一条断言：推入结果、回调 `onCase`、停 100ms。`pass` 为真打 ✓，否则 ✗（info 展示在断言行上） |
| `kit.componentReady` | 布尔。`false` 表示被测组件或依赖控件未注册（纯模块环境），组件类用例应跳过并 `check(name, true, "跳过：...")` 占位一条 |
| `await kit.mount()` | 挂载一个被测组件实例（`<tag>` 元素挂到隐藏容器），等 200ms 初始化后返回句柄 `b` |
| `await kit.wait(ms)` | 等待 |
| `b.$` | 组件的 ofa 代理：读写 data、调 proto 方法 |
| `b.q(sel)` / `b.qa(sel)` | shadow DOM 内查询单个 / 全部元素（原生句柄） |
| `b.on(event, fn)` | 监听从组件冒泡出来的事件（要求组件 emit 时 `bubbles + composed`） |
| `b.call(method, ...args)` | 调用组件 proto 方法（**数据必须走参数**，原因见下） |
| `b.remove()` | 卸载该实例（一个用例一组实例，用完即卸） |

### 必须知道的两个 ofa.js 坑（基座的 API 就是为此设计的）

1. **外部属性赋值不触发组件 `watch`**。生产路径是声明式绑定（`:spec="xxx"`）触发；测试 / 演示脚本是命令式喂值。约定：组件 proto 提供一个 `applyXxx(data)` 方法（设 data + 按 watch 同款逻辑补渲染），测试通过 `b.call("applyXxx", data)` 走它。
2. **通过 ofa 代理调用 proto 方法时，方法内的 `this` 读不到刚通过代理赋值的 data**（读到的是默认值）。所以数据一律走参数传递：`b.call("applySpec", spec)`，不要依赖 `this.xxx` 读刚赋的值。

## 包内 self-test.js 的标准写法（完整示例）

```js
import { defineVisualSelfTest } from "../visual-test-kit.js";

// 用例名常量，plan 与 run() 里的 check() 共用，避免两处漂移
const N_RENDER = "待填卡片渲染控件";
const N_SUBMIT = "提交冒泡数据";

const testPlan = [N_RENDER, N_SUBMIT];

const myCardTest = defineVisualSelfTest({
  tag: "my-card",
  requiredTags: ["st-input"],
  plan: testPlan.map((name) => ({ name })),
  async run(kit) {
    // 插件层用例（纯 JS）：任何环境都跑
    const plugin = (await import(new URL("./index.js", import.meta.url).href)).default;
    await kit.check("插件结构完整", !!plugin.name && typeof plugin.exec === "function");

    // 组件层用例：环境未就绪时记一条跳过占位（与计划对齐）
    if (!kit.componentReady) {
      await kit.check(N_RENDER, true, "跳过：组件 / 控件未预载");
      return;
    }
    const b = await kit.mount();
    b.call("applySpec", { title: "示例", status: "pending", fields: [] });
    await kit.wait(100);
    await kit.check(N_RENDER, !!b.q(".form-submit"));
    b.remove();
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = myCardTest.runSelfTest;
export { testPlan };
```

## 消费方

- **工具详情对话框「内置测试」Tab**（`pages/home.html`）：按插件约定 `selfTest` 地址 `import` 该模组，读 `testPlan` 渲染待测 list，跑 `runSelfTest(onCase)` 逐条打勾（onCase 经 iframe `postMessage` 同步回主页面）。
- **包内 `test/*.sb.html`**：直接 `import { runSelfTest }` 断言结果；纯模块环境下组件用例自动跳过，另有「预载组件后完整跑」的用例。

## 约定速查（AI 代理必读）

- 新增视觉交互工具包 = 目录内 `index.js`（插件，导出 `visual` + `selfTest` 地址）+ 视觉组件 `.html` + `self-test.js`（用本基座，导出 `testPlan` + `runSelfTest`）+ `test/*.sb.html`。
- 组件 proto 应提供 `applyXxx(data)` 补渲染入口，供测试与演示脚本命令式喂数据。
- 用例名 = `testPlan` 项 = `check()` 的 name，三者必须一字不差（用常量引用，不要复制字符串）。
- 每条断言之间不要自己加延时——基座的 `check` 已固定 100ms 节奏。
