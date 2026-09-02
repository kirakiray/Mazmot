# Chain（Agent 封装）

`mz/ai/chain/` 在 supplier 层之上封装「模型 ↔ 工具」自动循环的 Agent：模型发起 tool call → 执行工具 → 结果回给模型，直到产出最终回答。本层是**纯函数库**（不依赖 `/nos/*`），assistant 实例由调用方通过 `/mz/ai/main.js` 的 `getAssistant()` 传入；调用方式与 `assistant.chat` 同构。完整字段说明见 [API 参考](#api-参考)。

```javascript
import { getAssistant } from "/mz/ai/main.js";
import { createAgent, tool, MemorySaver } from "/mz/ai/chain/main.js";
```

## 快速开始

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

## API 参考

全部导出自 `/mz/ai/chain/main.js`（内部按模块 re-export）。本层不依赖 `/nos/*`，可独立测试。

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
| `thinking` / `reasoningEffort` / `thinkingKeep` | - | 同名参数直传，语义见 [supplier 层 `chat()` 参数表](../README.md#参数说明) |
| `tools` | array / `() => array` `[]` | `tool()` 定义的工具列表，可为空（退化为普通对话）；传函数时每轮求值，支持会话中途动态增删 |
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
  usage: {
    prompt_tokens, completion_tokens, total_tokens,
    // 供应商有返回时才累计（DeepSeek：prompt_cache_hit_tokens /
    // prompt_cache_miss_tokens；OpenAI 风格：prompt_tokens_details.cached_tokens）
    prompt_cache_hit_tokens?, prompt_cache_miss_tokens?, prompt_tokens_details?,
  }, // 整个循环累计
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

测试文件为 `ai/test/ai-chain-sb.html`（`-sb.html` 后缀，不进 CI；Agent 行为用真实 `deepseek-v4-flash`，需在 `mz/ai/test-api-keys.json` 填 key）。运行方式见 [../README.md 测试章节](../README.md#测试)。
