# AI Assistant

一个轻量级的 AI 助手封装库，支持多个 AI 提供商，提供统一的 API 接口。

## 支持的提供商

| 提供商 | 模型 | 思考模式 | 流式输出 |
|--------|------|----------|----------|
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro | ✅ | ✅ |
| Kimi | kimi-k3, kimi-k2.7-code, kimi-k2.6, kimi-k2.5 | ✅ | ✅ |

> 注：`kimi-k2-thinking` / `kimi-latest` / `kimi-thinking-preview` 已于 2026 年陆续下线，请使用 `kimi-k3` 等新模型。`deepseek-chat` / `deepseek-reasoner` 旧模型名已于 2026/07/24 弃用，分别对应 `deepseek-v4-flash` 的非思考与思考模式。

## 安装使用

入口 HTML 引用 ofa.js（顶层入口走 jsdelivr 完整 URL，模块内用 `/gh/` 本地前缀，详见 [AGENTS.md](../AGENTS.md)）：

```html
<script src="https://cdn.jsdelivr.net/gh/ofajs/ofa.js@4.7.1/dist/ofa.mjs#debug" type="module"></script>
```

```javascript
import { saveKey, getAssistant, getApiKeys, onApiKeysChange, removeKey } from "/ai/main.js";
```

## API

### saveKey(apiKey, provider)

保存 API Key 并返回 Assistant 实例。写入后会自动持久化到本地存储（nos storage），并通知所有 `onApiKeysChange` 订阅者。

- `provider` 取值：`"deepseek"` / `"kimi"`

```javascript
const assistant = await saveKey("sk-xxx", "deepseek");
```

### removeKey(id)

按 id 删除一条 API Key，返回是否删除成功。同样自动持久化 + 通知订阅者。

```javascript
removeKey("abc123"); // true / false
```

### getAssistant(id?)

根据 id 获取 Assistant 实例。**不传 id** 时从已保存的 key 中随机选一个（适用于多 key 负载均衡）。空列表抛 `no api key available`，id 不存在抛 `key not found`。

> 同步函数（无 IO），调用方可省略 `await`。

```javascript
const assistant = getAssistant("abc123");
// 或随机取一个
const anyAssistant = getAssistant();
```

### getApiKeys()

返回当前所有 API Key 的**快照**（浅拷贝数组，安全可读，不会随内部状态变化）。UI 层应通过 `onApiKeysChange` 维持实时视图，而不是长期持有这个引用。

```javascript
const keys = getApiKeys();
console.log(keys.length, keys.map(k => k.maskedKey));
```

返回的 key 对象结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 内部生成的唯一 id（用于 `getAssistant` / `removeKey`） |
| `provider` | string | `"deepseek"` / `"kimi"` |
| `apiKey` | string | 原始 key（敏感，UI 展示请用 `maskedKey`） |
| `maskedKey` | string | 脱敏后的展示串，如 `sk-abcd...wxyz` |
| `createdAt` | string | ISO 时间戳 |
| `formattedDate` | string | 本地化时间字符串 |

### onApiKeysChange(callback)

订阅 API Key 列表变化（`saveKey` / `removeKey` 触发）。回调收到一份新的只读快照数组。返回**取消订阅函数**，组件销毁时务必调用以避免内存泄漏。

本模块不依赖任何框架响应式，UI 层（ofa.js / React / 原生等）可借此同步视图。

```javascript
const unsub = onApiKeysChange((keys) => {
  console.log("列表更新，共", keys.length, "条");
});
// 组件销毁时
unsub();
```

### testApiKey(apiKey, provider)

验证 API Key 是否有效（不写入列表，仅调用 `getModels()` 探测）。返回 `{ valid, message }`，**不会抛异常**，错误信息通过 `message` 返回。

```javascript
const { valid, message } = await testApiKey("sk-xxx", "kimi");
if (!valid) alert(message);
```

### 完整使用流程

