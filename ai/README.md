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

## Chain（Agent 封装）

`ai/chain/` 在 supplier 层之上封装「模型 ↔ 工具」自动循环的 Agent：模型发起 tool call → 执行工具 → 结果回给模型，直到产出最终回答。本层是**纯函数库**（不依赖 `/nos/*`），assistant 实例由调用方传入；调用方式与 `assistant.chat` 同构。完整字段说明见 [Chain API 参考](#chain-api-参考)。

```javascript
import { getAssistant } from "/ai/main.js";
import { createAgent, tool, MemorySaver } from "/ai/chain/main.js";
```

### 基础对话（无工具）

不配置 `tools` 时退化为普通对话：

```javascript
const agent = createAgent({ assistant: getAssistant() });

const result = await agent.chat({
  messages: [{ role: "user", content: "解释 React 中受控组件和非受控组件的区别。" }],
});

result.content;   // 最终回答
result.messages;  // 完整轨迹（wire 格式）
```

### Agent + 工具

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
  assistant: getAssistant(),
  tools: [calculator],
  systemPrompt: "你是前端技术助手。需要精确数值时调用 calculator。",
});

const result = await agent.chat({
  messages: [{ role: "user", content: "(128 * 0.85 + 20) / 2 等于多少？" }],
});

// 完整轨迹：user → assistant(tool_calls) → tool → assistant(最终回答)
for (const message of result.messages) {
  console.log(`[${message.role}]`, message.content);
  if (message.tool_calls?.length) console.log("tool_calls:", message.tool_calls);
}

console.log(result.content); // 最终回答
```

工具执行失败（参数非法 / 抛异常）不会中断循环，错误信息会以文本形式回给模型，让模型自行纠正。

### 流式（stream + onStream）

`onStream` 收到带 `type` 字段的事件；`text` 事件的字段与 `assistant.chat` 的 onStream 一致，已有流式 UI 几乎零改动迁移：

```javascript
let typed = "";
await agent.chat({
  messages: [{ role: "user", content: "128 * 0.85 等于多少？" }],
  stream: true,
  onStream: (ev) => {
    switch (ev.type) {
      case "text":        // 文本 / 思考增量（打字机效果）
        typed += ev.delta;
        renderTypewriter(typed, ev.deltaReasoning);
        break;
      case "toolCalls":   // 模型决定调用工具
        showCalling(ev.toolCalls);
        break;
      case "toolResult":  // 单个工具执行完毕
        showResult(ev.name, ev.result);
        break;
      case "done":        // 循环结束，携带最终结果
        finish(ev.content, ev.usage);
        break;
    }
  },
});
```

> `stream: false` 时不会有 `text` 事件，但 `toolCalls` / `toolResult` / `done` 照常推送（用于无打字机但要看工具进度的 UI）。

### 会话记忆（checkpointer + threadId）

`MemorySaver` 按 `threadId` 保存消息（仅内存，刷新即失）；`systemPrompt` 每次运行重新注入、不写入记忆：

```javascript
const agentWithMemory = createAgent({
  assistant: getAssistant(),
  checkpointer: new MemorySaver(),
  systemPrompt: "你是前端导师。记住同一个会话中用户已经说过的信息。",
});

await agentWithMemory.chat({
  messages: [{ role: "user", content: "我叫小林，正在把 Vue 2 项目迁到 Vue 3。" }],
  threadId: "frontend-learner-001",
});

