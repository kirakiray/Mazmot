# show_form（视觉交互工具包）

目录即独立包：Agent 可调用的「表单类视觉交互工具」，模型传入表单规范，在对话中渲染一张可交互的表单卡片，用户填写提交后数据以 JSON 交回模型继续处理。

## 文件

- `index.js` — 工具插件（默认导出 `{ key, name, tags, description, schema, exec }`）；`exec` 做参数清洗，经 `ctx.requestForm(spec)` 挂起等待用户提交，返回 `{"data":{...}}` 或 `{"cancelled":true}`。
- `form-card.html` — ofa.js 视觉组件模块（`<show-form-card>`）。渲染表单卡片（pending 可编辑；submitted / cancelled / expired 只读回填），收集输入、required 校验，提交数据经 `form-submit` 事件（bubbles + composed）冒泡给宿主页面。
- 插件导出 `visual`（form-card.html 的模块地址），由 `lib/tools/index.js` 聚合为 `visualModules`，宿主页面（`pages/home.html`）预载后自定义元素才可用。

## 数据流

```
模型调用 show_form(spec)
  → builder-store requestForm：推送 type:"form" 消息（卡片挂起本回合）
  → 用户在 <show-form-card> 填写 → 点「提交」（required 校验）
  → form-submit 事件 → 页面 onFormSubmit → store.submitForm(msgId, values)
  → 数据 patch 回消息（随会话桶持久化，历史只读回填）并 resolve 给工具
  → exec 返回 {"data":{...}} JSON 给模型继续
```

新增其他视觉交互工具（如画布、清单勾选）时照此结构建包：插件导出 `visual` 指向配套组件模块，`index.js` 会自动聚合预载。
