---
name: get-capability
description: 获取所有能力或指定能力的详细信息
method: main.js
test: test/test-get-capability.html
---

# 获取能力

**get-capability** 用于获取能力列表或指定能力的详细信息。当你不确定有哪些可用能力时，可获取全部列表；当你需要某个能力的详细说明时，也可精准查询。

## 获取所有能力列表

<cap-request>
  <template name="get-capability" cid="nez1t2d" desc="获取所有能力列表" data-all="true"></template>
</cap-request>

工具将返回所有能力的名称和简要描述。

## 获取指定能力的详细使用信息

<cap-request>
  <template name="get-capability" cid="nez134" desc="获取 custom-form 能力的详细使用信息" data-name="custom-form">
  <template name="get-capability" cid="nez133" desc="获取 fetch-url 能力的详细使用信息" data-name="fetch-url">
  </template>
</cap-request>

工具将返回指定能力的完整文档。`data-name` 支持逗号分隔的多个能力名称，一次可查询多个。
