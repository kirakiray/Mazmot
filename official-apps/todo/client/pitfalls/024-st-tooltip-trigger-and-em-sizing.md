# 024 · st-tooltip 的三个要点：触发器要挂在宿主上、气泡尺寸全是 em、后台标签页验不了悬停/聚焦

**日期**：2026-10-10
**涉及文件**：`pages/home.html`（归档视图说明行的「?」提示）

## 症状 / 场景

把归档视图的长说明段换成「一行短文案 + `?` 图标悬浮提示」时，需要验证提示能正常弹出。测试中出现两种「看起来没反应」：

1. 向触发器（`st-tooltip` 里的 `span.help-btn`）派发 `pointerenter` → 宿主 `st-tooltip` **没有** `open` 属性、气泡不出现；
2. 对触发器调 `focus()`（带 `tabindex="0"`，`document.activeElement` 确实是它）→ 宿主同样不开。

## 根因

- **`pointerenter` 不冒泡**。翻组件源码（`/gh/ofajs/senti-ui@latest/packages/tooltip/tooltip.html`）可见监听挂在**宿主元素**上：`ele.addEventListener("pointerenter", show)` / `pointerleave` / `focusin` / `focusout`。在子触发器上派发 `pointerenter` 事件时，它不会冒泡到宿主 → 监听器收不到。
  - **正确做法**：把事件派发到宿主本身——`tt.dispatchEvent(new Event('pointerenter'))`，开合立即生效（实测 `open` 属性出现、气泡 240×135）。
- **后台标签页里 `focus()` 不触发 `focusin`**（窗口本身没有焦点）。预览标签页在后台时，键盘聚焦这条路径**无法实测**，只能证明元素可聚焦（`activeElement` 正确）+ 焦点样式类写对。这跟「悬停在后台标签页量不到」（踩坑 010）是同一类环境限制。
- **气泡的一切尺寸都写在 em 上**：组件默认气泡字号 `0.857em`、`max-width: 20em`、padding / 圆角也全是 em。宿主 `st-tooltip` 的 font-size 默认继承自所在说明行（12px），于是气泡正文只有 **10.28px**、宽度只有 206px，长说明读起来吃力。
  - **正确做法**：给宿主提字号（`.archive-tip st-tooltip { font-size: 14px }` → 气泡正文 12px、`max-width` 随之变 240px），再把触发图标按 em 折算回 15px 左右（`n-icon { font-size: 1.07em }`）。
  - 组件 shadow 里**没有 `part`**（已核对 `innerHTML`），所以气泡内部样式只能靠 em 缩放从宿主递进去，不能 `::part` 覆盖。

## 顺带记下的用法要点

- 触发器要有可聚焦能力（`tabindex="0"`）才能走键盘路径；本项目的「?」用 `span.help-btn[tabindex=0][role=img][aria-label=归档说明]`。
- `content` 是纯文本渲染（防注入），**不支持换行**，长文本自动折行——所以整段细则写成一个字符串即可，不需要 `<br>`。
- 文档也提示「提示不要承载关键信息（触屏设备无悬停）」，所以本次保留的可见短文案必须自带关键语义（「归档不计入统计，也不在列表里显示」），细则才放提示里。
- 组件引入照旧一条 `<l-m src="/gh/ofajs/senti-ui@latest/packages/tooltip/tooltip.html"></l-m>`（放页面模板顶部）。

## 由此形成的项目约定

归档视图的说明行 = **一行短文案 + 「?」提示**，提示里的内容不得与可见短文案冲突、只做补充；**不要再改回一整段长文案**（用户明确反馈过长段落「太繁琐」）。用例 `archive-group.test.json` 已加断言锁住这一点。
