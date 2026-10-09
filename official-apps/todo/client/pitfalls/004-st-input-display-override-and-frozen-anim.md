# 004 · 给 `st-input` 覆盖 `display`，真实可输入区缩成默认 156px

**症状**：弹窗里的 `st-input` 看着挺宽（外框描边 440px），但真正的编辑区只有 156px——用 `eval` 量内部原生 input 发现：

```
host: 440x40（外框正常）
shadowRoot input.native: 156x19   ← flex: 1 1 0% 却完全没撑开
```

**根因**：`st-input` 的尺寸与布局靠组件自己的 shadow 里的 `:host { display: inline-flex; align-items: center; ... }`，内部原生 input 用 `flex: 1` 靠这个 flex 容器撑满。**页面样式表里的规则优先于 shadow 里的 `:host` 规则**——我在页面 CSS 里为了布局写了

```css
.dialog-field { min-width: 260px; display: block; }
```

`display: block` 直接干掉了组件默认的 `inline-flex`，宿主变成普通块盒，内部 `flex: 1` 失效，原生 input 退回自身默认宽度（约 156px）。外观上外框（绝对定位的描边浮层）仍是宿主的宽度，所以**肉眼看不出来，只有点最右边输入才发现光标进不去**。

**顺手踩的第二个测量陷阱**：这坑差点被误判。`getBoundingClientRect()` 量到宿主高度只有 20px（正常 40px），一开始以为是组件坏了；实际是**预览标签页在后台时，弹窗的开场动画被浏览器冻结**（`st-dialog` 的 `st-dlg-in` 停在第 0 帧、`opacity: 0`、`transform: matrix(1,0,0,0.5,0,-99.96)` 即纵向被缩到 0.5），rect 量到的是缩放假象。换成 `getComputedStyle(el).height` 读到的 `39.99px` 才是真实样式值。

**正确姿势**：

- 定制 `st-input` 宽度只写 `width` / `min-width`，**别碰 `display`**（同理不要覆盖它依赖的 `position` / `align-items`）；想让它自适应容器就给 `width: 100%`。
- 量尺寸时先确认拿到的是「样式值」还是「受动画影响的布局值」：可疑就同时看 `getComputedStyle` 与 `getAnimations()`（`playState` / `currentTime`），或换 `preview` 的 `action=dom`（它给的 rect 与样式是同一快照，便于交叉判断）。后台标签中动画冻结是环境特性，不要据此改代码。
- 这类「外框宽、输入区窄」的问题肉眼看渲染正常，必须用 `eval` 量内部 `input.native` 的宽度与宿主宽度比对（本项目按 `> 85%` 视为撑满）。
