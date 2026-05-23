---
name: preview-web
description: 可以预览本地网页文件的内容
page: src/preview.html
---

# Preview Web

这是一个用来预览网页的能力，当传入一个地址，就可以预览该网页的内容。

## 基本用法

以下示例展示了如何使用 preview-web 能力预览网页：

<cap-request>
  <template name="preview-web" cid="preview-web-01" desc="预览网页内容" data-url="/demo/preview-demo.html" data-title="示例网页预览">
  </template>
</cap-request>

预览组件并不会返回任何内容，它只是在浏览器中打开一个新窗口，显示指定的网页内容。

## 参数说明

preview-web 能力接受以下参数：

| 参数    | 必需 | 说明                                       |
| ------- | ---- | ------------------------------------------ |
| `url`   | 是   | 要预览的网页地址，可以是相对路径或绝对路径 |
| `title` | 否   | 预览窗口的标题，默认为"网页预览"           |

## 使用场景

preview-web 能力适用于以下场景：

1. **本地开发预览**：在开发过程中快速预览本地 HTML 文件
2. **组件演示**：展示组件库或页面的实际效果
3. **文档示例**：在文档中嵌入可交互的网页示例
4. **测试验证**：验证网页的渲染效果和交互功能

## 与 fs 能力配合使用

preview-web 能力通常与 fs 能力配合使用，工作流程如下：

1. 使用 fs 能力将 HTML 及相关文件写入本地
2. 使用 preview-web 能力预览写入的文件

### 目录约定

建议将预览文件放在 `mazmot/preview/<项目名>/` 目录下，例如：

- `mazmot/preview/my-demo/index.html`
- `mazmot/preview/my-demo/style.css`
- `mazmot/preview/my-demo/script.js`

### 路径格式

预览文件时，使用 `$` 开头的根路径地址，例如：

- `$mazmot/preview/my-demo/index.html`

### 完整示例

以下示例展示了如何先写入文件再预览：

<cap-request>
  <template name="fs" cid="fs-01" desc="写入HTML文件" data-mode="write" data-path="mazmot/preview/test-demo/index.html">
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>测试页面</title>
      <link rel="stylesheet" href="./style.css">
    </head>
    <body>
      <h1>测试页面</h1>
      <script src="./script.js"></script>
    </body>
    </html>
  </template>

<template name="fs" cid="fs-02" desc="写入CSS文件" data-mode="write" data-path="mazmot/preview/test-demo/style.css">
body {
font-family: sans-serif;
padding: 20px;
}
h1 {
color: #333;
}
</template>

  <template name="fs" cid="fs-03" desc="写入JS文件" data-mode="write" data-path="mazmot/preview/test-demo/script.js">
  console.log('页面加载完成');
  </template>

  <template name="preview-web" cid="preview-web-01" desc="预览网页内容" data-url="$mazmot/preview/test-demo/index.html" data-title="测试页面预览">
  </template>
</cap-request>

## 注意事项

- 预览的网页地址必须是可访问的本地路径或网络地址
- 使用 `$` 前缀表示根路径，确保路径正确
- 建议将预览项目放在 `mazmot/preview/` 目录下，便于管理
- 预览窗口支持基本的交互功能，如表单填写、按钮点击等