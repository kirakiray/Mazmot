# 001 · 页面 `:host` 没做成滚动容器，长列表被裁掉且无法滚动

**症状**：待办条目少时一切正常；条目多到超出视口后，页面无论如何滚不动，超出部分被裁掉、点不到（新增的顶部输入框也可能随之划出视野外）。当前预览窗口里量到 `o-page` 是 `overflow: visible`，DOM 内容比视口高但 `scrollTop` 恒为 0。

**根因**：`o-router fix-body` 给自身 shadow 写死了 `overflow: hidden`，页面自己不再滚动时，溢出内容没有任何滚动容器承载。原页面样式只写了 `min-height: 100vh`（`display: block`），元素会随内容长高而不是自己滚动，于是内容溢出后既滚不动也被裁。

**正确姿势**：`pages/*.html` 的 `:host` 一律写成滚动容器：

```css
:host {
  display: block;
  height: 100%;          /* 不能只写 min-height —— 那样宿主会随内容长高，不产生滚动 */
  overflow-y: auto;
  box-sizing: border-box;
  padding: ...;
}
```

确认方法：往列表塞 40 条数据后量 `o-page` 的 `scrollHeight`（应远大于 `clientHeight`）、把 `scrollTop` 设为 `99999` 看是否停在 `scrollHeight - clientHeight`，并确认滚到底后最后一条与底部栏在视口内。项目 AGENTS.md 的「硬性约定」对本条有明确规定，新页面照抄即可。
