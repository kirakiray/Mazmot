---
name: get-capability
description: 获取所有能力或指定能力的详细信息
---

# 获取能力

**get-capability** 用于获取能力列表或指定能力的详细信息。当你不确定有哪些可用能力时，可获取全部列表；当你需要某个能力的详细说明时，也可精准查询。

## 获取所有能力列表

<cap-request>
- capability: get-capability
  id: nez1t2d
  description: 获取所有能力列表
  opts:
    all: true
</cap-request>

工具将返回所有能力的名称和简要描述。

## 获取指定能力的详细使用信息

<cap-request>
- capability: get-capability
  id: nez1333
  description: 获取fetch-url能力的详细使用信息
  opts:
    name:
      - fetch-url
</cap-request>

工具将返回 fetch-url 能力的完整描述。
