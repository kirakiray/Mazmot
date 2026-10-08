# 005 · `st-dialog` 内用 `$host.xxx()` 调页面方法不渲染

**症状**：详情弹窗里的 `{{$host.detailStatus()}}`、`{{$host.detailTime('createdAt')}}`、`{{$host.detailDoneLabel()}}` 以及 `attr:` / `class:hidden="$host.detailInTrash()"` 全部**静默失效**——不是报错，而是渲染成空字符串：

```
headline: ""                      ← {{detail.title}} 也是空
text: "第一行描述 第二行描述 状态 创建时间 状态变更 删除时间 删除 还原 彻底删除 关闭"
                                  ↑ 只有属性访问 / 静态文本渲染了，方法调用的值全空
```

而同一个弹窗里的 `{{detail.desc}}`（**属性访问**）渲染完全正常，控制台也没有任何报错。很容易误判成「数据没准备好」。

**根因**：`st-dialog` 的内容虽然在页面模板里，但它作为自定义元素形成了自己的 ofa 作用域——弹窗内部的 `$host`**不指向页面实例**（页面方法都挂在页面上）。于是 `$host.detailStatus` 取不到，表达式求值为空、静默丢弃。属性访问走的是 data 作用域链（`detail.desc` 来自页面 data），所以照常渲染——这也解释了「同图不同命」的差异。

**正确姿势**：

- **`st-dialog`（以及其他组件）内部只用属性访问、不用 `$host.方法()`**：把要展示的文案与布尔标志在打开弹窗时**预计算**进 data 快照（本项目即 `buildDetail(todo)` → `detail = { title, desc, hasDesc, inTrash, statusText, createdText, statusChangedText, deletedText, doneLabel }`），模板里只写 `{{detail.statusText}}`、`class:hidden="detail.inTrash"`。
- 弹窗内部按钮的 `on:click="method"`（根级直接写方法名）**是正常的**——事件处理在页面作用域解析；失效的只有模板表达式里的 `$host`。所以「按钮能点，但按钮上的字是空的」是这条坑的典型特征。
- 自检：给弹窗模板渲染出来的东西里只要出现「静态文本都在、插值成对出现但值为空」，就先怀疑 `$host`。
