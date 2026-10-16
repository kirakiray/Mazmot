# 027 · `input` 的值不能用 `attr:value` 绑定：脏值之后 attribute 不再同步到 property

**日期**：2026-10-14
**涉及文件**：`pages/home.html`（详情弹窗「完成时间」编辑行）

## 症状

详情弹窗给已完成任务加的「完成时间」输入框（原生 `input[type=datetime-local]`）用 `attr:value="detail.doneAtValue"` 绑定。

- 打开第一条任务（有完成时间）→ 输入框预填正确；
- 关闭后打开**另一条没有完成时间的任务**（老数据 `done=true` 但 `statusChangedAt === null`）→ 输入框**仍显示上一条的时间**（`2026-10-01T08:30`），而不是空。

这正是场景用例「修改完成时间」里老数据那步失败的原因（`老数据不应有预填值：2026-10-01T08:30`）。表现上很像「完成时间串了 / 被丢了」，用户第一眼就会当成数据错乱。

## 根因

原生 `input` 的 `value` **属性（attribute）与属性值（property）只在「未被用户 / JS 改动过」之前保持同步**。一旦 JS（或用户输入）写过 `input.value`，该控件进入 dirty value 状态，之后修改 `value` attribute **不再影响** `input.value`（浏览器规范行为）。

本项目里 `onDoneAtChange`、`restore()` 都会直接写 `input.value`，于是此后 ofa 的 `attr:value` 表达式绑定（换任务时把 `detail.doneAtValue` 从旧值改成 `""`）就成了“写了个没人看的 attribute”，输入框继续显示上一次的 property 值。

## 正确姿势

**`input` / `textarea` 的值一律用 JS 设 `property`（或框架的 `:value` 双向绑定 / `sync:value`），不要用 `attr:value` 表达式绑定。** 本项目的做法（`syncDoneAtInput`）：

```js
doneAtInputEl() {
  const root = document.querySelector("o-page").shadowRoot;
  return root.querySelector(".done-at-row input[type=datetime-local]") || null;
},
syncDoneAtInput(value, tries) {
  const el = this.doneAtInputEl();
  if (!el) { // 弹窗刚开可能还没渲染
    if ((tries || 0) < 3) requestAnimationFrame(() => this.syncDoneAtInput(value, (tries || 0) + 1));
    return;
  }
  el.value = value || "";
},
```

`openDetail()` 里填完编辑区后调 `this.syncDoneAtInput(this.detail.doneAtValue)`；`onDoneAtChange` 的「恢复原值」分支也直接写 `input.value`。

## 判断这类问题的信号

- 「同一个输入框，换一条数据打开后值没跟着变」（尤其从上一条有值 → 下一条无值时最明显）；
- 用 `preview eval` 读 DOM 的 `input.value` 与页面 data 里的对应字段**不一致**（data 是空串、input 还是旧值）——这是最快的判据，比肉眼找样式线索直接得多。

## 顺带相关的两条（同一次改动里确认的）

1. **`change` 事件会在“清空输入框”时触发**：用户按退格想重填，`change` 就带着空值来了。此时若把字段写 `null` 并落盘，原完成时间就被静默弄丢（用户明确反馈过“不能把原来的完成时间弄丢”）。所以「值可编辑」的时间戳字段，**空值 / 非法值应当“不写数据 + 恢复原值回显”**，而不是当作“清空”。
2. **写入前的细节**：`datetime-local` 的 value 必须是 `YYYY-MM-DDTHH:mm` 这种本地时区格式，用 `new Date(raw)` 解析回来即可拿到时间戳（本项目 `toDatetimeLocal` / `onDoneAtChange` 一对函数互逆）。
