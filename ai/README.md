# AI Assistant

一个轻量级的 AI 助手封装库，支持多个 AI 提供商，提供统一的 API 接口。

## 支持的提供商

| 提供商 | 模型 | 思考模式 | 流式输出 |
|--------|------|----------|----------|
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro | ✅ | ✅ |
| Kimi | kimi-k2.6, kimi-k2-thinking | ✅ | ✅ |

## 安装使用

```html
<script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.min.mjs" type="module"></script>
```

```javascript
import { saveKey, getAssistant, apiKeys } from "./main.js";
```

## API

### saveKey(apiKey, provider)

保存 API Key 并返回 Assistant 实例。

```javascript
const assistant = await saveKey("sk-xxx", "deepseek");
```

### getAssistant(id)

根据 ID 获取 Assistant 实例。

```javascript
const assistant = await getAssistant("abc123");
```

### apiKeys

存储所有 API Key 的响应式数组。

```javascript
console.log(apiKeys.length);
```

## Assistant API

### chat(options)

与 AI 进行对话。

```javascript
const response = await assistant.chat({
  message: "你好",
  thinking: false,
  stream: false,
  model: "deepseek-v4-flash",
  systemPrompt: "You are a helpful assistant.",
  onStream: (data) => {
    console.log(data.content);
    console.log(data.reasoningContent);
  },
});
```

#### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| message | string | - | 用户消息 |
| thinking | boolean | false | 是否启用思考模式 |
| stream | boolean | false | 是否启用流式输出 |
| model | string | - | 模型名称 |
| messages | array | null | 自定义消息数组 |
| systemPrompt | string | "You are a helpful assistant." | 系统提示词 |
| onStream | function | null | 流式输出回调 |
| thinkingKeep | string | null | Kimi 专用，保留历史思考 |

#### 返回值

```javascript
{
  content: "AI 回复内容",
  reasoningContent: "思考过程（启用 thinking 时）",
  model: "使用的模型",
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  raw: { /* 原始响应 */ }
}
```

### getModels()

获取可用模型列表。

```javascript
const models = await assistant.getModels();
```

### getRemaining()

获取账户余额信息。

```javascript
const remaining = await assistant.getRemaining();
```

## Demo

运行演示应用：

```bash
cd demo
npx serve .
```

访问 `http://localhost:3000`

### Demo 功能

- **API Key 管理** - 添加、删除 API Key
- **AI 聊天** - 与 AI 进行对话
  - 流式输出开关
  - 思考模式开关
  - 思考过程折叠显示

## 项目结构

```
ai/
├── main.js              # 主入口，API Key 管理和 Assistant 工厂
├── supplier/            # AI 提供商实现
│   ├── assistant.js     # Assistant 基类
│   ├── deepseek.js      # DeepSeek 实现
│   └── kimi.js          # Kimi 实现
└── demo/                # 演示应用
    ├── index.html       # 入口页面
    ├── app-config.js    # 应用配置
    ├── api-keys.html    # API Key 管理页面
    ├── chat.html        # 聊天页面
    └── layout.html      # 布局模板
```

## 技术栈

- [ofa.js](https://github.com/ofajs/ofa.js) - 前端框架
- [ever-cache](https://github.com/kirakiray/ever-cache) - 本地存储
- [Punch-UI](https://punch-ui-v2.pages.dev/) - UI 组件库

## 思考模式

DeepSeek 和 Kimi 都支持思考模式，会返回 `reasoningContent` 字段包含推理过程。

### DeepSeek

```javascript
await assistant.chat({
  message: "解释相对论",
  thinking: true,
  reasoningEffort: "high", // low, medium, high
});
```

### Kimi

```javascript
await assistant.chat({
  message: "解释相对论",
  thinking: true,
  thinkingKeep: "all", // 保留历史思考（多轮对话）
});
```

## 流式输出

启用流式输出时，通过 `onStream` 回调实时获取响应：

```javascript
await assistant.chat({
  message: "写一首诗",
  stream: true,
  onStream: (data) => {
    console.log("当前累计内容:", data.content);
    console.log("本次增量:", data.delta);
    console.log("是否完成:", data.done);
  },
});
```
