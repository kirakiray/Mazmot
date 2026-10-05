# web-hub-cf —— 自部署 web-hub（Cloudflare Workers）

Mazmot 平台联网能力（web fetch）的**现成自部署实现**：平台客户端不内置任何公共 hub 实例，自部署本服务后把 Worker 地址填进设置 → 联网能力的「自定义 Web Hub」（或 `mz/net` 的 `setCustomEndpoint`）即接入 custom 通道。无任何 bindings，`wrangler deploy` 即上线。

- 协议契约（`POST /fetch` 请求/响应/约束）：[mz/net/README.md](../../mz/net/README.md)（单一事实来源）
- 客户端如何发现并使用本服务：`mz/net/main.js` 的 provider 解析（自定义端点 > relay > 本服务 > Jina 兜底）
- 运维 / 架构事实：[CONTEXT.md](CONTEXT.md)

## 接口速览

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| `POST` | `/fetch` | 抓取网页文本，body `{ "url": "http(s)://…" }`；成功 200 `{ url, status, contentType, text, truncated }`，失败 `{ error: { message, type } }` |
| `GET` | `/health` | 健康检查，`{ ok: true }` |

鉴权二选一（由是否配置 `WEB_HUB_TOKEN` 决定）：

- **公开模式（默认）**：请求带 `X-Web-Hub-Auth` 头 = NoneOS 用户签名（`user.sign({ k: "web-hub-auth", userId, ts, method: "POST", path: "/fetch", bodyHash })` 的完整签名对象 base64）。客户端已实现在 `mz/net/main.js`。
- **私有模式**：配置 `WEB_HUB_TOKEN` 后只认 `X-Web-Fetch-Token` 共享令牌（常数时间比较），签名鉴权关闭。**自部署推荐**。

## 部署（官方实例 / 自部署同一套流程）

前提：一个 Cloudflare 账号 + Node.js（跑 wrangler）。**不需要创建 D1 / KV 等任何资源**。

```bash
cd server/web-hub-cf
cp wrangler.toml.example wrangler.toml
npx wrangler login          # 首次使用需登录浏览器授权
npx wrangler deploy         # 部署，输出形如 https://web-hub-cf.<你的子域>.workers.dev
```

部署后按需调整 `wrangler.toml`：

```bash
# 1. 跨域：浏览器直调必须配置调用方站点（mazmot.noneos.com 与本地开发地址）
#    wrangler.toml [vars] 里：
#    WEB_HUB_CORS = "https://mazmot.noneos.com,http://localhost:端口"
# 2. （可选，自部署推荐）私有模式令牌：
npx wrangler secret put WEB_HUB_TOKEN
# 3. 生效：npx wrangler deploy
```

自部署完成后，在 Mazmot 里通过 `mz/net` 的 `setCustomEndpoint({ url, token })` 接入（或直接把它写进 `mz/net/main.js` 的 `DEFAULT_HUB_URL` 成为新的官方默认）。

本地调试：`npm run dev`（= `wrangler dev`，127.0.0.1:8787）。

## 快速自测

```bash
BASE=https://web-hub-cf.<你的子域>.workers.dev

curl "$BASE/health"
# {"ok":true}

# 公开模式：签名头由 mz/net 生成，这里用 token 模式演示
curl -X POST "$BASE/fetch" \
  -H "Content-Type: application/json" \
  -H "X-Web-Fetch-Token: <你的 WEB_HUB_TOKEN>" \
  -d '{"url":"https://example.com"}'
# {"url":"https://example.com/","status":200,"contentType":"text/html; charset=UTF-8","text":"…","truncated":false}

# 应被 SSRF 防护拒绝的例子（422）：
curl -X POST "$BASE/fetch" -H "X-Web-Fetch-Token: <token>" \
  -d '{"url":"http://127.0.0.1:8080"}'
```

## 安全边界（重要，部署前必读）

1. **公开模式的签名不是强身份**：任何人生成 ECDSA 密钥对都能构造合法签名——它防的是无门槛扫描与脚本小子，**不防蓄意滥用**。给公网开一个能抓任意 URL 的代理，滥用者可以借你的 Worker 流量访问任意站点。官方实例接受这一权衡（Cloudflare 平台层有请求速率与滥用检测兜底）；若不可接受，请用私有模式或效仿 ai-relay 加邀请码/配额体系。
2. **SSRF 防护范围**：边缘环境无法做调用方视角的 DNS 解析，校验覆盖 IP 字面量（含 v6 映射 v4）与内部主机名黑名单；Workers 的出站 fetch 本就到不了部署者的内网，残余面主要是「借道抓取公网敏感端点」（如云元数据 IP，已在黑名单）。重定向逐跳校验，防 302 跳内网。
3. **只做 GET 语义的文本抓取**：不转发 Cookie / POST / 自定义请求头，无法用于访问需登录的页面。
4. 配额：暂无按用户配额（无 KV）。升级路径见 CONTEXT.md「已知的限制与演进方向」。
