---
name: fetch-url
description: 从指定 URL 获取内容
method: main.js
test: test/test-fetch-url.html
---

# 获取 URL 内容

**fetch-url** 用于从指定的 URL 获取内容。支持限制返回内容大小，并可选择性清理 HTML 标签，只保留文本内容。

## 基本用法

<cap-request>
  <template name="fetch-url" cid="abc123" desc="获取指定 URL 的内容" data-url="https://example.com/api/data"></template>
</cap-request>

工具将返回该 URL 的原始内容。

<cap-response>
  <template result name="fetch-url" cid="abc123">
    返回的内容文本...
  </template>
</cap-response>

## 限制返回大小

<cap-request>
  <template name="fetch-url" cid="abc456" desc="获取 URL 内容并限制大小" data-url="https://example.com/large-file" data-max-size="10240"></template>
</cap-request>

工具将返回限制大小内的内容。

<cap-response>
  <template result name="fetch-url" cid="abc456">
    限制大小内的内容...
  </template>
</cap-response>

## 清理 HTML 内容

<cap-request>
  <template name="fetch-url" cid="abc789" desc="获取 HTML 页面并清理标签" data-url="https://example.com/page.html" data-clean-html="true"></template>
</cap-request>

工具将返回清理后的纯文本内容。

<cap-response>
  <template result name="fetch-url" cid="abc789">
    清理后的纯文本内容...
  </template>
</cap-response>

## 参数说明

| 参数              | 必需 | 说明                                                                                           |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `data-url`        | 是   | 要请求的 URL 地址                                                                              |
| `data-max-size`   | 否   | 限制最大返回大小（字节数），默认 32KB (32768 字节)                                             |
| `data-clean-html` | 否   | 是否清理 HTML 标签，只返回包含文本的内容，默认 true。仅当内容包含 `<!doctype html>` 时才会清理 |
