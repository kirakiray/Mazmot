这是一个简单的聊天组件，在 comps/chatbox 目录内，完整对应的 ofajs 组件：

- chatbox.html
  - 用于包裹 chat-item 的组件
- chat-item.html
  - 用于显示聊天项的组件
  - role属性：指定聊天项的角色，可选值为：
    - system：系统消息
    - assistant：助手发送的消息
    - user：用户发送的消息
- demo.html
  - 用于演示 chatbox 组件的使用方法

要求：
- 组件必须在 ofajs 中注册
- 可用颜色使用 https://punch-ui-v2.pages.dev/packages/css/pui-global.css 中定义的颜色

最终的使用代码效果为：

```html
<m-chatbox>
  <m-chat-item role="system">你是一个助手，你的任务是回答用户的问题。</m-chat-item>
  <m-chat-item role="user">你好，你是谁啊？</m-chat-item>
  <m-chat-item role="assistant">我是一个助手，你可以回答用户的问题。你好！</m-chat-item>
</m-chatbox>
```

写完组件后，在 demo.html 中演示组件的使用方法。

---

给 chatbox 组件添加可以获取到聊天格式json数据的方法，方法名为 getChatJson。
方法返回值为一个字符串，字符串内容为聊天记录的json数据。
json数据的格式为：
```json
[
  {
    "role": "system",
    "content": "你是一个助手，你的任务是回答用户的问题。"
  },
  {
    "role": "user",
    "content": "你好，你是谁啊？"
  },
  {
    "role": "assistant",
    "content": "我是一个助手，你可以回答用户的问题。你好！"
  }
]
```

---

使用方法错了，应该是
```javascript
const chatbox = $('m-chatbox');
const jsonStr = chatbox.getChatJson();
console.log(jsonStr);
```

现在你在 comps/chatbox/demo.html 中演示组件的使用方法。