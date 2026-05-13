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
[
  {
    "capability": "run-js",
    "id": "js001",
    "description": "执行简单计算",
    "opts": {
      "code": "return 1 + 2 + 3;"
    }
  }
]
</cap-request>

## 数学计算

<cap-request>
[
  {
    "capability": "run-js",
    "id": "js002",
    "description": "执行复杂数学计算",
    "opts": {
      "code": "return Math.sqrt(Math.pow(3, 2) + Math.pow(4, 2));"
    }
  }
]
</cap-request>

<cap-request>
[
  {
    "capability": "run-js",
    "id": "js003",
    "description": "生成随机数",
    "opts": {
      "code": "return Math.floor(Math.random() * 100) + 1;"
    }
  }
]
</cap-request>
 
## 获取时间

<cap-request>
[
  {
    "capability": "run-js",
    "id": "js006",
    "description": "获取本地日期时间",
    "opts": {
      "code": "return new Date().toLocaleString();"
    }
  }
]
</cap-request>

## 参数说明

- `code` (必需): 要执行的 JavaScript 代码
  - **代码会被包裹在 `new Function(code)` 中执行**
  - **必须在代码末尾使用 `return` 语句返回结果**，否则无法获取返回值
  - 代码在浏览器上下文中执行，可以访问 `window`、`document` 等全局对象
