# Chatbox 聊天组件

一个基于 ofa.js 的聊天界面组件，用于展示对话消息，支持系统、用户、助手三种角色。

## 组件说明

### m-chatbox

聊天容器组件，用于包裹和展示聊天消息列表。

### m-chat-item

聊天消息项组件，用于显示单条消息，支持三种角色：

- `system`: 系统消息，用于设置对话上下文或规则，默认折叠显示
- `user`: 用户消息，右对齐显示
- `assistant`: 助手消息，左对齐显示

## 引入方式

```html
<script
  src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.min.mjs"
  type="module"
></script>
<link
  rel="stylesheet"
  href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
/>

<l-m src="./chatbox.html"></l-m>
<l-m src="./chat-item.html"></l-m>
```

## 使用示例

### 基础用法

```html
<m-chatbox>
  <m-chat-item role="system"
    >你是一个助手,你的任务是回答用户的问题。</m-chat-item
  >
  <m-chat-item role="user">你好,你是谁啊?</m-chat-item>
  <m-chat-item role="assistant"
    >我是一个助手,你可以回答用户的问题。你好!</m-chat-item
  >
</m-chatbox>
```

### 多轮对话

```html
<m-chatbox>
  <m-chat-item role="system">你是一个专业的技术顾问。</m-chat-item>
  <m-chat-item role="user">请问什么是 Web Components?</m-chat-item>
  <m-chat-item role="assistant"
    >Web Components 是一套不同的技术,允许你创建可重用的定制元素。</m-chat-item
  >
  <m-chat-item role="user">它有哪些主要技术?</m-chat-item>
  <m-chat-item role="assistant"
    >Web Components 主要包括四项技术:Custom Elements、Shadow DOM、HTML templates
    和 HTML Imports。</m-chat-item
  >
</m-chatbox>
```

## API

### m-chatbox

#### 方法

| 方法名      | 说明                                       |
| ----------- | ------------------------------------------ |
| getChatJson | 获取聊天记录的数组对象，返回标准对话格式 |

**getChatJson 返回格式示例：**

```javascript
[
  { role: "system", content: "你是一个助手，你的任务是回答用户的问题。" },
  { role: "user", content: "你好，你是谁啊？" },
  { role: "assistant", content: "我是一个助手，你可以回答用户的问题。你好！" }
]
```

**使用示例：**

```javascript
const chatbox = $('m-chatbox');
const chatData = chatbox.getChatJson();
console.log(JSON.stringify(chatData, null, 2));
```

### m-chat-item

#### 属性

| 属性名 | 类型   | 默认值 | 说明                                            |
| ------ | ------ | ------ | ----------------------------------------------- |
| role   | string | "user" | 消息角色，可选值: `system`、`user`、`assistant` |

#### 方法

| 方法名         | 说明                        |
| -------------- | --------------------------- |
| toggleCollapse | 切换系统消息的折叠/展开状态 |

## 样式特点

- 使用 Material Design 配色方案
- 系统消息默认折叠，点击可展开查看详细内容
- 用户消息右对齐，使用主色调背景
- 助手消息左对齐，使用中性色背景
- 每条消息带有角色头像标识（S/U/A）
