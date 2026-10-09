# 007 · 用 `preview eval` 取证时的两个错觉：`o-page` 元素上读不到页面 data、`st-dialog` 的 `open` 属性读不到

## 症状

排查/自测时想用 `preview action=eval` 走「捷径」直接改页面数据、或直接断言弹窗状态，结果取证结论与真实情况相反：

1. **改数据不生效，误判为「渲染坏了」**：`const page = document.querySelector('o-app > o-page'); page.todos = [40 条]` 之后读回 `page.todos.length` 是 `40`，但 `page.shadowRoot.querySelectorAll('.item').length` 仍是 `1`、`page.scrollHeight === page.clientHeight`（内容根本没变长），看起来像 `o-fill` 不响应或响应式失效。
2. **弹窗判断恒为「没打开」**：点击任务正文后明明日志已打 `[detail] 打开详情 …`，但 `[...root.querySelectorAll('st-dialog')].find(d => d.open)` 返回 `undefined`、`filter(d => d.open).length` 为 `0`，像弹窗没打开，于是又去怀疑 `sync:open` 绑定。

## 根因

- `o-page` 元素的**页面 data 不是元素上的普通属性**：实例自有属性只有 xhear 内部键（`Object.keys(page)` → `["__xhear__"]`），`page.data` / `page.$data` 都不存在。给 `page.todos` 赋值只是往元素上挂了一个普通自有属性——**读写都通、但和页面真正渲染用的响应式数据毫无关系**，所以 `o-fill` 自然不更新。（同理 `page.detail` 读出来是 `undefined`。）
- `st-dialog` 的打开状态**不在 `.open` 属性上**（`d.open` 恒为 `undefined`），真实状态落在**特性**上：`d.hasAttribute('open')` 为 `true/false`。用 `d.open` 判断必然得到「全部未打开」的假结论。

## 正确姿势

- **不要在 `o-page` 元素上读写页面 data**。要查运行期状态，读真实 DOM（shadowRoot 里的结构 / 文案）或看 `console` 里已有的 `[模块]` 埋点日志；要构造长列表做滚动验证，**往 shadowRoot 的列表容器注入填充 DOM 节点**（如 `page.shadowRoot.querySelector('.list').appendChild(...)`），测完 `location.reload()` 复原（注入节点不写存储，不会污染用户数据）。
- **判断 `st-dialog` 是否打开用 `hasAttribute('open')`**，并顺带读 `[slot=headline]` 的文案确认是哪一个弹窗。
- 这类「取不到值」的现象先怀疑**取证手段不对**（属性名/承载位置），再怀疑应用代码——本项目已实测：应用本身完全正常，`[detail] 打开详情` 日志与 `hasAttribute('open')` 都正确。
