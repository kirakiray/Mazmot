# 006 · 页面根级不能用 `$host.xxx()`，要用裸方法名

**症状**：把分组栏改成左侧侧栏后，控制台报错：

```
Error: Error evaluating element expression: 'class:active="$host.isGroupActive('all')"',
from file: .../pages/home.html
```

并且该元素上的 `active` 类**始终不生效**（选中项不高亮），但页面其余部分正常、点击也能工作。

**根因**：`$host`（父页面实例）只在**子作用域**（`o-fill` 项、`o-if` 内部等）里可用；在页面模板的**根级元素**上，渲染上下文就是页面本身，`$host` 未定义 → `class:` / `attr:` / `{{}}` 里的 `$host.xxx()` 求值抛错（本次是 `class:active`，报错会打到控制台但这个绑定被静默忽略）。

对比：同一文件里 `o-fill` 内部的 `class:active="$host.isGroupActive($data.id)"` 与 `{{$host.groupCountText($data.id)}}` 一直正常。

**正确姿势**：

- **根级**：写裸方法名 / data 字段，如 `class:active="isGroupActive('all')"`、`on:click="setGroup('all')"`、`attr:disabled="!groupDraft.trim()"`、`{{allCountText}}`。
- **`o-fill` / `o-if` 内部**：用 `$host.方法()` 调页面方法、`$data` 访问当前项。
- 记住：`on:click` 这种事件绑定在根级写 `$host.foo()` 有时也能跑（按名字解析），但 `class:` / `attr:` 等表达式指令会直接报错——**不要靠“能跑”来推断**，统一按上面规则写。
- 自检：控制台出现 `Error evaluating element expression` + 某个类名/属性名，先看那个表达式里有没有多余的 `$host`。
