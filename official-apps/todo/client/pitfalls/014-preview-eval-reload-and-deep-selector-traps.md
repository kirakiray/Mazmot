# 014 · 预览自测两个取证陷阱：eval 里 `location.reload()` 会 30s 超时、`$$deep` 会命中共名类的组件内部节点

## 症状

- **症状 A**：在 `preview eval` 的代码里写 `location.reload(); await new Promise(r => setTimeout(r, 2500)); …` 再继续取证，整条指令**静默超时 30s**（没有返回值、没有报错），看起来像应用卡死或调试通道挂了。
- **症状 B**：用 `$$deep('.item')` 拿列表条目，得到的集合里混进了**没有 `.text` 子节点**的元素，后续 `i.querySelector('.text').textContent` 抛 `TypeError: Cannot read properties of null (reading 'textContent')`；数量也对不上（比页面里肉眼可见的条目多）。

## 根因

- A：`location.reload()` 会销毁当前页面上下文并断开调试桥，**该次 eval 注册的 promise 永远不会 resolve**，只能等预览通道的超时保护兜底。刷新本身是成功的，只是这次调用拿不到结果（与 `pitfalls/011` 的“裸读 IndexedDB 静默超时”是同类观感、不同成因）。
- B：`$deep` / `$$deep` 是**穿 shadow DOM 的深度查询**，会进入页面里每个组件的 shadowRoot。`st-menu` 的菜单项、`st-dialog` 内部等组件恰好也用 `.item` / `.text` 这类通用类名，于是查询结果混入组件内部节点——它们看起来“是 `.item`”，但没有页面模板里的子结构。

## 正确姿势

- 要硬刷新就**单独发一条** `preview eval`：`location.reload(); return "reloaded";`，然后用**新的** eval 指令取证（新指令在新页面上执行）。
- 取页面自己的节点时，先把查询根限定到页面 shadowRoot：

```js
const root = $$deep('.shell')[0].getRootNode(); // 页面模块的 shadowRoot
const items = [...root.querySelectorAll('.item')]; // 只命中页面模板里的条目
```

- 想判断一个节点是否属于页面，用 `root.contains(el)`；`$$deep` 只用于“找到页面里的某个锚点元素”（如 `.shell`、`.add-btn`）。
- 同理，凡是要对**数量**做断言（条目数、分组数），必须用限定后的 `root.querySelectorAll`，不要直接用穿透查询的结果。
