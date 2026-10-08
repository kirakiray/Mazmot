# 009 · 把 `n-icon` 放进 `st-icon-button` 时不要设 `width/height`（与组件自带 `::slotted` 的 `1.571em` 叠加，图标会撑出按钮）

## 症状

把分组行右侧的 ✏️ emoji 换成 NoneOS Core 的 `<n-icon icon="mdi:pencil">` 后，按「图标按钮默认图标 22px」的经验给它写了 `width: 1.571em; height: 1.571em`：

- 图标 SVG 实测 **30×30**，而按钮只有 34×34（图标几乎顶满圆形按钮、视觉很挤）；
- 直觉上 `1.571em` 应该等于按钮默认的 22px（组件文档：图标 `1.571em`），实际却算出 30px。

## 根因

`senti-ui` 的 `st-icon-button` 自带一条对插槽内容的规则：

```css
::slotted(*) { display: inline-flex; font-size: 1.571em; line-height: 1; }
```

`n-icon` 会被这条规则把 `font-size` 设成 `1.571 × 按钮 font-size`（本页按钮 `font-size: 12px` → 18.85px），而它的 SVG 用 `1em` 尺寸。此时再给 `n-icon` 写 `width/height: 1.571em`，**em 是按 `n-icon` 自己的 font-size 解析的**（18.85px），于是 `1.571 × 18.85 ≈ 29.6px` —— 与 22px 完全无关，是**两层 em 相乘**的结果。

## 正确姿势

1. **只按原有方式缩放按钮本身**：改 `st-icon-button` 的 `font-size`（em 体系会等比缩按钮、`::slotted` 图标字号同步跟着缩），`n-icon` 什么都不用写。
2. **不要给 `n-icon` 设 `width` / `height`**（也不需要设 `font-size`）——让它吃 `::slotted` 的 `1.571em` 即可：实测按钮 34.3px 时图标 18.9px，正是 M3 的图标/按钮比例，且 `inside_btn: true` 没溢出。
3. 颜色也不用管：`n-icon` 的 SVG 是 `fill="currentColor"`，自动继承 `st-icon-button` 的前景色（实测 `n-icon` 与按钮的 `computedStyle.color` 完全一致）。
4. 引用方式：`<l-m src="/nos/n-icon/n-icon.html"></l-m>`（Mazmot 环境内 `/nos/...` 可直连，等价于 `https://core.noneos.com/nos/n-icon/n-icon.html`）。`n-icon` 从 `https://api.iconify.design/<集合>:<图标名>.svg` 取图标，并把结果持久化缓存在 `getStorage("n-icon")` 里——硬刷新后实测 **~100ms** 就出图（命中 IndexedDB 缓存）。

## 顺带确认（避免下次重复试）

- 该环境**可以**直连 `api.iconify.design`（`fetch` 200，SVG 带 CORS 头），无需走后端中转；若未来某环境被墙，`n-icon` 内部会 `console.error("Failed to load icon: ...")`，图标位留空但**不抛异常、不影响页面**。
- 图标名要符合 Iconify 规范（`mdi:pencil`、`mdi:delete-outline` 等），可在 icon-sets.iconify.design 搜索。
