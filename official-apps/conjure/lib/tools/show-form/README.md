# show_form（视觉交互工具包）

目录即独立包：Agent 可调用的「表单类视觉交互工具」，模型传入表单规范，在对话中渲染一张可交互的表单卡片，用户填写提交后数据以 JSON 交回模型继续处理。

## 文件

- `index.js` — 工具插件（默认导出 `{ key, name, tags, description, schema, exec }`）；`exec` 做参数清洗，经 `ctx.requestForm(spec)` 挂起等待用户提交，返回 `{"data":{...}}` 或 `{"cancelled":true}`。
- `form-card.html` — ofa.js 视觉组件模块（`<show-form-card>`）。渲染表单卡片（pending 可编辑；submitted / cancelled / expired 只读回填），收集输入、required 校验，提交数据经 `form-submit` 事件（bubbles + composed）冒泡给宿主页面。
- `self-test.js` — 内置测试模组，导出 `runSelfTest()` 返回 `{ ok, cases: [{ name, pass, info }] }`。覆盖插件层（包结构 / 参数清洗 / 提交 / 取消 / 环境兜底）与组件层（控件渲染 / required 拦截 / 事件冒泡 / 只读回填 / XSS 转义；组件未预载的环境自动跳过）。
- `test/show-form.sb.html` — 包的 sibyl-test 测试：直接跑 `runSelfTest()` 断言（纯模块环境 + 预载组件环境各一轮）。

插件额外导出两个地址属性：`visual`（form-card.html，由 `lib/tools/index.js` 聚合为 `visualModules` 供宿主页面预载）、`selfTest`（self-test.js，宿主页工具详情对话框的「运行内置测试」按需加载执行）。

## 数据流

```
模型调用 show_form(spec)
  → builder-store requestForm：推送 type:"form" 消息（卡片挂起本回合）
  → 用户在 <show-form-card> 填写 → 点「提交」（required 校验）
  → form-submit 事件 → 页面 onFormSubmit → store.submitForm(msgId, values)
  → 数据 patch 回消息（随会话桶持久化，历史只读回填）并 resolve 给工具
  → exec 返回 {"data":{...}} JSON 给模型继续
```

新增其他视觉交互工具（如画布、清单勾选）时照此结构建包：插件导出 `visual` 与 `selfTest` 指向配套组件与内置测试模组，`index.js` 会自动聚合预载，工具详情对话框自动出现「运行内置测试」入口。