```javascript
import {
  saveKey, removeKey, getAssistant,
  getApiKeys, onApiKeysChange, testApiKey,
} from "./main.js";

// 1. 验证 key
const { valid } = await testApiKey("sk-xxx", "deepseek");
if (!valid) throw new Error("key 无效");

// 2. 持久化保存
await saveKey("sk-xxx", "deepseek");

// 3. UI 订阅变化
const unsub = onApiKeysChange((keys) => {
  renderKeyList(keys); // 自行渲染
});

// 4. 发起对话
const assistant = await getAssistant(); // 不传 id 随机取
const result = await assistant.chat({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "你好" }],
});

// 5. 清理
unsub();
removeKey("某条 id");
```

## Assistant API

### providerName

只读属性，标识该实例来自哪个提供商，取值为全小写字符串 `"deepseek"` / `"kimi"`（与 key 对象的 `provider` 一致）。用 `getAssistant()` 随机取实例时，可读取它判断拿到的是哪家。

```javascript
const assistant = getAssistant();
console.log(assistant.providerName); // "deepseek" 或 "kimi"
```

### chat(options)

与 AI 进行对话。

```javascript
const response = await assistant.chat({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "你好" },
  ],
  thinking: false,
  stream: false,
  model: "deepseek-v4-flash",
  onStream: (data) => {
    console.log(data.content);
    console.log(data.reasoningContent);
  },
});
```

#### 多轮对话示例

```javascript
const response = await assistant.chat({
  messages: [
    { role: "system", content: "你是一个专业的程序员。" },
    { role: "user", content: "什么是闭包？" },
    { role: "assistant", content: "闭包是..." },
    { role: "user", content: "再详细说说" },
  ],
});
```

#### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| messages | array | - | 消息数组，包含 role 和 content |
| thinking | boolean | false | 是否启用思考模式（DeepSeek / Kimi k2.6 / k2.5 生效） |
| stream | boolean | false | 是否启用流式输出 |
| model | string | - | 模型名称 |
| onStream | function | null | 流式输出回调 |
| reasoningEffort | string | "high" | DeepSeek / Kimi `kimi-k3` 专用，推理强度（DeepSeek：`high` / `max`；kimi-k3：`low` / `high` / `max`） |
| thinkingKeep | string | null | 仅 Kimi `kimi-k2.6` 支持，传 `"all"` 启用保留式思考 |
| signal | AbortSignal | null | 传入 `AbortSignal` 用于取消请求；abort 后 `chat` 会抛出 `AbortError`，底层连接和流读取立即释放 |
| tools | array | null | OpenAI 风格函数定义（function calling）：`[{ type: "function", function: { name, description, parameters } }]`，一般由 [chain 层](#chain-langchain-风格封装) 的 `tool().toWire()` 生成 |
| toolChoice | string | "auto" | 配合 `tools` 使用，透传给供应商（如 `"auto"` / `"none"` / `{ type: "function", function: { name } }`） |

> Kimi 不同模型的思考行为差异较大，详见 [Kimi 思考模型文档](https://platform.kimi.com/docs/guide/use-thinking-models)：
> - `kimi-k3`：始终思考、不支持 `thinking` 参数，通过 `reasoningEffort` 调节强度（官方默认 "max"，本库默认降为 "high"）
> - `kimi-k2.7-code`：始终思考，`thinking` 参数无效
> - `kimi-k2.6`：`thinking` 默认 true，支持 `thinkingKeep: "all"`
> - `kimi-k2.5`：`thinking` 默认 true，不支持保留式思考

#### 返回值

```javascript
{
  content: "AI 回复内容",
  reasoningContent: "思考过程（启用 thinking 时）",
  toolCalls: [], // 模型发起的函数调用（wire 格式），无工具时为空数组；流式模式下同样返回累积结果
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

## 思考模式

DeepSeek 和 Kimi 都支持思考模式，会返回 `reasoningContent` 字段包含推理过程。

### DeepSeek

DeepSeek 默认开启思考模式，可通过 `thinking: false` 关闭。思考强度通过 `reasoningEffort` 控制（详见 [DeepSeek 思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)）。

```javascript
// deepseek-v4-pro + 思考模式
await assistant.chat({
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "解释相对论" }],
  thinking: true,
  reasoningEffort: "max", // "high"（默认）或 "max"
});
```

> DeepSeek 官方仅接受 `high` / `max`。出于兼容考虑，传入 `low` / `medium` 会被映射为 `high`，`xhigh` 会被映射为 `max`。

### Kimi

Kimi 不同模型对思考参数的支持不同，**请按模型选用参数**：

```javascript
// ✅ kimi-k3：始终思考，通过 reasoningEffort 调节强度，不传 thinking
await assistant.chat({
  model: "kimi-k3",
  messages: [{ role: "user", content: "解释相对论" }],
  reasoningEffort: "max", // "low" / "high"（默认） / "max"
});

