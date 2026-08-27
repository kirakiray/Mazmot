# CONTEXT.md — cred-hub-cf

本文件为 AI 代理提供 cred-hub-cf 的架构速查。接口、校验、配对码语义与 Rust 版完全一致，**改前先读 [../cred-hub/CONTEXT.md](../cred-hub/CONTEXT.md)**；两文件须同步维护。

## 项目概览

- **定位**：cred-hub 的 Cloudflare Workers + D1 移植版，供无自托管服务器时部署。
- **签名兼容性（核心约束）**：与 Rust 版 / NoneOS Core 一致——ECDSA P-256 + SHA-256，publicKey 为 base64(SPKI DER)，signature 为 base64(raw r||s 64 字节)，待签内容为剥离 signature 后按 key 字母序递归排序的紧凑 JSON。配对码派生算法同源（`sha256(secret || userId || ":" + 窗口号)` 截取 mod 36），**相同密钥下两版本码互通**。
- **大小上限**：`CRED_HUB_MAX_CRED_BYTES`（默认 2048 字节）超限 `413`，与 Rust 版同语义，均在验签前拦截。

## 目录结构

```
server/cred-hub-cf/
├── .wrangler.toml   # wrangler.toml 模板（database_id 为占位符）；首次使用需复制为 wrangler.toml 并填充真实值
├── schema.sql       # 四张表：creds / pairing_cards / resolve_fails / meta
├── src/worker.js    # 全部逻辑单文件：校验验签 + /creds + 配对码
├── smoke.mjs        # 冒烟用例（复用 ../cred-hub/e2e/helpers.mjs 签名工具）
├── run-tests.mjs    # 测试自管生命周期：初始化 D1 → 拉起 wrangler dev → 跑 smoke → 清理
└── package.json     # scripts: dev / deploy / init-db:local / init-db:remote / test
```

## 数据模型（D1）

- `creds(key PK, cred JSON文本, last_access_ms)`：key 即记录 id（role-issuer-subject）。覆盖语义与 core/Rust 版一致——同 key 新 signTime 更晚才覆盖，否则 409。
- `pairing_cards(code PK, subject, card, expires_at_ms)`：code 即字面配对码（6/8 位自适应混存）。
- `resolve_fails(ip+minute PK, count)`：未命中解析计数。
- `meta(k PK, v BLOB)`：`pairing-secret` 首次请求生成并持久化。

## 管理 API（与 Rust 版 admin.rs 语义一致）

Bearer Token 鉴权（`CRED_HUB_ADMIN_TOKEN`，本地 vars / 线上 `wrangler secret put`；常数时间比较）：未配置 = `/admin/*` 一律 404，错/缺 token 401。

- `/admin/stats`：总量 / active（最近一半保留期内被访问）/ cooling / 配对码有效数（均为 D1 `COUNT(*)`）
- `/admin/hot?limit=50`（上限 200）：`ORDER BY last_access_ms DESC`
- `/admin/expiring?withinDays=30`：expire 在 JSON 内，量级为个人服务规模，全量拉取后内存过滤再按到期升序

## 关键流程差异（相对 Rust 版）

- **无后台任务**：冷数据靠 GET 续命 + 写入时 ~5% 概率清扫过期记录；配对卡注册时清理同 subject 旧码与全部过期条目，resolve 命中过期卡时惰性删除。
- **限流落库**：resolve 未命中走 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`，>30 触发 429；成功解析不计数、无黑名单，分钟窗口滚动自动恢复。
- 自适应码长阈值 300 与窗口/宽限常量在 worker.js 顶部，与 Rust 版保持一致。

## CORS

`CRED_HUB_CORS` 三种取值：`"1"`/`"*"` = 任意 Origin（`allow-origin: *`）；逗号分隔 Origin 白名单 = 命中才回显请求 Origin（尾部 `/` 容错，附 `Vary: Origin`），未命中不带 CORS 头；留空 = 不处理（反代统一配置）。解析在 `parseCorsOrigins`，白名单模式回显具体 Origin 而非 `*`（带凭据的浏览器请求拒绝通配）。

## 测试

`npm test`（或根目录 `npm run cred-hub-cf-test`，会先自动 npm install）：[run-tests.mjs](run-tests.mjs) 自管生命周期——初始化本地 D1 → 拉起 wrangler dev（8788，已有实例则复用）→ 跑 smoke.mjs → 结束清理 dev 进程。冒烟覆盖 /creds 入库读回 / 篡改拦截 / signTime 收敛 / 超大小上限 413，配对码取码幂等 / 凭码解析 / 无效码 / 非 profile 拒绝 / 篡改拦截，及管理 API 鉴权（无/错 token 401）/ stats / hot / expiring，共 17 项。签名工具复用 `../cred-hub/e2e/helpers.mjs`。
