# AI Assistant 模块（`/ai/`）

Mazmot 自带的轻量 AI 助手封装库，位于仓库 `/ai/` 目录，统一封装 DeepSeek 和 Kimi 两家提供商，提供 API Key 管理、对话、思考模式、流式输出、请求取消等能力。

> **应用侧快速上手**：如果你的应用只需要调用 AI 对话能力，**基本不用关心 key 管理 API**（`saveKey` / `removeKey` / `getApiKeys` / `onApiKeysChange` / `testApiKey`）——那些是 AI Key 管理器应用自己用的。应用侧只需用 `getAssistant()` 拿到 Assistant 实例，然后调 `chat()` / `getModels()` / `getRemaining()` 即可：

```js
import { getAssistant } from "/ai/main.js";

// 拿到 Assistant 实例（host 端已配置好 key）
const assistant = getAssistant();
const { content } = await assistant.chat({
  messages: [{ role: "user", content: "你好" }],
});
```

下面先讲应用侧常用的 Assistant API，再附上完整的 key 管理 API（给 AI Key 管理器或代理服务用）。

> 需要在对话中让模型自动调用工具（Agent 循环）、会话记忆等，请查 [ai-chain.md](./ai-chain.md)（`/ai/chain/`）。

## 应用侧常用 API

由 `getAssistant()` / `new DeepseekAssistant(id, apiKey)` / `new KimiAssistant(id, apiKey)` 获得。基类 `Assistant` 位于 `/ai/supplier/assistant.js`，子类在 `deepseek.js` / `kimi.js`。

### assistant.providerName

只读属性，标识该实例来自哪个提供商，取值为全小写字符串 `"deepseek"` / `"kimi"`（与 key 对象的 `provider` 一致）。当用 `getAssistant()` 随机取实例、又想知道拿到的是哪家时可读取它：

```js
const assistant = getAssistant();
console.log(assistant.providerName); // "deepseek" 或 "kimi"
```

### chat(options)

```js
const response = await assistant.chat({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "你好" },
  ],
  thinking: false,
  stream: false,
  model: "deepseek-v4-flash",
  onStream: (data) => { /* ... */ },
  signal: controller.signal, // AbortSignal
});
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `messages` | array | - | 消息数组，含 role/content |
| `thinking` | boolean | false | 是否启用思考模式（DeepSeek / Kimi k2.6 / k2.5 生效） |
| `stream` | boolean | false | 是否启用流式输出 |
| `model` | string | - | 模型名称 |
| `onStream` | function | null | 流式输出回调 |
| `reasoningEffort` | string | "high" | DeepSeek / `kimi-k3` 专用，推理强度（DeepSeek：`high`/`max`；kimi-k3：`low`/`high`/`max`） |
| `thinkingKeep` | string | null | 仅 `kimi-k2.6` 支持，传 `"all"` 启用保留式思考 |
| `signal` | AbortSignal | null | 传入用于取消请求；abort 后抛 `AbortError` |

返回值：

```js
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

### getRemaining()

获取账户余额，**统一返回结构**：

```js
{
  balances: [{ currency: "CNY", amount: 123.45, raw: {...} }],
  raw: { /* 原始响应 */ }
}
```

## 应用侧完整导入

```js
import {
  getAssistant,
  // 仅当应用自己管理 key 时才需要下面这些
  saveKey, removeKey, getApiKeys, onApiKeysChange, testApiKey,
} from "/ai/main.js";
```

## 支持的提供商与模型

| 提供商 | 模型 | 思考模式 | 流式输出 |
|--------|------|----------|----------|
| DeepSeek | `deepseek-v4-flash`, `deepseek-v4-pro` | ✅ | ✅ |
| Kimi | `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5` | ✅ | ✅ |

> `kimi-k2-thinking` / `kimi-latest` / `kimi-thinking-preview` 已下线。`deepseek-chat` / `deepseek-reasoner` 旧名已于 2026/07/24 弃用。

---

## key 管理 API（AI Key 管理器 / 代理服务用）

> 以下 API 给"AI Key 管理器应用"或"代理服务端"使用，普通应用通常用不到。

### saveKey(apiKey, provider)

保存 key，返回新保存的 key 对象（含 `id`，可用于 `removeKey` / `getAssistant`）。自动持久化到本地存储（nos storage）并通知订阅者。

- `provider`：`"deepseek"` / `"kimi"`

```js
const keyObj = saveKey("sk-xxx", "deepseek");
// keyObj.id 用于后续操作
```

### removeKey(id)

按 id 删除，返回布尔。同样自动持久化 + 通知。

```js
removeKey("abc123"); // true / false
```

### getAssistant(id?)

根据 id 获取 Assistant 实例。**同步函数（无 IO）**，调用方可省略 `await`。不传 id 时随机选一个（多 key 负载均衡）。空列表抛 `no api key available`，id 不存在抛 `key not found`。

```js
const assistant = getAssistant("abc123");
const anyAssistant = getAssistant(); // 随机取
```

### getApiKeys()

返回当前所有 key 的**快照**（浅拷贝数组，安全可读）。key 对象结构：