// ✅ kimi-k2.6：支持 thinking 开关 + thinkingKeep
await assistant.chat({
  model: "kimi-k2.6",
  messages: [{ role: "user", content: "解释相对论" }],
  thinking: true,
  thinkingKeep: "all", // 保留历史思考（多轮对话）
});

// ✅ kimi-k2.7-code：始终思考，thinking 参数无效，可不传
await assistant.chat({
  model: "kimi-k2.7-code",
  messages: [{ role: "user", content: "解释相对论" }],
});

// ❌ 错误用法：对 kimi-k3 / kimi-k2.7-code 传 thinking 会报错
// await assistant.chat({
//   model: "kimi-k3",
//   thinking: true, // 错误！k3 不支持 thinking 参数
//   ...
// });
```

## 流式输出

启用流式输出时，通过 `onStream` 回调实时获取响应：

```javascript
await assistant.chat({
  messages: [{ role: "user", content: "写一首诗" }],
  stream: true,
  onStream: (data) => {
    console.log("当前累计内容:", data.content);
    console.log("本次增量:", data.delta);
    console.log("思考增量:", data.deltaReasoning);
    console.log("函数调用增量:", data.deltaToolCalls); // 触发 tool call 的分片，无则为 null
    console.log("累计函数调用:", data.toolCalls); // 累积的 tool_calls（wire 格式）
    console.log("是否完成:", data.done);
  },
});
```

## 取消请求

`chat` 支持 `signal` 参数（标准 `AbortSignal`），用于中途取消请求。abort 后 `chat` 会抛出名为 `AbortError` 的异常，底层连接和流读取会立即释放，避免继续消耗 API 配额。

```javascript
const controller = new AbortController();

// 某个按钮触发取消
// cancelButton.onclick = () => controller.abort();

try {
  await assistant.chat({
    messages: [{ role: "user", content: "写一篇长文" }],
    stream: true,
    signal: controller.signal,
    onStream: (data) => console.log(data.delta),
  });
} catch (err) {
  if (err.name === "AbortError") {
    console.log("已取消");
  } else {
    throw err;
  }
}
```

## Chain（LangChain 风格封装）

`ai/chain/` 在 supplier 层之上封装了一套类似 LangChain 的使用流：chat model、工具调用、Agent 循环与会话记忆。消息既可用类实例（`HumanMessage` 等），也兼容 `{ role, content }` 普通对象。

```javascript
import {
  createChatModel, createAgent, tool, MemorySaver, textOf,
} from "/ai/chain/main.js";
```

### 基础对话（对应 01-chat）

```javascript
const chatModel = createChatModel(); // 不传 keyId 时随机选一条已保存的 key

const response = await chatModel.invoke([
  { role: "system", content: "你是一位耐心的资深前端导师。用简洁中文回答。" },
  { role: "user", content: "解释 React 中受控组件和非受控组件的区别。" },
]);

