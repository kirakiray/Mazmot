# ai-relay

AI API 转发服务器：apikey 隔离 + 用户 token 配额统计。管理员集中保管 DeepSeek / GLM 上游 apikey，创建带配额的用户并签发邀请码；终端用户凭邀请码（URL-safe Base64 的 JSON `{"u": serverUrl, "k": bearkey}`）通过本服务器以 OpenAI 兼容接口使用 AI，token 用量按用户统计、达到累计配额即拒绝。与 Mazmot 的集成见 `mz/ai/supplier/relay.js`；管理后台前端在同级的 `../ai-relay-admin/`。

## 目录结构

```
server/ai-relay/
├── Cargo.toml          # axum + tokio + redb + reqwest + p256，独立 crate（无 workspace）
├── ai-relay.toml.example
├── e2e/e2e.mjs         # 功能 e2e（Node，起真服务器打真实上游，见下「部署 / 测试」）
└── src/
    ├── main.rs         # AppState（内存读缓存 + redb 权威数据）、路由注册、配置加载、bearer 工具
    ├── store.rs        # 数据模型（UserRec / ApiKeyRec / UsageRec）、redb 三表、随机 token、邀请码编解码、单测
    ├── identity.rs     # NoneOS 用户绑定：ECDSA P-256 验签（对齐 noneos-core `_sign`）、userId 哈希校验、单测
    ├── admin.rs        # /admin/* 管理 API（CRUD + 邀请码 + 用量 + 绑定查看/解绑）
    ├── proxy.rs        # /v1/* 用户 API（chat 转发 + 流式透传统计、models 合并、usage 查询、activate 激活绑定；auth_user / check_bound_signature 供 web 模块复用）
    └── web.rs          # /v1/web/fetch 服务端网页抓取（SSRF 防护 + 手动重定向逐跳校验 + 大小/超时/类型上限，单测）
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

- `users`：`UserRec { id, name, note, quota_tokens(可空=无限), used_tokens(累计，不自动重置), total_requests(累计对话轮数), bearkey("ar-"+32位随机), disabled, created_at, api_key_ids[], allowed_models[](模型白名单，空=不限；支持 `glm-5*` 前缀通配，见 `model_allowed`), bind_mode("open"默认|"bound"), web_fetch_enabled(serde 默认 true——能力先于开关上线，老记录升级后行为不变；false 时 /v1/web/fetch 返回 403), bound_user_id, bound_pubkey(SPKI DER base64), bound_at }`
  - `bind_mode=bound` 时一人一码：首次 `POST /v1/activate` 激活绑定（ECDSA P-256 签名，与 noneos-core 证书同体系，见 identity 模块），之后 `/v1/*` 请求必须带 `X-Relay-Auth` 签名头（覆盖 userId/ts/method/path/bodyHash，±10 分钟时间窗）；admin 可解绑重新开放激活
- `apikeys`：`ApiKeyRec { id, provider("deepseek"|"glm"|"glm-coding"|"openai"|"gemini"|"anthropic"|"qwen"), label, api_key(明文仅本地), masked_key, disabled, created_at }`；创建前经 `proxy::probe_key` 真实上游探测（GET /models，404/405 降级 1 token 对话探测，降级对话按各家挑稳定便宜款：deepseek-flash / gpt-5.1 / gemini-2.5-flash / claude-haiku-4-5 / qwen3-flash / glm-4.7），失败 422 不落库
- `usage`：流水 `UsageRec { user_id, ts, model, prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens(兼容 DeepSeek 扁平字段与 GLM prompt_tokens_details.cached_tokens，仅命中时 miss=输入-命中，全无则 0), key_id }`，行 key = `{user_id}\0{ts}\0{nonce}`

## 接口约定

- 管理 `/admin/*`：Bearer = AI_RELAY_ADMIN_TOKEN（恒定时间比较）。响应统一 `{ ok, data }` 或 `{ ok: false, error }`。
  - `GET /admin/overview`；`GET|POST /admin/apikeys`；`PATCH|DELETE /admin/apikeys/{id}`（仍被用户绑定时删除返回 409）
  - `GET|POST /admin/users`；`PATCH|DELETE /admin/users/{id}`（含 `allowedModels` 白名单、`bindMode` 编辑、`webFetchEnabled` 联网开关——创建/编辑均可带，缺省 true；用户列表与 `user_public` 输出回显 `webFetchEnabled`）；`POST /admin/users/{id}/unbind`（清绑定记录，重新开放激活）；`POST /admin/users/{id}/reset-usage`；`GET /admin/users/{id}/models`（key 池聚合模型清单，不过滤白名单，供管理台点选）
  - `GET /admin/users/{id}/invite`（返回 `{ code, serverUrl, bearkey }`）；`POST /admin/users/{id}/reset-bearkey`（作废旧码）
  - `GET /admin/usage?userId=&limit=`（每条含 `totalTokens` = 输入+输出）
  - `GET /admin/overview`：总览 `{ serverName, version(=CARGO_PKG_VERSION), users/apikeys 总数与禁用数, totalUsedTokens, usageRecords }`；管理台顶栏与账户列表据此展示服务器版本
  - `GET|PATCH /admin/settings`（`serverName` 服务器自定义命名，持久化 settings 表；env `AI_RELAY_SERVER_NAME` 仅作初始值）
  - 创建后 apikey 明文不再可读，只回 `maskedKey`
- 用户 `/v1/*`（OpenAI 兼容，Bearer = 用户 bearkey）：
  - `POST /v1/activate`：NoneOS 用户激活绑定（请求体即签名对象；`bind_mode=bound` 时首次激活落 `bound_user_id`/`bound_pubkey`，已被他人绑定时 409；open 模式空操作）；客户端由 `mz/ai/supplier/relay.js` 在首次使用时自动调用
  - `POST /v1/chat/completions`：按模型名前缀从 key 池内选可用上游（`deepseek-*` → api.deepseek.com，`glm-*` → glm 按量 key 或 glm-coding 订阅 key（open.bigmodel.cn/api/[coding/]paas/v4），`gpt-*`/`chatgpt-*`/`o1·o3·o4-*` → api.openai.com/v1，`gemini-*` → 官方 OpenAI 兼容端点 generativelanguage.googleapis.com/v1beta/openai，`claude-*` → 官方 OpenAI 兼容层 api.anthropic.com/v1（同带 `x-api-key` + `anthropic-version` 头），`qwen-*` → DashScope 兼容模式 dashscope.aliyuncs.com/compatible-mode/v1（见 `Provider::serves_model` / `upstream_base` / `extra_upstream_headers`））随机选取；流式请求注入 `stream_options.include_usage` 并边透传边扫末 chunk usage 落账（含 prompt/completion/cache_hit/cache_miss 明细；Gemini / Anthropic 兼容层不认识 stream_options，跳过注入，用量退化为扫上游自然返回的 usage，无则记 0，见 `Provider::supports_stream_options`），每条流水同时给用户累计 used_tokens 与 total_requests；非流式直接读 usage。超额 402，禁用 403，无匹配 key 400，上游错误原样透传状态码与响应体。
  - `GET /v1/models`：合并 key 池各上游模型（去重 + 按白名单过滤）；chat 对白名单外模型返回 403
  - `GET /v1/usage`：`{ serverName, quotaTokens, usedTokens, totalRequests, remainingTokens }`
  - `GET /v1/server`：`{ name, version }` 服务器命名与版本（公开、无需鉴权，客户端展示用；管理台与 mz/ai 的 fetchServerInfo 均消费）
  - `POST /v1/web/fetch`：服务端代理抓取网页文本（浏览器 CORS 不可达的补充能力），body `{ url }`，成功 200 `{ url, status, contentType, text, truncated }`（status 为上游状态码，404 等不算网关错误），失败 `{ error: { message, type } }`。鉴权与 chat 一致；抓取不计入 token 配额；**按用户开关**——`web_fetch_enabled=false` 的用户 403「未开通 web fetch 能力」（管理台用户管理可开/关）。安全约束：仅 http/https、内部主机名与私网 IP 黑名单（域名解析后逐 IP 校验）、重定向手动跟随最多 3 跳每跳重新校验、响应体 2MB 截断、总超时 15s、Content-Type 仅放行文本类。协议契约与客户端见 `mz/net/README.md`（单一事实来源）。


## 部署 / 测试

- 本地跑：仓库根 `npm run ai-relay`（= `cd server/ai-relay && cargo run --release`），或直接 `AI_RELAY_ADMIN_TOKEN=xxx cargo run`；配置示例见 `ai-relay.toml.example`。
- 单测：`cargo test`（邀请码编解码、模型前缀路由、redb 持久化 roundtrip、web 模块私网黑名单与目标校验等）。
- 管理 UI e2e：`npm run ai-relay-e2e`（= `cd server/ai-relay/e2e && npx playwright test --project=chrome`，首次需在该目录 `npm install` 装 @playwright/test）。三 webServer 起真服务器 ×2（18974 / 18976 端口、独立数据文件，第二台供多账户用例）+ 仓库静态服务器（18975）；浏览器先经根入口安装 NoneOS Core 再打开 `server/ai-relay-admin/`，覆盖：连接 → 添加上游 key（masked 展示）→ 新建用户（配额 / key 池勾选）→ 详情邀请码解码与服务器交叉校验 → 清零用量 → 删除用户 → 断开连接（账户保留）→ 已保存账户一键重连 → 添加第二台服务器 → 切换弹窗来回切换（当前账户标记 + 两台状态独立）→ 删除账户（非活跃仅移除 / 活跃断开回连接页）。需外网装 Core 时给浏览器挂代理：`E2E_PROXY=http://127.0.0.1:8118 npm run ai-relay-e2e`。
- 功能 e2e：`cd server/ai-relay && node e2e/e2e.mjs`——自动以随机端口 / 临时数据目录 / 随机 admin token 起真服务器，读取仓库根 `test-api-keys.json` 的 deepseek key 打真实上游，覆盖：管理 API 鉴权（401）、添加 key（明文不回传）、建用户、邀请码签发与解码校验、错误 bearkey 拒绝（401）、/v1/models、非流式与流式 chat（SSE 透传 + 末 chunk usage）、用量流水与 usedTokens 累计、超额 402（配额语义=用满即拒，首次请求前 used=0 必然放行）、重置 bearkey 后旧码作废、用户绑定（node webcrypto 模拟 noneos `_sign`：创建 bound 用户 → 未签名 403 → 激活 → 签名对话成功 → 篡改 body / 过期时间戳 403 → 第二用户激活 409 → admin 查看绑定者与解绑）。走真实上游会产生少量 token 消耗（统一 max_tokens=16）。
- x86 Linux 打包：`cargo zigbuild --release --target x86_64-unknown-linux-musl`（依赖 cargo-zigbuild + zig；reqwest 用 rustls-tls 特性，无 OpenSSL 依赖，产物为静态链接单文件），发布包放 `dist/<name>/`（含二进制 + 配置示例 + README，同级打 tar.gz），`dist/` 不入 git 忽略。
