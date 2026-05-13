---
name: fetch-url
description: 从指定 URL 获取内容
---

# 获取 URL 内容

**fetch-url** 用于从指定的 URL 获取内容。支持限制返回内容大小，并可选择性清理 HTML 标签，只保留文本内容。

## 基本用法

<cap-request>
[
  {
    "capability": "fetch-url",
    "id": "abc123",
    "description": "获取指定URL的内容",
    "opts": {
      "url": "https://example.com/api/data"
    }
  }
]
</cap-request>

工具将返回该 URL 的原始内容。

<cap-response>
[
  {
    "capability": "fetch-url",
    "id": "abc123",
    "result": "返回的内容文本..."
  }
]
</cap-response>

## 限制返回大小

<cap-request>
[
  {
    "capability": "fetch-url",
    "id": "abc456",
    "description": "获取URL内容并限制大小",
    "opts": {
      "url": "https://example.com/large-file",
      "maxSize": 10240
    }
  }
]
</cap-request>

工具将返回限制大小内的内容。

<cap-response>
[
  {
    "capability": "fetch-url",
    "id": "abc456",
    "result": "限制大小内的内容..."
  }
]
</cap-response>

## 清理 HTML 内容

<cap-request>
[
  {
    "capability": "fetch-url",
    "id": "abc789",
    "description": "获取HTML页面并清理标签",
    "opts": {
      "url": "https://example.com/page.html",
      "cleanHTML": true
    }
  }
]
</cap-request>

工具将返回清理后的纯文本内容。

<cap-response>
[
  {
    "capability": "fetch-url",
    "id": "abc789",
    "result": "清理后的纯文本内容..."
  }
]
</cap-response>

## 参数说明

- `url` (必需): 要请求的 URL 地址
- `maxSize` (可选): 限制最大返回大小（字节数），默认为 32KB (32768 字节)
- `cleanHTML` (可选): 是否清理 HTML 标签，只返回包含文本的内容，默认为 true。仅当内容包含 `<!doctype html>` 时才会清理
