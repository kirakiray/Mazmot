---
name: preview-web
description: 可以预览本地网页文件的内容
method: main.js
---

# Preview Web

这是一个用来预览网页的能力，当传入一个地址，就可以预览该网页的内容。

## 基本用法

以下示例展示了如何使用 preview-web 能力预览网页：

<cap-request>
  <template name="preview-web" cid="preview-web-01" desc="预览网页内容">
    { "url": "/demo/preview-demo.html", "title": "示例网页预览" }
  </template>
</cap-request>

预览完成后，AI 将接收到网页的相关信息：

<cap-response>
  <template result name="preview-web" cid="preview-web-01">
    { "success": true, "url": "/demo/preview-demo.html", "title": "示例网页预览", "timestamp": "2024-01-01T12:00:00Z" }
  </template>
</cap-response>

## 参数说明

preview-web 能力接受以下参数：

| 参数    | 必需 | 说明                                     |
| ------- | ---- | ---------------------------------------- |
| `url`   | 是   | 要预览的网页地址，可以是相对路径或绝对路径 |
| `title` | 否   | 预览窗口的标题，默认为"网页预览"          |
| `width` | 否   | 预览窗口的宽度，默认为 800px             |
| `height`| 否   | 预览窗口的高度，默认为 600px             |

## 使用场景

preview-web 能力适用于以下场景：

1. **本地开发预览**：在开发过程中快速预览本地 HTML 文件
2. **组件演示**：展示组件库或页面的实际效果
3. **文档示例**：在文档中嵌入可交互的网页示例
4. **测试验证**：验证网页的渲染效果和交互功能

## 注意事项

- 预览的网页地址必须是可访问的本地路径或网络地址
- 如果网页加载失败，将返回错误信息
- 预览窗口支持基本的交互功能，如表单填写、按钮点击等
