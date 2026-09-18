# ai-relay

AI API 转发服务器：apikey 隔离 + 用户 token 配额统计。管理员集中保管 DeepSeek / GLM 上游 apikey，创建带配额的用户并签发邀请码；终端用户凭邀请码（URL-safe Base64 的 JSON `{"u": serverUrl, "k": bearkey}`）通过本服务器以 OpenAI 兼容接口使用 AI，token 用量按用户统计、达到累计配额即拒绝。与 Mazmot 的集成见 `mz/ai/supplier/relay.js`；管理后台前端在同级的 `../ai-relay-admin/`。

## 目录结构

```
server/ai-relay/
├── Cargo.toml          # axum + tokio + redb + reqwest，独立 crate（无 workspace）
├── ai-relay.toml.example
├── e2e/e2e.mjs         # 功能 e2e（Node，起真服务器打真实上游，见下「部署 / 测试」）
└── src/
    ├── main.rs         # AppState（内存读缓存 + redb 权威数据）、路由注册、配置加载、bearer 工具
    ├── store.rs        # 数据模型（UserRec / ApiKeyRec / UsageRec）、redb 三表、随机 token、邀请码编解码、单测
    ├── admin.rs        # /admin/* 管理 API（CRUD + 邀请码 + 用量）
    └── proxy.rs        # /v1/* 用户 API（chat 转发 + 流式透传统计、models 合并、usage 查询）
```

## 配置（环境变量优先，其次 TOML `[vars]` 同名键）

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_RELAY_ADMIN_TOKEN` | 无 | 管理 API Bearer 令牌；**未配置时 /admin/* 一律 404**（管理面关闭） |
| `AI_RELAY_PORT` | 8791 | 监听端口 |
| `AI_RELAY_DATA` | `data/ai-relay.redb` | redb 数据文件 |
| `AI_RELAY_PUBLIC_URL` | 按请求 Host 推导 | 邀请码里 `u` 字段的服务器地址（反代 / HTTPS 部署时务必配置） |
| `AI_RELAY_CORS` | `1` | 是否放行 CORS（浏览器直连为主场景；反代统一处理时设 0） |

## 数据模型（redb 表，内存全量读缓存）

- `users`：`UserRec { id, name, note, quota_tokens(可空=无限), used_tokens(累计，不自动重置), total_requests(累计对话轮数), bearkey("ar-"+32位随机), disabled, created_at, api_key_ids[] }`
- `apikeys`：`ApiKeyRec { id, provider("deepseek"|"glm"|"glm-coding"), label, api_key(明文仅本地), masked_key, disabled, created_at }`；创建前经 `proxy::probe_key` 真实上游探测（GET /models，404/405 降级 1 token 对话探测），失败 422 不落库
- `usage`：流水 `UsageRec { user_id, ts, model, prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens(兼容 DeepSeek 扁平字段与 GLM prompt_tokens_details.cached_tokens，仅命中时 miss=输入-命中，全无则 0), key_id }`，行 key = `{user_id}\0{ts}\0{nonce}`

## 接口约定

- 管理 `/admin/*`：Bearer = AI_RELAY_ADMIN_TOKEN（恒定时间比较）。响应统一 `{ ok, data }` 或 `{ ok: false, error }`。
  - `GET /admin/overview`；`GET|POST /admin/apikeys`；`PATCH|DELETE /admin/apikeys/{id}`（仍被用户绑定时删除返回 409）
  - `GET|POST /admin/users`；`PATCH|DELETE /admin/users/{id}`；`POST /admin/users/{id}/reset-usage`
  - `GET /admin/users/{id}/invite`（返回 `{ code, serverUrl, bearkey }`）；`POST /admin/users/{id}/reset-bearkey`（作废旧码）
  - `GET /admin/usage?userId=&limit=`（每条含 `totalTokens` = 输入+输出）
  - 创建后 apikey 明文不再可读，只回 `maskedKey`
- 用户 `/v1/*`（OpenAI 兼容，Bearer = 用户 bearkey）：
  - `POST /v1/chat/completions`：按模型名前缀从 key 池内选可用上游（`deepseek-*` → api.deepseek.com，`glm-*` → glm 按量 key 或 glm-coding 订阅 key（open.bigmodel.cn/api/[coding/]paas/v4，见 `Provider::serves_model` / `upstream_base`））随机选取；流式请求注入 `stream_options.include_usage` 并边透传边扫末 chunk usage 落账（含 prompt/completion/cache_hit/cache_miss 明细），每条流水同时给用户累计 used_tokens 与 total_requests；非流式直接读 usage。超额 402，禁用 403，无匹配 key 400，上游错误原样透传状态码与响应体。
  - `GET /v1/models`：合并 key 池各上游模型（去重）
  - `GET /v1/usage`：`{ quotaTokens, usedTokens, totalRequests, remainingTokens }`

## 部署 / 测试

- 本地跑：仓库根 `npm run ai-relay`（= `cd server/ai-relay && cargo run --release`），或直接 `AI_RELAY_ADMIN_TOKEN=xxx cargo run`；配置示例见 `ai-relay.toml.example`。
- 单测：`cargo test`（邀请码编解码、模型前缀路由、redb 持久化 roundtrip 等）。
- 管理 UI e2e：`npm run ai-relay-e2e`（= `cd server/ai-relay/e2e && npx playwright test --project=chrome`，首次需在该目录 `npm install` 装 @playwright/test）。双 webServer 起真服务器（18974 端口 / 独立数据文件）+ 仓库静态服务器（18975）；浏览器先经根入口安装 NoneOS Core 再打开 `server/ai-relay-admin/`，覆盖：连接 → 添加上游 key（masked 展示）→ 新建用户（配额 / key 池勾选）→ 详情邀请码解码与服务器交叉校验 → 清零用量 → 删除用户 → 断开连接。需外网装 Core 时给浏览器挂代理：`E2E_PROXY=http://127.0.0.1:8118 npm run ai-relay-e2e`。
- 功能 e2e：`cd server/ai-relay && node e2e/e2e.mjs`——自动以随机端口 / 临时数据目录 / 随机 admin token 起真服务器，读取仓库根 `test-api-keys.json` 的 deepseek key 打真实上游，覆盖：管理 API 鉴权（401）、添加 key（明文不回传）、建用户、邀请码签发与解码校验、错误 bearkey 拒绝（401）、/v1/models、非流式与流式 chat（SSE 透传 + 末 chunk usage）、用量流水与 usedTokens 累计、超额 402（配额语义=用满即拒，首次请求前 used=0 必然放行）、重置 bearkey 后旧码作废。走真实上游会产生少量 token 消耗（统一 max_tokens=16）。
- x86 Linux 打包：`cargo zigbuild --release --target x86_64-unknown-linux-musl`（依赖 cargo-zigbuild + zig；reqwest 用 rustls-tls 特性，无 OpenSSL 依赖，产物为静态链接单文件），发布包放 `dist/<name>/`（含二进制 + 配置示例 + README，同级打 tar.gz），`dist/` 不入 git 忽略。
