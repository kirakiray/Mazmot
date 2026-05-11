---
name: run-js
description: 执行 JavaScript 代码片段，用于数学计算、获取时间等。如果需要得到返回值，记得带上 return 语句。
---

# 执行 JavaScript 代码

**run-js** 用于在浏览器环境中执行 JavaScript 代码片段。

## 基本用法

<cap-request>
- capability: run-js
  id: js001
  description: 执行简单计算
  opts:
    code: "return 1 + 2 + 3;"
</cap-request>

<cap-response>
- capability: run-js
  id: js001
  result: 6
</cap-response>

## 数学计算

<cap-request>
- capability: run-js
  id: js002
  description: 执行复杂数学计算
  opts:
    code: "return Math.sqrt(Math.pow(3, 2) + Math.pow(4, 2));"
</cap-request>

<cap-response>
- capability: run-js
  id: js002
  result: 5
</cap-response>

<cap-request>
- capability: run-js
  id: js003
  description: 生成随机数
  opts:
    code: "return Math.floor(Math.random() * 100) + 1;"
</cap-request>

<cap-response>
- capability: run-js
  id: js003
  result: 42
</cap-response>

## 获取时间

<cap-request>
- capability: run-js
  id: js004
  description: 获取当前时间戳
  opts:
    code: "return Date.now();"
</cap-request>

<cap-response>
- capability: run-js
  id: js004
  result: 1715404800000
</cap-response>

<cap-request>
- capability: run-js
  id: js005
  description: 获取格式化时间
  opts:
    code: "return new Date().toISOString();"
</cap-request>

<cap-response>
- capability: run-js
  id: js005
  result: "2026-05-11T12:00:00.000Z"
</cap-response>

<cap-request>
- capability: run-js
  id: js006
  description: 获取本地日期时间
  opts:
    code: "return new Date().toLocaleString();"
</cap-request>

<cap-response>
- capability: run-js
  id: js006
  result: "2026/5/11 20:00:00"
</cap-response>

## 参数说明

- `code` (必需): 要执行的 JavaScript 代码，必须以 `return` 语句返回结果
- 代码在浏览器上下文中执行，可以访问 `window`、`document` 等全局对象
