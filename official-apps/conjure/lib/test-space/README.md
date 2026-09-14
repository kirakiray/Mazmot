# test-space — conjure 工具包测试基建（统一测试空间）

> 给谁看：人类开发者和 AI 代理。任何「给 Agent 新增工具 / 写工具内置测试」的任务，都需要按本文件的约定取用测试基建；**需要虚拟空间（内存文件系统 / 存储）的测试一律从这里拿 fake，禁止在测试文件内再造内联 fake**。

## 包结构（lib/tools/<tool>/ 与测试的关系）

每个工具是 `lib/tools/` 下的一个独立包目录：

```
lib/tools/<tool>/
├── index.js       # 工具插件（默认导出 { key, name, description, schema, exec }）
│                  # 具名导出 selfTest = new URL("./self-test.js", import.meta.url).href
│                  # 视觉工具另导出 visual（组件模块地址）与 tags（面板徽标）
├── self-test.js   # 内置测试模组：导出 testPlan（用例名清单）与 runSelfTest(onCase)
├── README.md      # 包说明（数据流 / 依赖注入）
└── test/<tool>.sb.html  # 包的 sibyl-test 测试（跑 runSelfTest + 导出约定断言）
```

`lib/tools/index.js` 聚合各包默认导出为 `TOOL_DEFS`，`selfTest` 地址被工具详情对话框消费：**任何带 `selfTest` 的工具（视觉或纯插件）都自动获得「工具信息 / 内置测试」双 Tab**，运行前渲染待测 list、运行时逐条打勾。

## 三个模块

| 模块 | 给谁用 | 提供 |
|------|--------|------|
| `self-test-kit.js` | 纯插件工具包的 self-test.js | `defineSelfTest({ plan, run })`：kit = `{ wait, check }` |
| `visual-test-kit.js` | 视觉交互工具包的 self-test.js | `defineVisualSelfTest({ tag, requiredTags, plan, run })`：kit 再加 `{ componentReady, mount }`（内部复用 defineSelfTest，断言节奏 / 回调语义完全一致） |
| `virtual-space.js` | 所有需要 fake fs / storage 的测试（工具 self-test、包 sb.html、应用级 test/*.sb.html） | `createVirtualFs()`（内存 /nos/fs：init/get 按命名空间隔离）、`createVirtualDir()`（独立目录句柄，当 rootHandle 用）、`createVirtualStorage(entries)`（内存键值存储）、`seedVirtualFiles(dir, files)`、`readVirtualFile(dir, path)`、`listVirtualPaths(dir)` |

## defineSelfTest / kit API（两套基座通用部分）

```js
import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_ONE = "用例一"; // 用例名常量，plan 与 run() 里的 check() 共用，避免两处漂移
const testPlan = [N_ONE];

const t = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),
  async run(kit) {
    const plugin = (await import(new URL("./index.js", import.meta.url).href)).default;
    await kit.check(N_ONE, plugin.name === "xxx", plugin.name);
  },
});
export const runSelfTest = t.runSelfTest;
export { testPlan };
```

| API | 作用 |
|-----|------|
| `await kit.check(name, pass, info?)` | 记录一条断言：推入结果、回调 `onCase`、停 100ms。`pass` 为真打 ✓，否则 ✗（info 展示在断言行上） |
| `await kit.wait(ms)` | 等待 |

## defineVisualSelfTest 追加的 kit API

| API | 作用 |
|-----|------|
| `kit.componentReady` | 布尔。`false` 表示被测组件或依赖控件未注册（sb-test 纯模块环境），组件类用例应跳过并 `check(name, true, "跳过：...")` 占位一条 |
| `await kit.mount()` | 挂载一个被测组件实例（`<tag>` 元素挂到隐藏容器），等 200ms 初始化后**直接返回它的 ofa.js 实例**，用例随意操作；测试结束基座统一清理 |

### mount() 返回的 ofa 实例怎么用

```js
const b = await kit.mount();
b.applySpec({ title: "示例", status: "pending", fields: [...] }); // 调 proto 方法（数据走参数！）
const input = b.shadow.$('st-input[name="who"]')?.ele;            // shadow 内查询（.ele 拿原生节点）
b.on("form-submit", (e) => (fired = e.data));                     // 监听冒泡出来的事件
b.remove();                                                       // 该用例结束，卸载实例
```

### 必须知道的两个 ofa.js 坑（写视觉用例前必读）

1. **外部属性赋值不触发组件 `watch`**。生产路径是声明式绑定（`:spec="xxx"`）触发；测试 / 演示脚本是命令式喂值。约定：组件 proto 提供一个 `applyXxx(data)` 方法（设 data + 按 watch 同款逻辑补渲染），测试直接 `b.applyXxx(data)` 调它。
2. **proto 方法要带参调用：方法内的 `this` 读不到刚通过实例赋值的 data**（读到的是默认值）。所以 `applyXxx(spec)` 的数据必须走参数，不要在方法里读 `this.xxx` 当输入。

## virtual-space 关键行为（对齐 NoneOS Core / lib/builder.js 的真实用法）

- `dir.get(path, opts)` 支持**多段路径一次取**；缺失且无 `create` 返回 `null`；`{ create: "file" }` 只作用于最后一段，**中间目录隐式创建**（`writeAppFile` 依赖此行为）；`{ create: "dir" }` 作用于最后一段。
- 目录有 `keys()` / `values()` 异步迭代器、`flat()`（全量后代文件，builder 优先用它列举）、`remove()`（递归删自己；根目录则清空子项）；文件有 `text()` / `write(content)`。
- 句柄 `path` 从所属根目录算起（如 `todo-app/client/index.html`），与 Core「flat()/path 可能带命名空间前缀」一致——builder 的 `toRel` 剥前缀逻辑在 fake 上同样成立。
- `createVirtualDir()` 可直接当本地渠道的 `rootHandle`（`ctx.rootHandle`）或测试里 `fs.open()` 的替身。

## 消费方

- **工具详情对话框「内置测试」Tab**（`pages/home.html`）：按插件约定 `selfTest` 地址 `import` 该模组，读 `testPlan` 渲染待测 list，跑 `runSelfTest(onCase)` 逐条打勾（onCase 经 iframe `postMessage` 同步回主页面；视觉工具 iframe 内实时挂载被测组件，纯插件工具右侧显示断言运行记录）。
- **包内 `test/<tool>.sb.html`**：直接 `import { runSelfTest }` 断言结果（视觉包另有「预载组件后完整跑」的用例）。
- **应用级 `test/*.sb.html`**：builder / store 层测试从这里拿虚拟空间，不再内联 fake。

## 约定速查（AI 代理必读）

- 新增工具 = `lib/tools/<tool>/` 目录包（index.js + self-test.js + README.md + test/<tool>.sb.html），在 `lib/tools/index.js` 登记；插件导出 `selfTest` 地址即自动获得对话框「内置测试」Tab。
- 用例名 = `testPlan` 项 = `check()` 的 name，三者必须一字不差（用常量引用，不要复制字符串）。
- 每条断言之间不要自己加延时——基座的 `check` 已固定 100ms 节奏。
- 需要 fake fs / storage 的用例一律 `import` 本目录 `virtual-space.js`，不要内联再造。
