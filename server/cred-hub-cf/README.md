# cred-hub-cf

cred-hub 的 Cloudflare Workers + D1 版本。接口、校验规则、配对码语义与 Rust 版（[server/cred-hub](../cred-hub)）完全一致，验签方案同为 NoneOS 的 ECDSA P-256 规范化排序——两个版本在相同密钥下派生出的配对码互通。

## 运行

```bash
npm install
npm run init-db:local   # 初始化本地 D1（首次）
npm run dev             # 本地 wrangler dev，端口 8788
```

部署：

```bash
# 1. 复制模板配置为正式配置
#    cp wrangler.toml.example wrangler.toml
#
# 2. 在 Cloudflare Dashboard 创建 D1 数据库 cred-hub，
#    把返回的 database_id 填入 wrangler.toml 的 [[d1_databases]] 段
#
# 3. npm run init-db:remote
# 4. npm run deploy
```

> 仓库里默认提供的是 [wrangler.toml.example](wrangler.toml.example) 模板（避免把真实 database_id 等敏感信息提交进 Git）。首次使用前必须把它复制/重命名为 `wrangler.toml`，并填充 `database_id` 等实际值。

环境变量 / [vars](wrangler.toml)：

- `CRED_HUB_CORS`：跨域控制，三种取值——
  - `"1"`：放行任意 Origin（`access-control-allow-origin: *`）
  - 逗号分隔的 Origin 白名单，如 `"https://app.example.com,https://mz.example.org"`：请求 Origin 命中时回显该 Origin（带 `Vary: Origin`），未命中不带 CORS 头，由浏览器拦截
  - 留空：不处理 CORS，走网关反代时由网关统一配置，避免 ACAO 头重复被浏览器拒绝
- `CRED_HUB_RETENTION_MS`：cred 冷数据保留毫秒数，默认 7 天
- `CRED_HUB_MAX_CRED_BYTES`：单条 cred 请求体大小上限（字节），默认 `2048`。超限返回 `413`，且在验签前拦截（防灌库 / 恶意大 payload）
- `CRED_HUB_ADMIN_TOKEN`：管理 API 令牌（建议 `openssl rand -base64 32` 生成；线上 `wrangler secret put CRED_HUB_ADMIN_TOKEN`，勿写进 wrangler.toml）。未配置 = `/admin/*` 一律 404

## 接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/creds` | 上传 cred：结构 → 有效期 → 验签三层校验后入库。请求体超 `CRED_HUB_MAX_CRED_BYTES` 上限 `413`（校验前拦截） / 非法 `422` / 同 key signTime 不更新 `409`；成功 `201 {"ok":true,"id":<key>}` |
| GET | `/creds/{key}` | 按 key 返回完整 cred JSON；未找到 `404`；`?touch=0` 只读不续命 |
| POST | `/pairing/register` | 签名 profile 卡片换配对码 `{ok,code,expiresAt}`，语义同 Rust 版（不要求 `id`、豁免 expire；自适应 6/8 位） |
| GET | `/pairing/resolve?code=` | 凭码取回完整卡片；**未命中才计限流**（每 IP 每分钟 30 次，超限 `429`），成功解析不占额度；无黑名单，分钟窗口滚动自动恢复 |
| GET | `/admin/stats` `/admin/hot` `/admin/expiring` | 管理 API（只读统计）。需配置 `CRED_HUB_ADMIN_TOKEN` 并带 `Authorization: Bearer <token>`（本地 vars / 线上 `wrangler secret put`）；未配置 = `/admin/*` 一律 404，错/缺 token 401 |
| GET | `/health` | 健康检查 |

## 与 Rust 版的实现差异（语义对齐）

| | Rust 版 | CF 版 |
| --- | --- | --- |
| 存储 | redb 单文件 + 内存读缓存 | D1 表 `creds` / `pairing_cards` / `resolve_fails` / `meta` |
| 冷数据清扫 | 后台定时任务（保留期/10 间隔） | 访问续命 + 写入时按 ~5% 概率惰性清理；配对卡过期惰性删除 |
| resolve 失败限流 | 进程内 HashMap 固定窗口 | D1 `resolve_fails(ip, minute)` UPSERT RETURNING |
| 配对码密钥 | redb meta 表持久化 | D1 meta 表持久化（首次请求生成） |

## 冒烟测试

一条命令全自动（自建本地 D1 → 拉起 wrangler dev → 跑用例 → 清理进程）：

```bash
npm test          # 本目录；或根目录 npm run cred-hub-cf-test
```

覆盖 17 项：`/creds` 入库读回 / 篡改验签拦截 / signTime 收敛（409）/ 超大小上限 413，配对码取码幂等 / 凭码解析 / 无效码 404 / 非 profile 拒绝 / 篡改拦截，管理 API 鉴权（无/错 token 401）/ stats 总览 / hot 倒序 / expiring 升序。签名工具直接复用 Rust 版 e2e 的 `helpers.mjs`（同一套 NoneOS 方案），保证两版本验签兼容。若 8788 端口已有 dev 实例则自动复用、结束时不会杀掉它。

## 调试工具备忘

- `wrangler dev`：本地 workerd 运行时（与线上同款），绑定本地模拟，改代码热重载
- `wrangler tail --format pretty`：流式查看线上 Worker 日志（worker.js 里的 console.error 会输出到这里）
- Dashboard：Workers 日志 / D1 Web 控制台可直接跑 SQL
