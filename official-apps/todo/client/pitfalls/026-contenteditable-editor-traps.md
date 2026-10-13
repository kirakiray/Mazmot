# 026 · 自建 contenteditable 富文本编辑区的四个坑

**背景**：需求是「编辑任务时，首行就在编辑区**里面**加粗加大（像富文本编辑器），不要在框下方再加一行 title」。原生 `textarea` 不能只给某一行换样式，所以把详情弹窗的编辑区换成了自建的 `contenteditable`（`.rt-box > .rt-editor`，每行一个 `div.rt-line`，首行套 `.rt-title`）。实现与自测时长出下面四个坑。

---

## 坑 1：用选区注入文本时，必须先 `focus()` 再设 `Range`（顺序反了会插到错误位置）

**症状**：`preview eval` 里模拟真实打字（`document.execCommand('insertText', …)`）时，插入的文本没进当前行，反而让后续「回车拆行」把文字从中间切开、光标跑到莫名其妙的位置——看起来像是拆行的行内偏移算错了，其实是注入本身就跑偏。

**根因**：先设 `Range` 再调 `el.focus()` —— `focus()` 会把选区重置（内容被插到编辑器开头 / 上一个选区），于是 `caretInfo()` 读到的偏移与真实输入位置不一致。

**正确姿势**：

```js
ed.focus();                 // 先聚焦
// 再设置 Range 并 addRange
const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
document.execCommand('insertText', false, 'X');   // 现在才落到光标处
```

（应用代码里 `focusEditor()` 也是同一顺序：先设 range，最后再 `el.focus()`，因为此时元素已经聚焦、`focus()` 只是幂等确认；**在「还没聚焦」的场景下必须先 focus**。）

---

## 坑 2：空态不能把空行 `display: none` 掉，必须始终保留一个可编辑空行

**症状**：一开始为了显示「第一行是标题…」的占位提示，给空态写了 `.rt-editor.is-empty .rt-line { display: none }` + `::before` 占位。结果用户把内容全删光后**再也打不进字**（光标无处可放，输入没有落点）。

**根因**：contenteditable 里可见的块就是可编辑区域；`display: none` 的行不参与布局，光标无处落脚。另外「行被删空」时浏览器可能把行 div 全删掉（`children.length === 0`），此时连一个可编辑行都没有。

**正确姿势**：
- 占位提示用 `::before` **绝对定位叠在空行上方**（`.rt-editor { position: relative }` + `position: absolute; top: 0; left: 0; pointer-events: none`），空行本身照常保留（`min-height: 1.5em`）；
- `syncEditorDraft()` 里补一道：**子元素为 0 时重建一个空行**（`renderEditor([""])` + 把光标放进去），保证任何时候至少有一行可编辑。

---

## 坑 3：普通打字绝不能重建 DOM（否则光标跳、输入法被打断）

**症状**：如果把「读文本 → 重建行 DOM」写在每次 `input` 里，输入时会出现光标跳到行首、中文输入法组合被掐断（打字变成一个个孤立字符）。

**根因**：重建会替换掉所有文本节点，浏览器原生的选区 / IME 组合状态全部作废。

**正确姿势**：
- 普通输入只做**数据同步 + 样式类维护**（`editDraft`、`.rt-title` 类、`is-empty` 类），**不碰 DOM 结构**；
- 仅在两种情况下才 `renderEditor()` 重建：① 行被删光（`children.length === 0`）；② 结构被浏览器改乱（出现非 `.rt-line` 子元素、或行内出现非 `<br>` 元素）。重建前先 `caretInfo()` 记下「第几行 + 行内第几个字符」，重建后 `focusEditor()` 放回去；
- 回车**自己处理**（`preventDefault` + 按行内偏移拆行），别让浏览器插 `<div>` / `<br>`（结构不可控）；粘贴只取 `text/plain` 同样自己插入；
- 输入法组合期间（`compositionstart` → `compositionend`）不重建、不拦回车（`ev.isComposing` / `keyCode === 229` 直接 return）。

---

## 坑 4：样式只能用行级 class 表达，光标位置只能用「行号 + 行内偏移」表示

**症状**：想用 CSS 选择器表达「第一个视觉行加粗」，写成 `.rt-editor > :first-child` 之类——一旦浏览器自主插入嵌套块 / `<br>`，`:first-child` 就可能不是用户眼中的第一行；想用字符偏移保存 / 恢复光标时，`range.toString()` 又**不含块级边界**，跨行字符串偏移与行结构对不上。

**正确姿势**：
- 行的样式由**数据侧算好再打到 class 上**（`applyEditorTitleClass(lines)`：第一个非空行且其后还有非空行 → `.rt-title`），并用 `closest('.rt-line')` 从光标节点往上找行，**不靠 `parentElement` / `:first-child` 猜层级**；
- 光标一律用 `{ lineIndex, offset }`（行号从 `Array.from(el.children).indexOf(lineEl)` 拿，行内偏移用 `range.cloneRange()` 从行首量到光标），重建后按同一坐标放回；
- 行数组读 `innerText`（块级边界即 `\n`）而不是 `textContent`（没有换行），这样即使结构暂时不规范也能读对。

---

**一句话总结**：contenteditable 的「受控」做法是——**数据结构自己定（行数组）、DOM 只在必要时重建、光标用行号+偏移保存恢复、样式用 class 表达**；凡是「每次输入都重建」或「用浏览器默认换行结构」的写法，都会在光标与输入法上翻车。
