# 009 · `n-icon` 放进 `st-icon-button`：不要给图标写 `width` / `height` / `font-size`，缩放只改外层按钮

## 症状

把 `st-icon-button` 的 emoji 内容换成 `<n-icon icon="mdi:pencil">` 时，若顺手给 `n-icon` 写上尺寸（`width: 22px; height: 22px;` 或 `font-size: 1.2em`）想「调一下图标大小」，会出现：

- 图标**明显溢出圆形按钮**（图标比按钮还大），或把按钮撑到一个奇怪的尺寸；
- 只改外层按钮的 `font-size` 时图标大小**不跟着变**（或变化幅度和预期不一致），看起来像「比例失控」；
- 按钮看着还是 34px，但图标跑到了按钮外——肉眼一眼可见的错位。

## 根因

`st-icon-button` 组件自己就带 `::slotted` 的尺寸规则：给插槽内容设 `font-size: 1.571em`、`color: currentColor`，按钮宿主尺寸是 `2.857em × 2.857em`、圆角 50%，**所有尺寸都是 em**（改宿主 `font-size` 即整体等比缩放）。

`n-icon` 是按 `font-size` 渲染的图标组件。一旦在页面上再给 `n-icon` 写 `width` / `height` / `font-size`，就会与组件的 `::slotted` 规则**叠加**（页面样式作用于 light DOM 元素，与组件内部规则同时生效），图标尺寸不再跟随按钮字号，于是出现「图标比按钮大 / 按钮字号改了图标不变」。

实测（本项目侧栏 ⋯ 按钮）：宿主 `font-size: 12px` → 按钮 34.3×34.3px、n-icon 18.9×18.9px（= 1.571em × 12px，来自组件 ::slotted）、颜色为 `rgb(195, 198, 207)`（继承 `currentColor`，随主题与选中态变化），完全落在按钮内。

## 正确姿势

- `st-icon-button` 里放 `n-icon` 时**只写按钮宿主的 `font-size`**（如 `.gmenu { font-size: 12px }`），图标大小、颜色全交给组件规则自动跟随；**不要**给 `n-icon` 写 `width` / `height` / `font-size`。
- 需要在页面侧微调时，最多给 `n-icon` 写不影响尺寸的布局属性（如 `display: inline-flex`）。
- 反过来推：**图标尺寸/颜色看起来不对时，先检查自己有没有给 `n-icon` 写尺寸**，再怀疑组件。
- 同时引入 `<l-m src="/nos/n-icon/n-icon.html"></l-m>`（NoneOS Core 的图标组件，走 Iconify），图标名如 `mdi:dots-horizontal` / `mdi:pencil`。
