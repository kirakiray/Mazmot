# mz/net —— Mazmot 平台联网能力（web fetch）

浏览器里 `fetch` 任意第三方站点受 CORS 限制，Service Worker 也无法绕过（拦截不到跨域响应体），所以**网页抓取必须经服务端中转**。`mz/net` 把「中转端点」抽象为可插拔的 provider：任何实现本文定义的 `/fetch` 协议的 HTTP 服务都能接入，客户端按优先级自动选择（或由用户固定通道），应用侧只调一个函数。

- 平台入口：`/mz/net/main.js`（页面模块 / 组件用 `load("/mz/net/main.js")` 按需加载，禁止顶层 import）
- 已有实现：[official-apps/conjure 的 web_fetch 工具](../../official-apps/conjure/lib/tools/web-fetch/)、[server/ai-relay](../ai-relay/)（relay 通道）、[server/web-hub-cf](../../server/web-hub-cf/)（自部署 web-hub 现成实现，经 custom 通道接入）、主应用设置弹窗「联网能力」子页（通道选择 / 自定义端点配置 UI）

## 1. 协议契约（`POST {base}/fetch`）

所有 provider 都实现同一契约，差异只在**鉴权头**。

### 请求

```
POST {base}/fetch
Content-Type: application/json
<鉴权头，见第 2 节>

{ "url": "https://example.com/page" }
```

### 成功响应（HTTP 200）

```json
{
  "url": "https://example.com/final-path",
  "status": 200,
  "contentType": "text/html; charset=utf-8",
  "text": "……响应体文本……",
  "truncated": false
}
```

| 字段 | 说明 |
| ---- | ---- |
| `url` | 最终地址（跟随重定向后） |
| `status` | **上游** HTTP 状态码。404 / 500 等不算网关错误——文本照常返回（对 AI 有价值），由调用方自行判断 |
| `contentType` | 上游 Content-Type 原文 |
| `text` | 响应体文本（超出大小上限时为截断后的内容） |
| `truncated` | 响应体是否因超过大小上限被截断 |

### 失败响应（非 200，网关层错误）

```json
{ "error": { "message": "拒绝访问私网地址", "type": "web_fetch_error" } }
```

### 服务端必须实现的约束

| 约束 | 要求 |
| ---- | ---- |
| 协议 | 仅 `http` / `https` |
| SSRF 防护 | 拒绝环回 / 私网 / 链路本地目标（IP 字面量与 DNS 解析结果都要查） |
| 重定向 | 最多 3 跳，**逐跳重新校验**（防重定向绕过 SSRF 防护），返回最终 URL |
| 大小上限 | 默认 2 MB，超出截断并置 `truncated: true` |
| 超时 | 总超时默认 15 s |
| Content-Type | 仅放行文本类：`text/*`、`application/json`、`+json`、`application/xml`、`+xml`、`javascript`、`yaml`；二进制拒绝 |
| 幂等 | 只支持 GET 语义的目标抓取，不转发 POST / Cookie 等凭据 |

## 2. Provider 类型与鉴权

| provider | base 地址 | 鉴权头 | 说明 |
| ---- | ---- | ---- | ---- |
| `custom` | 用户配置 | `X-Web-Fetch-Token: <token>`（可选） | 任意自部署实现（Worker / 本地代理）；配置了 token 即启用共享令牌校验。[server/web-hub-cf](../../server/web-hub-cf/) 为现成的自部署实现（NoneOS 签名 / 共享令牌双模式） |
| `relay` | 邀请码里的 serverUrl | `Authorization: Bearer <bearkey>` + `X-Relay-Auth`（bound 模式签名） | server/ai-relay 的 `/v1/web/fetch`；鉴权与 AI 接口完全一致，跟随已配置的邀请码**零配置可用** |

NoneOS 签名方案（relay / hub 同一套，仅 `k` 用途标记与 path 不同）：

