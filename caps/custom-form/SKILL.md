---
name: custom-form
description: 允许AI创建表单，用户通过填写表单的方式向 AI 提交结构化信息。
page: ./src/form.html
---

# 自定义表单交互

自定义表单交互组件让用户通过表单界面向 AI 提交结构化信息。

相比传统对话模式的文本输入，`custom-form` 组件提供更直观的表单界面（如单选、多选、下拉选择等），提升交互体验。

## 基本用法

以下示例展示了如何创建一个包含多种字段类型的完整表单：

<cap-request>
  <template name="custom-form" cid="custom-form-01" desc="自定义提交表单">
    [ { "type": "radio", "name": "gender", "desc": "请选择您的性别", "required": true, "defaultValue": "male", "options": [ { "label": "男", "value": "male" }, { "label": "女", "value": "female" } ] }, { "type": "text", "name": "name", "desc": "姓名", "required": true, "placeholder": "请输入您的姓名" }, { "type": "textarea", "name": "bio", "desc": "个人简介", "placeholder": "请输入个人简介", "maxlength": 200 }, { "type": "select", "name": "country", "desc": "国家/地区", "required": true, "placeholder": "请选择国家", "options": [ { "label": "中国", "value": "cn" }, { "label": "美国", "value": "us" }, { "label": "日本", "value": "jp" } ] }, { "type": "checkbox", "name": "hobbies", "desc": "兴趣爱好", "required": true, "defaultValue": ["reading"], "options": [ { "label": "阅读", "value": "reading" }, { "label": "运动", "value": "sports" }, { "label": "音乐", "value": "music" }, { "label": "旅行", "value": "travel" } ] }, { "type": "switch", "name": "notifications", "desc": "接收通知", "label": "启用通知", "defaultValue": true }, { "type": "submit", "name": "提交" }, { "type": "cancel", "name": "取消" } ]
  </template>
</cap-request>

用户填写并提交表单后，AI 将接收到结构化的表单数据：

<cap-response>
  <template result name="custom-form" cid="custom-form-01">
    { "gender": "female", "name": "张三", "bio": "这是一段个人简介", "country": "cn", "hobbies": ["reading", "music"], "notifications": true }
  </template>
</cap-response>

## 字段类型说明

表单配置采用 JSON 数组格式，每个数组元素定义一个表单字段。系统支持以下字段类型：

| 类型        | 说明           | 特有属性                                                       |
| ----------- | -------------- | -------------------------------------------------------------- |
| `radio`     | 单选按钮组     | `options`: 选项列表                                           |
| `text`      | 单行文本输入   | `placeholder`: 占位提示文本                                   |
| `textarea`  | 多行文本输入   | `placeholder`: 占位提示文本, `maxlength`: 最大字符数          |
| `select`    | 下拉选择框     | `options`: 选项列表, `placeholder`: 占位提示文本              |
| `checkbox`  | 多选框组       | `options`: 选项列表                                            |
| `switch`    | 开关控件       | `label`: 开关标签文本                                         |
| `submit`    | 提交按钮       | `name`: 按钮显示文本                                           |
| `cancel`    | 取消按钮       | `name`: 按钮显示文本                                           |

## 字段通用属性

所有字段类型均支持以下通用属性：

| 属性           | 必需 | 说明                                     |
| -------------- | ---- | ---------------------------------------- |
| `type`         | 是   | 字段类型，详见上方字段类型说明表          |
| `name`         | 是   | 字段名称，作为提交数据时的标识键          |
| `desc`         | 是   | 字段描述，显示在表单中供用户阅读           |
| `required`     | 否   | 是否为必填项，默认为 `false`              |
| `defaultValue` | 否   | 字段默认值                               |
| `options`      | 否   | 选项列表，仅适用于 `radio`、`checkbox`、`select` 类型 |
| `placeholder`  | 否   | 占位提示文本，仅适用于 `text`、`textarea`、`select` 类型 |
| `maxlength`    | 否   | 最大字符数限制，仅适用于 `textarea` 类型  |
| `label`        | 否   | 标签文本，仅适用于 `switch` 类型          |

## 选项格式

`options` 属性用于定义单选、多选和下拉选择字段的可选项，格式为数组，每个选项对象包含以下属性：

| 属性    | 说明     |
| ------- | -------- |
| `label` | 选项显示文本 |
| `value` | 选项提交值   |
