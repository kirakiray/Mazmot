# 016 · `<o-fill>` 是 `display: contents` 的元素，`getBoundingClientRect()` 全是 0——不能拿它当坐标参照

## 症状

拖拽排序的「落点指示线」画得乱七八糟：明明算的是行与行之间的缝隙，实际却画在某一行的文字中间，或者整体偏下一大截（用户截图反馈「那条线是乱的」）。

## 根因

指示线是**绝对定位**在 `.list`（`position: relative`）里的浮层，位置由 `top = 目标行的视口坐标 - 列表容器的视口坐标` 算出。取列表容器时写了 `itemEl.parentElement`，而**列表行的直接父节点不是 `.list`，而是 `<o-fill>`**：

```
div.list (position: relative)
└── o-fill (display: contents)     ← .item 的直接父节点
    ├── div.item
    └── div.item
```

`o-fill` 是 `display: contents`（它自己不生成盒子，只把子节点交给父级参与 flex/grid 布局），因此 **它的 `getBoundingClientRect()` 返回全 0**（`{x:0, y:0, width:0, height:0}`）。于是 `listTop` 恒为 0：

- 算出来的 `y` 其实是**视口坐标**（几百 px）；
- 而它被当成「相对 `.list` 的偏移」写进 `top`，等于把视口坐标又叠加了一次 `.list` 自己的偏移（本页 `.list` 顶部在 y≈159）→ 线凭空下移约 159px + 滚动量，完全对不上行。

实测对照：`.list` rect `y=159`、首行 `top=159`；同一个落点的正确偏移应是 ~152px，而代码写进了 311px（≈ 152 + 159）。

## 正确姿势

1. **要拿布局容器的几何，用 `el.closest('.list')` 这类语义选择器向上找，不要用 `parentElement` 猜层级**——`o-fill` / `x-fill` / `<o-if>` 等框架节点可能插在中间，且它们自己的 rect 无意义。
2. **能用「元素自身的边缘」表达位置时，就不要用坐标计算浮层**。本项目的最终解法：落点指示线改成画在**目标行自己的伪元素**上（`.item.drop-before::after { top: -5px }` / `.item.drop-after::after { bottom: -5px }`，配 `.item { position: relative }`），几何上永远与行对齐，彻底不存在坐标系错位。代码里也删掉了 `dropLineTop` 这类坐标字段。
3. 排查同类「浮层 / 指示器位置不对」时，先在预览里 `eval` 打印：浮层元素的 `style.top`、它的 rect、以及**参照容器的 rect**——三者一比就能立刻看出是「参照选错」还是「单位 / 坐标系混用」（本项目正是靠这组对照定位到 `parentElement` 的 rect 全 0）。