// 第二轮复用同一 threadId，Agent 自动带上第一轮历史
const second = await agentWithMemory.chat({
  messages: [{ role: "user", content: "根据刚才的信息，给我一个优先处理的迁移风险。" }],
  threadId: "frontend-learner-001",
});
console.log(second.content);
```

### Agent 其他说明

- `maxSteps`（默认 12）：模型↔工具往返上限，超限抛错，防止模型陷入工具循环。
- `chat({ signal })` 支持传入 `AbortSignal` 取消请求（透传给循环内每次 `assistant.chat`）。
- `MemorySaver` 提供 `get` / `set` / `delete` / `clear`；`delete` / `clear` 可手动清理某个 thread 的记忆。

## Chain API 参考

全部导出自 `/ai/chain/main.js`（内部按模块 re-export）。本层不依赖 `/nos/*`，可独立测试。

### tool(fn, config)（tools.js）

定义一个工具，返回 `{ name, description, schema, invoke(rawArgs), toWire() }`。

```javascript
const weather = tool(
  async ({ city }) => fetchWeather(city),     // 接收解析后的参数对象，返回值会被 String() 化
  {
    name: "get_weather",                      // 必填，供模型调用的函数名
    description: "查询城市天气",               // 给模型看的用途说明
    schema: {                                 // 简写 schema（浏览器无 zod）
      city: { type: "string", description: "城市名，如 上海" },
      unit: { type: "string", description: "温度单位", optional: true },
    },
  },
);
```

schema 字段定义：

| 字段 | 说明 |
|------|------|
| `type` | `"string"` / `"number"` / `"boolean"` / `"array"` / `"object"`（默认 `"string"`） |
| `description` | 参数说明（转成 JSON Schema 的 properties 描述） |
| `optional` | 设为 `true` 时该参数不进 `required` |

`invoke(rawArgs)` 是容错执行入口：模型给的参数是 JSON 字符串，任何失败（JSON 非法 / 缺必填参数 / 类型不符 / 函数抛异常）都以可读中文文本返回给模型让它自行纠正，**不会**抛异常打断 Agent 循环。`toWire()` 生成 OpenAI 格式（`{ type: "function", function: { name, description, parameters } }`），一般不需要手动调（`createAgent` 内部会调）。

### createAgent(opts)（agent.js）

在 supplier 层 assistant 之上封装「模型 ↔ 工具」自动循环，返回 `{ chat }`。

| opts 字段 | 类型 / 默认值 | 说明 |
|------|------|------|
| `assistant` | object（必填） | `getAssistant()` 返回的 supplier 层实例（或测试注入的 fake） |
| `model` | string | 循环内每次 `assistant.chat` 直传 |
| `thinking` / `reasoningEffort` / `thinkingKeep` | - | 同名参数直传，语义见 supplier 层 `chat()` 参数表 |
| `tools` | array `[]` | `tool()` 定义的工具列表，可为空（退化为普通对话） |
| `systemPrompt` | string `""` | 系统提示词，每次运行重新注入、不写入记忆 |
| `checkpointer` | object `null` | 会话记忆（如 `MemorySaver`），配合 `chat` 的 `threadId` 使用 |
| `maxSteps` | number `12` | 模型↔工具往返上限，超限抛错 |

#### chat(params)

| params 字段 | 说明 |
|------|------|
| `messages` | 本次输入（`{ role, content }` wire 格式数组） |
| `stream` | `true` 时 `onStream` 额外收到 `text` 增量事件 |
| `onStream` | 事件回调，见下表 |
| `threadId` | 配合 checkpointer 加载 / 落盘历史 |
| `signal` | `AbortSignal` 取消请求（透传给循环内每次 `assistant.chat`） |

**onStream 事件**（均有 `type` 字段）：

| type | 触发时机 | 专有字段 |
|------|------|------|
| `text` | 模型输出文本 / 思考增量（仅 `stream: true`） | `delta` / `deltaReasoning` / `content` / `reasoningContent`（与 `assistant.chat` 的 onStream 同构） |
| `toolCalls` | 模型决定发起工具调用 | `toolCalls`（wire 格式） |
| `toolResult` | 单个工具执行完毕 | `name` / `toolCallId` / `result` |
| `done` | 循环结束 | `done: true` + 最终结果全部字段（`content` / `usage` / `messages` 等） |

**返回值**（与 `assistant.chat` 返回值同构，额外多 `messages`）：

```javascript
{
  content: "最终回答",
  reasoningContent: "最后一次模型调用的思考过程",
  model: "使用的模型",
  usage: { prompt_tokens, completion_tokens, total_tokens }, // 整个循环累计
  toolCalls: [],           // 恒为空数组（最终回答不再发起工具调用）
  messages: [              // 完整轨迹（wire 格式，含 system / tool 消息）
    { role: "user", content: "..." },
    { role: "assistant", content: "", tool_calls: [...] },
    { role: "tool", content: "...", tool_call_id: "..." },
    { role: "assistant", content: "最终回答" },
  ],
}
```

其他行为约定：

- 每轮发给模型的是 `messages` 的**快照**（后续 push 不影响已发出的请求；fake / 录制场景可安全留存每轮现场）。
- 找不到模型请求的工具时，错误文本作为 `tool` 消息回给模型自行纠正。
- 记忆落盘时机：只有得到最终回答（无工具调用的轮次）才 `checkpointer.set`，中途异常 / 超步数不会写入；存入的历史从 `systemPrompt` 之后开始，避免把提示词固化进记忆。

### MemorySaver（memory.js）

会话记忆：按 `threadId` 保存消息，**仅存当前页面内存**（刷新即失）。`get` / `set` 均深拷贝，与调用方的活动轨迹彻底解耦引用。

| 方法 | 说明 |
|------|------|
| `get(threadId)` | 取某 thread 历史消息深拷贝（外部修改不污染内部；未知 thread 返回 `[]`） |
| `set(threadId, messages)` | 深拷贝后覆盖写入 |
| `delete(threadId)` | 删除单个 thread，返回是否删成功 |
| `clear()` | 清空全部 |

需要持久化时实现同样的 `{ get, set, delete }` 异步接口即可替换（如基于 `/nos/storage`）：

```javascript
const persistSaver = {
  async get(threadId) {
    return (await storage.getItem(`ai-thread:${threadId}`)) ?? [];
  },
  async set(threadId, messages) {
    await storage.setItem(`ai-thread:${threadId}`, messages);
  },
  async delete(threadId) {
    await storage.removeItem(`ai-thread:${threadId}`);
  },
};

const agent = createAgent({ assistant: getAssistant(), checkpointer: persistSaver });
```

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

两个测试文件均以 `-sb.html` 结尾（而非 `.sb.html`），**故意不被 `npm test` / CI 自动发现**（真实 API Key 仅存本地）。本地统一通过 `test-ai` 脚本运行（依赖 sibyl-test ≥ 1.0.15 的 `-f` 多文件 + 后缀不限 `.sb.html` 能力，一次跑完两个文件）：

```bash
npm run test-ai                       # 默认多浏览器
npm run test-ai -- --browsers chrome  # 仅 Chrome
```

### 测试覆盖

- DeepSeek / Kimi 的普通对话、思考模式、流式输出、模型列表、余额查询
- Kimi 各模型（k3 / k2.7-code / k2.6）的思考参数分支构建逻辑（不消耗 API 配额）
- Assistant 基类的错误处理与流式 tool_calls 累积
- Chain 层（`ai/chain/`，`ai-chain-sb.html`）：工具 schema 校验与容错、导出完整性、MemorySaver 副本语义（纯函数，不发请求）；Agent 工具循环、参数直传（model / thinking）、流式事件序列、threadId 记忆与隔离（真实 `deepseek-v4-flash`，需在 `ai/test-api-keys.json` 填 key）

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
└── chain/                   # Agent 封装（基于 supplier 层，纯函数库）
    ├── main.js              # chain 入口（统一 re-export）
    ├── tools.js             # tool() 定义 + 简写 schema → JSON Schema
    ├── memory.js            # MemorySaver（threadId 会话记忆）
    └── agent.js             # createAgent()（模型↔工具循环 + onStream 事件）

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
