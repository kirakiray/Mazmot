# 001 · preview 里向 senti-ui 输入框打字必须选中宿主标签，不能穿透到内部原生 input

**症状**：用 preview 的 `action=type` 给 `st-input` 输入文字时，写 `selector: "st-input input"`（想直接定位组件 shadow 里的原生 `<input>`）直接失败：`Error: 找不到元素: st-input input`，打字操作完全没法做，看起来像输入框不可输入。

**根因**：preview 的深度选择器匹配的是**单个元素的标签/类名链**，不做 shadow 内部的「后代组合器」匹配；`st-input input` 这种跨 shadow 边界的后代选择器解析不出来。senti-ui 组件的 `value` 已经是反射到宿主的运行时状态（`el.value` 可读写、`e.target.value` 可用），所以根本不需要碰内部原生 input。

**正确姿势**：
- `action=type` 时 `selector` 只写宿主标签：`{ selector: "st-input", text: "小明" }`，preview 会聚焦宿主并把值写进 value property、派发 `input`/`change`，页面里 `e.target.value` 能正常拿到值（本应用实测输入「小美」→ 问候语立刻更新）。
- 同理，`action=click` 点按钮写 `st-button` 即可（返回信息里会带 `text` 便于确认点对了哪个）。
- 需要在组件内部做断言时才用 `eval` + `$$deep('st-input')` 再到 `.shadowRoot.querySelector('input')` 读内部状态。
