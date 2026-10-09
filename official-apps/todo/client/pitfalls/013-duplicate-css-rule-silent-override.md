# 013 · 重复定义 `.main` 的旧规则静默覆盖新规则（改 `max-width` 不生效）

**症状**：把任务区的行宽上限从 `880px` 改成 `1200px` 后推送，实测 `getComputedStyle(main).maxWidth` **仍是 `880px`**——代码里搜「880px」只有一处、明明已经改成 1200 了。没有任何报错，样式就是不生效。

**根因**：`<style>` 里存在**两块 `.main` 规则**。历史上页面是「三列网格（左列侧栏 / 中列任务区 / 右列留白）」，第一块 `.main` 写在网格定义附近、第二块（带「任务区在中间列里居中」注释）跟在 `.resizer` 后面。改布局时只更新了其中一块，后出现的那块（同优先级、位置更靠后）原地覆盖了前面的 `max-width`。因为是**同一页面模块自己的样式表**里的重复选择器，devtools 之外没有任何提示。

**正确姿势**：

- 改布局时**先确认选择器是否只定义了一处**：`preview eval` 里把页面模块的 `<style>` 文本拿出来数一遍即可——

  ```js
  const sr = document.querySelector('o-page').shadowRoot;
  const css = [...sr.querySelectorAll('style')].find(s => s.textContent.includes('.shell')).textContent;
  css.split('\n').map((l,i)=>i+': '+l).filter(l => /\.main|max-width/.test(l)).join('\n');
  ```

  （注意页面模块的 shadowRoot 里**有两个 `<style>`**，要挑包含 `.shell` 的那个。）
- 布局相关的规则**统一收在一个位置**（本项目：`.shell` / `.main` / `.side` / `.resizer` 按顺序写在样式表开头），避免“定义在 A 处、覆盖规则散落在 B 处”。
- 改了尺寸类属性后，**不要只看代码**——用 `getComputedStyle` 读一次真实值（`eval` 一行即可），这是唯一可靠的确认方式；尤其调整网格 / 上限这类“看不见的约束”时。
