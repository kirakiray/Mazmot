---
name: run-js
description: 执行 JavaScript 代码片段，用于数学计算、获取时间等。
---

# 执行 JavaScript 代码

**run-js** 用于在浏览器环境中执行 JavaScript 代码片段。

## 重要说明

提供的代码会被自动包裹在 `new Function(code)` 中执行，因此**必须使用 `return` 语句返回结果**。例如：

- 正确：`return 1 + 2;`
- 错误：`1 + 2;`（没有 return，结果将无法返回）

## 基本用法

<cap-request>
  <template name="run-js" cid="js001" desc="执行简单计算">return 1 + 2 + 3</template>
</cap-request>

## 数学计算

<cap-request>
  <template name="run-js" cid="js002" desc="执行复杂数学计算">return Math.sqrt(Math.pow(3, 2) + Math.pow(4, 2));</template>
</cap-request>

<cap-request>
  <template name="run-js" cid="js003" desc="生成随机数">return Math.floor(Math.random() * 100) + 1;</template>
</cap-request>

## 获取时间

<cap-request>
  <template name="run-js" cid="js006" desc="获取本地日期时间">return new Date().toLocaleString();</template>
</cap-request>

## 多行代码

多行或较长的代码，建议放在标签内部：

<cap-request>
  <template name="run-js" cid="js007" desc="执行多行 JavaScript 代码">
const a = [1, 2, 3, 4, 5];
const sum = a.reduce((acc, n) => acc + n, 0);
return sum;
  </template>
</cap-request>

## 参数说明

- `data-code`：短代码通过属性传递
- 标签内部内容（`content`）：多行或较长代码放入标签内部

**重要**：代码会被包裹在 `new Function(code)` 中执行，**必须使用 `return` 语句返回结果**。代码在浏览器上下文中执行，可访问 `window`、`document` 等全局对象。
