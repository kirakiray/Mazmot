# 平台联网能力（web fetch）—— `/mz/net/main.js`

浏览器 `fetch` 任意第三方站点受 CORS 限制，网页抓取必须经服务端中转。`/mz/net` 把「中转端点」抽象为可插拔 provider，按优先级自动解析，应用侧只调 `fetchText`。协议契约（`/fetch` 请求/响应/SSRF 约束）的**单一事实来源**是仓库 [mz/net/README.md](../../../mz/net/README.md)，本文件讲应用侧怎么用。

> **妙造隔离预览**：预览容器没有通道配置，receiver 注入的 import map 会把 `/mz/net/main.js` 顶替为 `bridge/guest/mz-net.js` 替身——`fetch` / `fetchText` / `searchWeb` 导出面与真模块同形，内部经能力桥转发妙造主容器用自己的通道执行（`res.provider` 标 `"bridge"`）。应用代码零感知；通道配置 API（`setWebFetchChannel` 等）在预览域抛可读错误。改真模块应用侧用法时必须同步替身（见 `official-apps/conjure/CONTEXT.md`「预览能力桥」）。

## 加载方式

```javascript
// 页面模块 / 组件（/nos/* 同款约束：顶层禁止 import，按需 load）
const net = await load("/mz/net/main.js");
```

## API 速记

```javascript
// 低层：与原生 fetch 同形（把 fetch 换成 net.fetch 即可读跨域页面）
const res = await net.fetch("https://example.com/docs");
// res.ok / res.status（上游状态码）/ res.url（重定向后最终地址）
// res.provider（custom|relay|jina）/ res.truncated
// res.headers.get("content-type") / await res.text() / await res.json()
// 仅 GET 语义（init.method 非 GET 拒绝）；中转层错误抛错，上游 4xx/5xx 用 res.ok 判断

// 高层便捷层：HTML 自动正文提取 + 截断 + 会话缓存
const r = await net.fetchText("https://example.com/docs");
// r = { url, status, contentType, text, truncated, provider }
//   - url：最终地址（跟随重定向后）；status：上游 HTTP 状态码（404 等不算错误）
//   - text/html 自动正文提取（去 script/style/标签）；opts.raw = true 拿原始响应体
//   - 默认 maxChars = 20000 截断；会话内 5 分钟缓存（opts.noCache 跳过）

// 联网搜索（mz 内实现：fetch 抓搜索引擎结果页 + DOMParser 解析，服务端零搜索功能；
// 引擎可插拔 SEARCH_ENGINES：默认 duckduckgo（html.duckduckgo.com 无 JS 版）、bing；
// best-effort——引擎改版/反爬时解析失败抛可读错误，可换 engine）
const sr = await net.searchWeb("ofa.js 教程", { maxResults: 5, engine: "duckduckgo" });
// sr = { query, engine, provider, results: [{ title, url, content }] }
// opts.engine 缺省时落到默认引擎偏好（设置页「搜索引擎」下拉），再默认 duckduckgo：
await net.setSearchEngine("bing");     // 设置默认引擎（未知 key 抛错），对所有 searchWeb 生效
await net.getSearchEngine();           // → 当前默认引擎，未设置过为 "duckduckgo"

net.extractText("<html>…</html>");     // 纯函数：HTML → 正文文本
await net.resolveProvider();           // 调试：{ name, endpoint, pinned }（不出网）

// 通道固定：默认 "auto" 按优先级（custom > relay > jina）取第一个可用；
// 固定后只用该通道、失败不降级。偏好存 getStorage("mz-net")，storage 不可用降级内存
await net.setWebFetchChannel("relay"); // "auto" | "custom" | "relay" | "jina"
await net.getWebFetchChannel();

// relay 多台选择（多邀请码场景）
const servers = await net.listRelayServers(); // [{ keyId, label, baseUrl }]
await net.setRelayKeyId(servers[1].keyId);    // 指定后走该台；key 被删自动回退第一台

// 自定义端点（自部署 Worker / 本地代理；存 getStorage("mz-net") 的 webFetchEndpoint 键，
// /nos/storage 不可用时自动降级仅内存模式）
await net.setCustomEndpoint({ url: "https://my-hub.workers.dev", token: "可选共享令牌" });
await net.getCustomEndpoint();         // → { url, token } | null
await net.clearCustomEndpoint();
```

## Provider 解析顺序（重要）

| 顺序 | provider | 来源 | 失败行为 |
| ---- | -------- | ---- | -------- |
| 1 | `custom` | `setCustomEndpoint` 配置 | **直接抛错**（用户明确指定，静默换道会把 URL 泄露给第三方） |
| 2 | `relay` | `/mz/ai` 里第一个启用的 relay 邀请码 → 其服务器的 `POST /v1/web/fetch` | **直接抛错**（理由同上） |
| 3 | `jina` | `r.jina.ai` 公共 Reader（免 key、有限流，URL 经过第三方） | 抛错 |

含义：配了 relay 邀请码自动走自己的服务器（ai-relay 的 `/v1/web/fetch`，SSRF 防护见其 CONTEXT.md）；开发者自部署中转实现（如 [server/web-hub-cf](../../../server/web-hub-cf/)）后 `setCustomEndpoint` 完全自主；都没有时兜底公共 Jina Reader。

## conjure 的 web_fetch 工具

conjure 的 AI Agent 用 `web_fetch` 工具调用同一能力（工具包 `official-apps/conjure/lib/tools/web-fetch/`，经 `ctx.netFetch` = `fetchText`）：mz/net 层 2 万字符截断 → 工具层二次截断 1.2 万并附元信息头（provider / HTTP 状态 / 最终 URL）。新建应用里想让生成的应用也联网，让它引用 `/mz/net/main.js` 即可。

## 自部署 / 服务端实现

- Worker 版：`server/web-hub-cf/`（`npx wrangler deploy` 即上线，无 bindings；公开签名鉴权 / 私有令牌模式，部署步骤见其 README.md）。
- relay 版：`server/ai-relay` 的 `POST /v1/web/fetch`（bearkey + 绑定签名，随邀请码零配置可用）。
- 自建任何实现只需遵守 `POST {base}/fetch` 契约（见 mz/net/README.md 第 1 节约束表：仅 http/https、私网黑名单、重定向逐跳校验、2MB/15s 上限、文本类 Content-Type）。

## 测试

- `mz/net/test/net.sb.html`：extractText / sha256Hex / URL 预检 / relay webFetch 请求映射（mock fetch，不出网）。
- 依赖 `/nos/storage` 的 custom 端点读写不在浏览器测试范围（sb-test 环境无 NoneOS SW），由部署环境人工验证。