console.log(textOf(response.content)); // AI 回复
console.log(response.usageMetadata); // { inputTokens, outputTokens, totalTokens }
```

`createChatModel(defaults)` 的 defaults 支持 `keyId` / `model` / `thinking` / `reasoningEffort` / `thinkingKeep` / `assistant`（直接注入 Assistant 实例，测试用），调用 `invoke` / `stream` 时可用 options 覆盖。走 `keyId` 取 key 时才会按需加载 `../main.js`（其依赖 `/nos/storage`），因此 chain 模块本身可在 NoneOS Core 就绪前安全引入。

### Agent + 工具（对应 02-agent）

浏览器没有 zod，schema 用简写对象，内部转成 JSON Schema：

```javascript
const calculator = tool(
  async ({ expression }) => {
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "表达式只能包含数字、空格和 + - * / ( )。";
    }
    try {
      return String(Function(`"use strict"; return (${expression})`)());
    } catch {
      return "无法解析这个表达式。";
    }
  },
  {
    name: "calculator",
    description: "计算一个基础算术表达式。当问题涉及精确计算时必须使用它。",
    schema: {
      expression: { type: "string", description: "例如：(128 * 0.85 + 20) / 2" },
    },
  },
);

const agent = createAgent({
  model: chatModel,
  tools: [calculator],
  systemPrompt: "你是前端技术助手。需要精确数值时调用 calculator。",
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "(128 * 0.85 + 20) / 2 等于多少？" }],
});

// 完整轨迹：system → human → ai(toolCalls) → tool → ai(最终回答)
for (const message of result.messages) {
  console.log(`[${message.getType()}]`, textOf(message.content));
  if (message.toolCalls?.length) console.log("tool_calls:", message.toolCalls);
}

console.log(textOf(result.messages.at(-1).content)); // 最终回答
```

工具执行失败（参数非法 / 抛异常）不会中断循环，错误信息会以文本形式回给模型，让模型自行纠正。

### 流式 Agent（对应 02-agent-stream）

两种 streamMode，对应 LangGraph 的同名模式：

```javascript
const input = { messages: [{ role: "user", content: "128 * 0.85 等于多少？" }] };

// 模式一 updates：每个节点（model / tools）跑完推送该节点新增的消息，适合调试决策链路
for await (const chunk of agent.stream(input, { streamMode: "updates" })) {
  for (const [node, update] of Object.entries(chunk)) {
    for (const message of update.messages) {
      console.log(`[${node}/${message.getType()}]`, textOf(message.content));
    }
  }
}

// 模式二 messages：逐 token 推送 AIMessage 增量（打字机效果）+ 完整 ToolMessage
let typed = "";
for await (const message of agent.stream(input, { streamMode: "messages" })) {
  if (message.getType() !== "ai") continue; // 过滤掉工具消息
  typed += textOf(message.content); // 逐步渲染到 UI，实现打字机效果
}
```

### 会话记忆（对应 03-memory）

`MemorySaver` 按 `thread_id` 保存消息（仅内存，刷新即失）；`systemPrompt` 每次运行重新注入、不写入记忆：

```javascript
const agentWithMemory = createAgent({
  model: chatModel,
  tools: [],
  checkpointer: new MemorySaver(),
  systemPrompt: "你是前端导师。记住同一个会话中用户已经说过的信息。",
});

const config = { configurable: { thread_id: "frontend-learner-001" } };

await agentWithMemory.invoke(
  { messages: [{ role: "user", content: "我叫小林，正在把 Vue 2 项目迁到 Vue 3。" }] },
  config
);