```js
const signed = await user.sign({
  k: "relay-auth" | "web-hub-auth",   // 用途标记，服务端校验
  userId,                             // 公钥 sha256 hex
  ts: Date.now(),                     // 服务端容许 ±10min 偏差
  method: "POST",
  path: "/v1/web/fetch" | "/fetch",   // 必须与实际请求路径一致
  bodyHash: <请求体原文的 sha256 hex>,
});
// signed 会被 user.sign 自动附加 signTime / publicKey / signature（ECDSA P-256）
// 完整签名对象 base64 后放鉴权头
```

## 3. 通道选择：自动优先级 + 用户固定

**默认「auto」**：按以下顺序取第一个可用的 provider：

1. **custom** —— `setCustomEndpoint` 配置的自定义端点。**失败直接抛错**（用户明确指定，静默换道会把 URL 泄露给第三方服务）
2. **relay** —— 启用的 relay key（多台时默认第一台，可用 `setRelayKeyId` 指定；指定的 key 被删后自动回退第一台）。**失败同样直接抛错**（理由同上）
3. **jina** —— `https://r.jina.ai/<url>` 公共 Reader（免 key、有限流、返回 Markdown；URL 会经过第三方，仅作为「什么都没部署时也能用」的最后兜底）

**固定通道**：`setWebFetchChannel(name)` 可固定 `custom` / `relay` / `jina` 任意一个——固定后**只用该通道**，失败直接抛错、不再自动降级（显式选择不静默换道）；`setWebFetchChannel("auto")` 恢复自动优先级。偏好存 `getStorage("mz-net")`（storage 不可用降级内存）。

> 即：**零部署开箱即用**（自动链尾为 Jina），配了 relay 邀请码自动升级为走自己的服务器，开发者可自部署 web-hub 后 `setCustomEndpoint` 完全自主并固定。

## 4. API

两层 API：`net.fetch` 是与原生 fetch 同形的低层 util（换掉 `fetch` 就能读跨域页面），`net.fetchText` 是内容场景的便捷层（正文提取 + 截断 + 缓存）。两者走同一条通道调度。

### `net.fetch(url, init?)` —— fetch 同形

```js
const net = await load("/mz/net/main.js");
const { fetch: netFetch } = net; // 或直接 net.fetch(...)

const res = await netFetch("https://example.com/docs");
res.ok;                          // 上游 2xx（404 等上游状态不抛错，看 ok）
res.status;                      // 上游 HTTP 状态码
res.url;                         // 最终地址（跟随重定向后）
res.provider;                    // 实际生效的中转方：custom / relay / hub / jina
res.truncated;                   // 响应体是否被中转端截断
res.headers.get("content-type");
const html = await res.text();   // 原始响应体（未做正文提取）
const data = await res.json();   // content-type 为 JSON 时
```

- 仅支持 GET 语义：`init.method` 传非 GET 直接拒绝（协议不转发写请求 / Cookie）
- 中转/网关层错误（无可用 provider、鉴权失败、SSRF 拦截）抛错，语义同原生 fetch 的网络错误
- `init.signal` 支持取消

### `net.fetchText(url, opts?)` —— 内容便捷层

```js
const r = await net.fetchText("https://example.com/docs");
// r = { url, status, contentType, text, truncated, provider }
//   - text/html 自动做正文提取（去 script/style/标签、实体解码、压空白）；
//     opts.raw = true 跳过提取拿原始响应体
//   - 默认 maxChars = 20000（字符），超出截断并附截断标注
//   - 会话内 5 分钟缓存（20 条 LRU），opts.noCache 跳过

net.extractText("<html>…</html>");   // 纯函数：HTML → 正文文本
await net.resolveProvider();          // 调试 / UI 展示：{ name, endpoint, pinned }（不出网）

// 通道固定（见第 3 节）：偏好存 mz-net 空间，storage 不可用时降级内存
await net.setWebFetchChannel("relay");   // "auto" | "custom" | "relay" | "jina"
await net.getWebFetchChannel();           // → 当前偏好，默认 "auto"

// relay 多台选择
const servers = await net.listRelayServers(); // → [{ keyId, label, baseUrl }]（启用中的 relay key）
await net.setRelayKeyId(servers[1].keyId);    // 指定 relay 通道用哪台；key 被删自动回退第一台
await net.getRelayKeyId();

// 联网搜索（mz 内实现：fetch 抓搜索引擎结果页 + mz 内解析，服务端零搜索功能）
const sr = await net.searchWeb("ofa.js 教程", { maxResults: 5, engine: "duckduckgo" });
// sr = { query, engine, provider, results: [{ title, url, content }] }
// opts.engine 缺省时落到默认引擎偏好（设置页「搜索引擎」下拉）：
await net.setSearchEngine("bing");    // 设置默认引擎（未知 key 抛错），对所有 searchWeb 生效
await net.getSearchEngine();          // → 当前默认引擎，未设置过为 "duckduckgo"

// 自定义端点（即 custom 通道；存 webFetchEndpoint 键）
await net.setCustomEndpoint({ url: "https://my-worker.example.workers.dev", token: "…" });
await net.getCustomEndpoint();        // → { url, token } | null
await net.clearCustomEndpoint();
```

