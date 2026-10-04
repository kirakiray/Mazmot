# web-hub-cf 上下文说明

Mazmot 官方 web-hub：Cloudflare Workers 版联网抓取兜底服务，实现 [mz/net/README.md](../../mz/net/README.md) 的 `/fetch` 协议契约。面向没有 relay 邀请码、也不自部署端点的用户（零配置兜底），同一份代码供开发者自部署。本文件是本服务的**活文档**，与代码保持一致。

## 目录结构

```
web-hub-cf/
├── src/worker.js             # 全部实现（单文件，无构建步骤）：鉴权 / SSRF 校验 /
│                             #   手动重定向 / 流式限长读取 / CORS / 路由
├── wrangler.toml.example     # 部署配置模板（真实 wrangler.toml 不入库）
├── package.json              # 仅 dev / deploy 脚本（wrangler 经 npx 调用，无依赖）
├── README.md                 # 部署指南 + 安全边界
└── CONTEXT.md                # 本文件
```

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| ---- | ---- | ---- | ---- |
| `POST` | `/fetch` | 公开模式 `X-Web-Hub-Auth` / 私有模式 `X-Web-Fetch-Token` | 抓取网页文本，契约见 mz/net/README.md |
| `GET` | `/health` | 无 | `{ ok: true }` |

### 鉴权双模式（由 `WEB_HUB_TOKEN` 是否配置切换）

- **公开模式**（默认）：`X-Web-Hub-Auth` = base64(JSON NoneOS 签名对象)。校验链：结构 → `k === "web-hub-auth"` / `method` / `path` / `bodyHash`（请求体原文 sha256 hex）一致 → `ts` ±10min → `userId === sha256hex(publicKey)` → ECDSA P-256 验签（消息为**去掉 signature 后按 key 字母序**规范化 stringify，64 字节 raw r||s 签名、SPKI DER 公钥）。与 ai-relay `identity.rs` / cred-hub-cf 同方案，仅 `k` 与 path 不同。
- **私有模式**：配置 `WEB_HUB_TOKEN`（`wrangler secret put`）后只认 `X-Web-Fetch-Token`（常数时间比较），完全跳过签名校验。

## 实现要点（与 ai-relay web 模块的语义对照）

- **SSRF 防护**：IP 字面量黑名单（v4 全段 + v6 ULA/链路本地/组播/环回，含 `::ffff:` 映射 v4）+ 内部主机名黑名单（localhost / `.local` / `.internal` / `.arpa`）。**边缘环境无法做调用方视角 DNS 解析**，域名黑名单只挡名字不挡解析结果——残余面与自建服务器不同（Workers 出站到不了部署者内网）。
- **重定向**：`fetch(url, { redirect: "manual" })` 手动跟随，最多 3 跳，每跳 `new URL(loc, current)` 拼接后重新 `validateTarget`（scheme + 主机校验）。
- **大小上限**：`Web Reader` 流式读取 + `TextDecoder({stream:true})` 累积解码（正确处理跨 chunk 多字节），超 `WEB_HUB_MAX_BYTES`（默认 2MB）截断置 `truncated: true`，不整体失败。
- **超时**：`AbortSignal.timeout(WEB_HUB_TIMEOUT_MS)`（默认 15s）。
- **Content-Type 白名单**：空 / `text/*` / json / xml / javascript / yaml 放行，其余 422。
- **上游 4xx/5xx 不是网关错误**：状态码与文本 200 包裹返回（协议约定，AI 需要看到 404 页面内容）。
- **CORS**：`WEB_HUB_CORS` 与 cred-hub-cf 的 `CRED_HUB_CORS` 同规则（`"1"` 全放行 / 逗号白名单含子域通配 / 留空不处理）；`OPTIONS` 预检请求一律 204。
- **响应错误形状**：`{ "error": { "message", "type": "web_fetch_error" } }`（与 relay 的 api_error 形状一致，区别于 cred-hub-cf 的 `{ ok: false, error: string }`）。

## 部署事实

- 无 D1 / KV bindings，`npx wrangler deploy` 即上线；配置全部在 `[vars]` + secrets（`WEB_HUB_TOKEN`）。
- 本地调试 `npm run dev`（wrangler dev，127.0.0.1:8787）。

## 已知的限制与演进方向

- **公开模式无强身份、无配额**：签名可被任意密钥对伪造（防扫描不防蓄意）。演进路径：① 加 KV 按用户日配额（userId = 公钥哈希做 key）；② 效仿 ai-relay 邀请码 + 绑定签名（强身份）；③ Cloudflare Turnstile 人机校验。
- 域名解析型 SSRF（公网域名解析到私网 IP）在边缘环境不可见，依赖 Workers 出站网络隔离；若迁移到自管服务器（Node/Rust）部署同一协议，**必须**换成 ai-relay web 模块的「解析后逐 IP 校验」实现。
- 暂无 /search 端点：协议已预留（mz/net README 第 6 节），接入 Tavily/Brave 时在本 Worker 加 `/search` 并在 mz/net 层加对应方法即可。
