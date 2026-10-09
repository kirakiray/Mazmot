# 010 · `st-menu` 自测的三个错觉：trigger 是 toggle、关着的菜单项照样能点、悬停显隐在后台标签页量不出来

## 症状

给分组行加 ⋯ 下拉菜单（`st-menu`）后自测，连续几轮得到互相矛盾、看上去「组件有 bug」的结论：

1. **面板时开时不开**：`preview eval` 里 `trigger.shadowRoot.querySelector('button').click()` 之后测 `st-menu-item` 的 rect，第一次拿到 90×37（开了），第二次却全是 0（关了）——像是开合不稳定。
2. **菜单没打开，但点菜单项居然生效**：面板明明是关的（菜单项 rect 0×0），`item.click()` 仍能把改名弹窗打开，于是误判「菜单项不依赖面板」或「点击穿透」。
3. **悬停显隐完全量不出来**：写了 `.gitem:hover .gmenu { opacity: 1 }`，点完 trigger 后量 `.gmenu` 的 `computedStyle.opacity` 始终是 `0`，像悬停样式没生效。
4. 用 `menu.hasAttribute('open')` 判断开合永远是 `false`，而面板其实已经显示。

## 根因

- **trigger 是 toggle**：`st-menu` 的 `.trigger` 监听 click 执行 `this.open = !this.open`。自测时「点一次量一次」很容易累积成偶数次点击 → 每次都回到关闭态，于是看起来「时开时不开」。并不是随机 bug。
- **关着的菜单项仍在 light DOM 里**：面板是 shadow DOM 里的 `div.panel`，关闭时用 `display: none` 隐藏，**`st-menu-item` 本体一直留在 light DOM**。用 `item.click()`（或工具的元素点击）绕过面板状态直接派发 click，处理函数照样执行——所以「面板没开也能点生效」是正常的，**不能用它证明面板打开**。
- **`open` 是 ofa 的 data，不是标签属性**：`menu.open` 才是运行时状态（`hasAttribute('open')` 恒为 false）；面板是否可见要看 shadowRoot 里 `.panel` 的 `display` / 菜单项 rect。
- **后台标签页不更新 `:hover`**：预览窗口在后台时，浏览器不会更新指针悬停状态（同「弹窗动画被冻结」的成因，见 004），所以 `:hover` 触发的一切（透明淡入、hover 态样式）都无法在预览里量到——**只能靠代码审查 + 用户在前台用鼠标确认**，不要因为量不出来就反复改代码。

## 正确姿势

- 自测开合：**一次 eval 内「先量关闭态 → 点一次 trigger → 等 400ms → 再量」**，并记录点击次数为奇数；判断打开用菜单项 rect 是否非 0（或 shadow 里 `.panel` 的 `display`），**不要**用 `hasAttribute('open')` / `item.click()` 的结果。
- 点菜单项时**确认面板此刻是开的**再断言效果，避免「关着也生效」把结论带偏。
- 顺带一条：`st-dialog` 的 `open` 同样是 ofa data（见 007），两个组件都别用 `hasAttribute('open')` 判运行时开合。
- 悬停显隐这类纯 `:hover` 行为，在预览通道里**承认量不到**，改动时（a）保证有 `@media (hover: none)` 兜底让触屏始终可见、（b）用「选择器确实命中」的旁证（如 em 尺寸生效：`.gmenu { font-size: 12px }` → 按钮 34.3px）证明样式路径通、（c）如实告诉用户需要他本人用鼠标确认。
