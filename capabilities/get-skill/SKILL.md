---
name: get-skill
description: 获取所有技能或指定技能的详细信息
method: main.js
test: test/test-get-skill.html
---

# 获取技能

**get-skill** 用于获取技能列表或指定技能的详细信息。当你不确定有哪些可用技能时，可获取全部列表；当你需要某个技能的详细说明时，也可精准查询。

## 获取所有技能列表

<cap-request>
  <template name="get-skill" cid="sk1t2d" desc="获取所有技能列表" data-all="true"></template>
</cap-request>

工具将返回所有技能的名称和简要描述。

## 获取指定技能的详细使用信息

<cap-request>
  <template name="get-skill" cid="sk134" desc="获取 ofajs-docs 技能的详细使用信息" data-name="ofajs-docs">
  </template>
</cap-request>

工具将返回指定技能的完整文档。如需查询多个技能，请使用多个 `<template>` 标签，每个标签查询一个技能。