// 第二轮复用同一 thread_id，Agent 自动带上第一轮历史
const second = await agentWithMemory.invoke(
  { messages: [{ role: "user", content: "根据刚才的信息，给我一个优先处理的迁移风险。" }] },
  config
);
console.log(textOf(second.messages.at(-1).content));
```

需要持久化记忆时，实现 `{ get, set, delete }` 异步接口的对象即可作为 checkpointer 传入（如基于 `/nos/storage` 的实现）。

### Agent 其他说明

- `maxSteps`（默认 12）：模型↔工具往返上限，超限抛错，防止模型陷入工具循环。
- `stream(input, { signal })` / `invoke(input, { signal })` 支持传入 `AbortSignal` 取消请求。
- `input` 可传 `{ messages: [...] }` 或直接传消息数组。
- `MemorySaver` 提供 `get` / `set` / `delete` / `clear`；`delete` / `clear` 可手动清理某个 thread 的记忆。

## 测试

本项目使用 [sibyl-test](https://github.com/ofajs/sibyl-test) 编写浏览器测试。

### 准备工作

1. 在 [ai/test-api-keys.json](./test-api-keys.json) 填入真实的 API Key（该文件已被 `.gitignore` 忽略）：

   ```json
   {
     "deepseek": "sk-your-real-deepseek-key",
     "kimi": "sk-your-real-kimi-key"
   }
   ```

2. 如果尚未安装浏览器依赖，先运行：

   ```bash
   npx sb-test --install
   ```

### 运行测试

两个测试文件均以 `-sb.html` 结尾（而非 `.sb.html`），**故意不被 `npm test` / CI 自动发现**（真实 API Key 仅存本地），`sb-test -f` 也不接受这种命名。本地运行方式：起一个静态服务器，直接在浏览器打开测试页查看结果（sb-test 组件会自动执行并在页面展示）：

```bash
npx http-server .    # 或任意静态服务器
# 浏览器访问：
#   http://localhost:8080/ai/test/ai-supplier-sb.html
#   http://localhost:8080/ai/test/a-chain-sb.html
```

### 测试覆盖

- DeepSeek / Kimi 的普通对话、思考模式、流式输出、模型列表、余额查询
- Kimi 各模型（k3 / k2.7-code / k2.6）的思考参数分支构建逻辑（不消耗 API 配额）
- Assistant 基类的错误处理与流式 tool_calls 累积
- Chain 层（`ai/chain/`，`a-chain-sb.html`）：消息互转、工具 schema 校验、Agent 工具循环、双 streamMode、MemorySaver（mock model / fake assistant，不消耗 API 配额）

## Demo

运行演示应用：

```bash
cd ../others/ai-manager-demo
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
├── main.js                  # 主入口，API Key 管理和 Assistant 工厂
├── test-api-keys.json       # 测试用 API Key（已 gitignore）
├── README.md
├── supplier/                # AI 提供商实现
│   ├── assistant.js         # Assistant 基类（公共流式/tool_calls 累积/错误处理）
│   ├── deepseek.js          # DeepSeek 实现
│   └── kimi.js              # Kimi 实现
└── chain/                   # LangChain 风格使用流（基于 supplier 层）
    ├── main.js              # chain 入口（统一 re-export）
    ├── messages.js          # 消息类 + wire 格式互转 + textOf
    ├── tools.js             # tool() 定义 + 简写 schema → JSON Schema
    ├── memory.js            # MemorySaver（thread_id 会话记忆）
    ├── chat-model.js        # createChatModel()（invoke / stream）
    └── agent.js             # createAgent()（模型↔工具循环 + 双 streamMode）

others/ai-manager-demo/      # 演示应用（引用 ../../ai/main.js）
├── index.html               # 入口页面
├── app-config.js            # 应用配置
├── api-keys.html            # API Key 管理页面
├── chat.html                # 聊天页面
└── layout.html              # 布局模板
```

## 技术栈

- [ofa.js](https://github.com/ofajs/ofa.js) - 前端框架
- [NoneOS Core storage](https://github.com/kirakiray/noneos-core) (`/nos/storage/main.js`) - 本地异步键值存储
- [Punch-UI](https://punch-ui-v2.pages.dev/) - UI 组件库
