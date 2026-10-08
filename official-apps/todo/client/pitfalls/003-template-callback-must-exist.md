# 003 · 重构时删了 proto 方法、模板仍在调用，报 `function "xxx" not found`

**症状**：控制台（预览 `action=console`）出现

```
Error: Event binding error: function "clearDone" not found in expression on:click="clearDone",
from file: .../pages/home.html
```

报错对象是 `o-page`（`"target": { "tag": "o-page", ... }`），并且**页面看起来能正常渲染**——列表、计数都对，只是那一个按钮点了没反应。改动越大越容易漏：本次改造垃圾桶时把 `deleteTodo` / `clearDone` 一起重写，`deleteTodo` 换成了新的方法链，`clearDone` 却忘了补回，而模板底部栏一直有 `on:click="clearDone"`。

**根因**：模板里的事件绑定是**运行时**按名字去页面实例上找方法的，找不到就在该节点渲染时抛 `Event binding error`（不阻断其他节点渲染，所以表现为「其他地方都好、只有这个按钮失效」，容易误判成按钮组件的问题）。而重构时删方法、改方法名是不会被任何静态检查发现的。

**正确姿势**：

- **改 `proto` 里的方法名 / 删方法时，顺手全文件搜一遍模板中的引用**：`on:click="..."`、`on:change="..."`、`{{$host.xxx(...)}}`、`attr:xxx="$host.xxx(...)"` 都要对得上；改完 `preview action=app` 推送后**必须读一次 `action=console`**，这类错误只出现在控制台里，肉眼看渲染是正常的。
- 排查口诀：**「按钮/交互没反应」先看控制台有没有 `function "xxx" not found`，而不是先怀疑组件或事件穿透。**
- 本项目自定义方法都挂在 `proto`（计算属性用 getter，业务方法直接写方法）；模板统一用 `on:click="方法名"`（根级）或 `on:click="$host.方法名(args)"`（`o-fill` / `o-if` 内），对照 `CONTEXT.md` 的方法表即可核对完整性。
