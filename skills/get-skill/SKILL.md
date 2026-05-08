---
name: get-skill
description: 获取所有技能或指定技能的详细信息
---

# 获取技能

**get-skill** 用于获取技能列表或指定技能的详细信息。当你不确定有哪些可用技能时，可获取全部列表；当你需要某个技能的详细说明时，也可精准查询。

## 获取所有技能列表

<skill-request>
- skill: get-skill
  id: nez1t2d
  description: 获取所有技能或指定技能的详细信息
  opts:
    all: true
</skill-request>

工具将返回所有技能的名称和简要描述。

<skill-response>
- skill: get-skill
  id: nez1t2d
  result: [
    {
      name: "fetch-url",
      description: "从指定 URL 获取内容"
    },
    {
      name: "get-skill",
      description: "...."
    },
    ...
  ]
</skill-response>

## 获取指定技能的详细信息

<skill-request>
- skill: get-skill
  id: nez1333
  description: 获取fetch-url技能的详细信息
  opts:
    name:
      - fetch-url
</skill-request>

工具将返回 fetch-url 技能的完整描述。

<skill-response>
- skill: get-skill
  id: nez1333
  result:
    - name: fetch-url
      description: 从指定 URL 获取内容...（该技能的详细描述）
</skill-response>
