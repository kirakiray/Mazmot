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

工具将返回指定能力的完整文档。如需查询多个能力，请使用多个 `<template>` 标签，每个标签查询一个能力。

## 获取能力目录下的特定文件

<cap-request>
  <template name="get-capability" cid="cap135" desc="获取 fs 能力的 main.js 文件内容" data-name="fs" data-file="main.js">
  </template>
</cap-request>

通过 `data-file` 参数可以获取能力目录下的特定文件内容。文件路径相对于能力目录根目录。这对于获取能力相关的代码示例、测试文件等资源非常有用。
