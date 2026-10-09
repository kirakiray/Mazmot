# 008 · 实测 `st-button` 时必须点到它的内部原生 button，点宿主元素（或程序 `host.click()`）不触发绑定

## 症状

改造侧栏时新增了 `on:click="openAddGroup"` 的「＋ 新建分组」按钮（`st-button`），用 `preview action=click` 点 `.add-group-btn` 后：

- 工具返回「clicked: ST-BUTTON」（看起来点击成功了），但**弹窗没打开**；
- 紧接着用 `preview eval` 跑 `root.querySelector('.add-group-btn').click()` 和 `[...root.querySelectorAll('.side st-button')].forEach(b => b.click())`，**同样没有反应**；
- `[...root.querySelectorAll('st-dialog')].map(d => d.hasAttribute('open'))` 全是 `false`，控制台也没有任何报错——表现极像「事件绑定写错了 / `$host` 不可用」。
- 但同样写法的其它按钮（筛选、添加任务、侧栏分组项）此前实测都是正常的，说明**绑定本身没问题**。

## 根因

`st-button` 是自定义元素：它内部渲染一个原生 `<button class="native">`，用户真实点击打的是**内层原生 button**，事件再冒泡到宿主 `<st-button>`。而程序化的 `host.click()`（以及工具的深度选择器命中宿主时的点击）只在**宿主元素**上派发 click，虽然宿主自己会收到（实测宿主上的原生监听器能收到 `host-click`），但组件内部用于对外抛点击的机制并不响应这种「只打宿主」的合成点击，于是 `on:click` 绑定的页面方法不会被调用。

## 正确姿势

- 实测 `st-button` / `st-icon-button` 等自定义按钮时，**选择器要落到内部原生按钮**：`preview eval` 里用 `btn.shadowRoot.querySelector('button').click()`；`preview action=click` 也应尽量选到内层（如取到内层元素的选择器/坐标）。
- 判定「按钮点击失效」之前，先验证一次「真实点击路径能不能走通」：若内层 button 点击后行为正常，就不要再去改模板绑定——**问题在测试手法，不在代码**。
- 反向推论：如果内层 button 点击也没反应，才是真·绑定问题（对照踩坑 003：`function "xxx" not found` 要读控制台确认）。
- `st-input` 同理：`sync:value` 依赖原生 input 的 `input`/`change` 事件，程序化测输入要 `input.shadowRoot.querySelector('input')` 上设 `value` 后派发 `new Event('input', { bubbles: true })`（回车提交再补一个 `change`），不要直接给宿主赋值。
