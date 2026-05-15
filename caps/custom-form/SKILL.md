---
name: custom-form
description: 允许用户通过自定义表单的交互方式向 AI 提交信息。
page: ./src/form.html
---

# 自定义表单交互

默认情况下，AI使用的是文本对话交互，但是利用这个custom-form 能力，就可以让用户通过点击表单提交的方式向 AI 提交信息。

## 基本用法

<cap-request>
[
  {
    "capability": "custom-form",
    "id": "form001",
    "description": "提交表单",
    "opts": {
      "data": {
        "gender": "male",
        "name": "张三"
      }
    }
  }
]
</cap-request>
