# 012 · 自测侧栏拖拽宽度的三个注意点

**背景**：分组侧栏宽度可拖拽（`.resizer` 手柄 → `startResize(ev)` → 改 `data.sideWidth` → 落盘 `ui` 键）。用 `preview` 工具 `eval` 自测拖拽时，有三处容易得出错误结论。

**一、`resizing` 类挂在外层 `.shell` 上，不在 `.side` 上**

```html
<div class="shell" class:resizing="resizing">   <!-- 类在这里 -->
  <aside class="side"> … </aside>
```

查「拖动中是否有拖拽态」时要查 `.shell`：`shell.classList.contains('resizing')`。查 `.side` 会永远得到 `false`，让人误判成「拖拽没生效」——而实际上宽度已经变了、`user-select: none` 也已生效（实测 `.shell` 的 `userSelect` 在拖动中为 `none`，松手回 `auto`）。**判拖拽是否生效，以宽度变化 + `ui` 落盘为准，别只看类。**

**二、拖拽必须用 `PointerEvent` 派发，且移动 / 结束事件要派发到 `window`**

监听是 `resizer` 的 `pointerdown` 起手，然后 `pointermove` / `pointerup` / `pointercancel` **挂在 `window`** 上（指针移出手柄甚至移出窗口也能继续跟随）。所以自测要：

```js
const ro = resizer.getBoundingClientRect();
const x = ro.left + ro.width / 2, y = ro.top + 40;
resizer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true,
  pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }));
window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true,
  pointerId: 1, isPrimary: true, clientX: x + 70, clientY: y }));   // 注意是 window
window.dispatchEvent(new PointerEvent('pointerup', { … }));
```

两点细节：
- 必须带 `button: 0`——`startResize` 里有 `if (ev.button !== 0) return;`（过滤右键），漏了会被静默拦掉；
- `pointermove` 派发到 `resizer` 上无效（监听在 `window`），拖动过程中改的只有宽度，不派发 `pointerup` 则 `resizing` 一直为 `true`、宽度不落盘。

**三、拖完记得把宽度改回去（这是用户偏好数据）**

`sideWidth` 会写进存储 `ui` 键并持久生效，属于**用户的界面偏好**。自测把侧栏拖大之后，要么用 `store.setItem("ui", { sideWidth: <原值> })` 改回原值（本次是用户此前拖到的 150px），要么在 UI 上拖回，别把自己的测试宽度留给用户。

**旁证手段**：拖动后可同时核对三处——`getComputedStyle(side).width`（侧栏）、`.spacer` 的宽度（应与侧栏一致）、`.main` 中心的偏移（应≈0，即任务区仍在视口正中）。