自定义端点、通道偏好、relay 指定、搜索引擎偏好都存 `getStorage("mz-net")` 独立空间（遵守存储隔离规范）；`/nos/storage` 不可用的环境（无 SW 测试页等）自动降级为仅内存模式，模块照常可用。**本模块内部不依赖 ofa 的 `lm` 全局**——全部按需 `import("/绝对路径")`，sb-test 等无 SW 页面同样可加载。

## 5. 安全模型与边界

- **防 SSRF 是服务端的责任**（见第 1 节约束表）；客户端只做 scheme 预检。
- **自部署 web-hub 的公开签名鉴权不是强身份**：任何人生成密钥对都能构造合法签名，防的是无门槛扫描滥用，不防蓄意者。自部署请配 `X-Web-Fetch-Token` 共享令牌（或参考 relay 的邀请码模式）。详见 web-hub-cf 的 README 与 CONTEXT.md。
- **不做通用代理**：协议只有 GET 语义的文本抓取，不转发请求头 / Cookie / POST 体，不能用来访问需要登录的页面。
- 抓取结果进模型上下文前有截断（`DEFAULT_MAX_CHARS`），应用侧不应假设拿到全文。

## 6. 各 provider 实现对照

| 能力 | relay（server/ai-relay） | custom（自部署，如 web-hub-cf） |
| ---- | ---- | ---- |
| 端点 | `POST /v1/web/fetch` | `POST /fetch` |
| SSRF | DNS 解析后逐 IP 校验 | 自行实现（web-hub-cf 已带 IP 字面量黑名单） |
| 鉴权 | bearkey + 绑定签名 | 可选共享令牌 / NoneOS 签名 |
| 按用户开关 | `webFetchEnabled=false` 的用户 403 | 自行实现 |
| 配额 | 暂不计入 token 配额（TODO） | 自行实现 |

新增 provider 形态（如本地二进制代理）只需实现第 1 节契约 + 第 2 节任一鉴权头，客户端零改动。

## 7. 搜索（mz 内实现：搜索 = fetch + 引擎适配器）

搜索**不在服务端实现**——relay / 自定义端点只做纯转发抓取，搜索逻辑全部在 mz 内：`searchWeb` 用 `fetchText` 抓取搜索引擎结果页（raw HTML），在客户端解析出结果列表。任何能 fetch 的通道自动获得搜索能力，服务端零搜索代码。

- **引擎可插拔**（`SEARCH_ENGINES` 导出）：默认 `duckduckgo`（`html.duckduckgo.com/html/?q=` 无 JS 版，对服务器 IP 最容忍），另有 `bing`；引擎改版只需更新对应适配器的 `parse`。
- **默认引擎用户可切**：设置页「搜索引擎」下拉（`setSearchEngine` / `getSearchEngine`，偏好存 mz-net 空间）对所有 `searchWeb` 调用生效，应用侧 `opts.engine` 仍可单次覆盖。
- **best-effort**：引擎对数据中心 IP 弹验证码 / 改版时解析失败，`searchWeb` 抛可读错误（可换 engine 或稍后再试）。需要更稳的搜索质量时，可自行为某通道加带 key 的商业搜索。
- 解析用浏览器 `DOMParser`（mz 运行在浏览器内）；返回 `{ query, engine, provider, results: [{ title, url, content }] }`，`provider` 为实际执行抓取的通道。