| 字段 | 说明 |
|------|------|
| `id` | 内部唯一 id |
| `provider` | `"deepseek"` / `"kimi"` |
| `apiKey` | 原始 key（敏感，UI 展示用 `maskedKey`） |
| `maskedKey` | 脱敏串，如 `sk-abcd...wxyz` |
| `createdAt` | ISO 时间戳 |
| `formattedDate` | 本地化时间字符串 |

### onApiKeysChange(callback)

订阅列表变化，回调收到只读快照数组。返回**取消订阅函数**，组件销毁时务必调用。本模块不依赖框架响应式，UI 层可借此同步视图。

```js
const unsub = onApiKeysChange((keys) => renderKeyList(keys));
// 销毁时
unsub();
```

### testApiKey(apiKey, provider)

验证 key 是否有效（不写入列表，仅调 `getModels()` 探测）。返回 `{ valid, message }`，**不会抛异常**。

```js
const { valid, message } = await testApiKey("sk-xxx", "kimi");
```

### 完整流程

```js
// 1. 验证
const { valid } = await testApiKey("sk-xxx", "deepseek");
if (!valid) throw new Error("key 无效");
// 2. 保存
saveKey("sk-xxx", "deepseek");
// 3. 订阅
const unsub = onApiKeysChange((keys) => renderKeyList(keys));
// 4. 对话
const assistant = getAssistant();
const result = await assistant.chat({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "你好" }],
});
// 5. 清理
unsub();
```

## 思考模式

### DeepSeek

默认开启思考模式，可 `thinking: false` 关闭。强度通过 `reasoningEffort` 控制（`high` / `max`）。官方仅接受 `high` / `max`，传入 `low` / `medium` 会被映射为 `high`，`xhigh` 映射为 `max`。

### Kimi（按模型区分，最易出错）

| 模型 | thinking | reasoningEffort | thinkingKeep |
|------|----------|-----------------|--------------|
| `kimi-k3` | ❌ 不支持 | ✅ `low`/`high`/`max` | ❌ |
| `kimi-k2.7-code` | 无效（始终思考） | ❌ | ❌ |
| `kimi-k2.6` | ✅ 默认 true | ❌ | ✅ `"all"` |
| `kimi-k2.5` | ✅ 默认 true | ❌ | ❌ |

```js
// ✅ kimi-k3
await assistant.chat({
  model: "kimi-k3",
  messages: [...],
  reasoningEffort: "max",
});

// ✅ kimi-k2.6
await assistant.chat({
  model: "kimi-k2.6",
  messages: [...],
  thinking: true,
  thinkingKeep: "all",
});

// ❌ 对 kimi-k3 传 thinking 会报错
```

## 流式输出

```js
await assistant.chat({
  messages: [{ role: "user", content: "写一首诗" }],
  stream: true,
  onStream: (data) => {
    console.log(data.content);          // 累计内容
    console.log(data.delta);            // 本次增量
    console.log(data.deltaReasoning);   // 思考增量
    console.log(data.done);             // 是否完成
  },
});
```

## 取消请求（AbortSignal）

```js
const controller = new AbortController();
try {
  await assistant.chat({
    messages: [...],
    stream: true,
    signal: controller.signal,
    onStream: (data) => console.log(data.delta),
  });
} catch (err) {
  if (err.name === "AbortError") {
    console.log("已取消"); // 底层连接和流读取立即释放
  } else {
    throw err;
  }
}
```

## 作为代理服务端的注意点

`ai/` 模块**不依赖 noneos-core**，可独立用于任何 JS 环境。当作为代理（用我方 key 替对方提问、转发流回对方）使用时：

- ✅ 已内置 `signal` 支持，对方断开 → `controller.abort()` → 立刻释放配额
- ✅ `onStream` 回调可桥接到 `remoteUser.sendToService` 转发分片
- ⚠️ 代理服务端的 key 池管理（限流/熔断/轮询）**不要塞进 `main.js`**，应另起 `ai-proxy/` 模块
- ⚠️ 不要把 noneos-core 依赖引入 `ai/`，会破坏其可复用性

## 测试

使用 sibyl-test，supplier 层测试位于 `/ai/test/ai-supplier-sb.html`：

```bash
# 填入真实 key（已 gitignore）
# /ai/test-api-keys.json: { "deepseek": "sk-...", "kimi": "sk-..." }

npx sb-test -f ai/test/ai-supplier-sb.html --browsers chrome
```

覆盖范围：main.js 全部导出（离线）、AbortSignal 取消、DeepSeek/Kimi 对话/思考/流式、Kimi 各模型思考参数分支构建、错误处理。

## 项目结构

```
ai/
├── main.js                       # API Key 管理 + Assistant 工厂
├── supplier/
│   ├── assistant.js              # Assistant 基类（handleStreamResponse / _buildError）
│   ├── deepseek.js               # DeepSeek 实现
│   └── kimi.js                   # Kimi 实现
├── chain/                        # Agent 封装（见 ai-chain.md）
├── test/
│   ├── ai-supplier-sb.html       # supplier 层测试（sibyl-test）
│   └── ai-chain-sb.html          # Agent 循环测试（真实 deepseek-v4-flash）
└── test-api-keys.json            # 本地测试 key（gitignore）
```
