# cred-hub

专门存储 NoneOS 凭证（cred）数据的 HTTP 服务器。Rust + axum 实现。

目前**无认证**，任何人都可访问；鉴权机制后续再加。

## 运行

```bash
cargo run --release
# 监听 http://0.0.0.0:8787
```

环境变量：

- `CRED_HUB_CORS`：设为 `1` 时启用宽松跨域（`CorsLayer::permissive`，允许任意 Origin 直连）。**默认关闭**——浏览器直连场景（本地裸跑）用根目录 `npm run cred-hub`（已带此参数）；反代部署时保持关闭、CORS 统一交给 nginx 配置，避免 `Access-Control-Allow-Origin` 头重复被浏览器拒绝
- `CRED_HUB_ADMIN_TOKEN`：管理 API 令牌（双方共享秘密，建议 `openssl rand -base64 32` 生成）。**未配置 = `/admin/*` 一律 404**；请求带 `Authorization: Bearer <token>`，比对为常数时间实现。泄露即换，重启生效
- `CRED_HUB_PORT`：监听端口，默认 `8787`
- `CRED_HUB_DATA`：存储文件路径，默认 `data/cred-store.redb`（redb 单文件 KV 数据库）
- `CRED_HUB_RETENTION_MS`：冷数据保留时长（毫秒），默认 7 天；详见下方「数据保留」
- `CRED_HUB_MAX_CRED_BYTES`：单条 cred 请求体大小上限（字节），默认 `2048`。超限返回 `413`，且在验签前拦截（防灌库 / 恶意大 payload）

## 数据保留（冷淘汰）

每条记录在写入时记录最后访问时间，GET 命中会刷新（自动续命）。后台清扫任务按「最后访问时间 + 保留期」删除不再被访问的记录——所以证书自身的 `expire` 字段只影响合法性校验，**存储生命周期由访问热度决定**：活跃凭证长期保留，一周无人问津的自动清除。

- 索引基于 `(截止时间, key)` 有序集合，清扫任务每次只弹出真正到期的条目，不做全量遍历，无到期记录时成本近似为零；
- 服务重启后启动流程会从 redb 全量重建缓存与索引，无丢失；
- 接口返回格式不受影响（`lastAccessMs` 是内部信封字段）。
- **观察专用读取**：`GET /creds/{key}?touch=0` 不刷新热度，适合监控 / 探测等不应续命的查询。

## 接口

### POST /creds —— 上传 cred 数据

请求体即完整 cred JSON（含 `signature` / `publicKey`）。服务器校验：

1. 结构：必填字段 `id`、`role`、`issuer`、`subject`、`signTime`、`publicKey`、`signature`
2. 有效期：`expire` 需晚于 `signTime` 且未过期；`expire: null` 表示永不过期
3. 签名：与 NoneOS Core 签名方案一致 —— ECDSA P-256 + SHA-256，
   `publicKey` 为 base64(SPKI DER)，`signature` 为 base64(raw r||s)，
   待签内容是剥离 `signature` 后按 key 字母序排序的 `JSON.stringify`
   （与 BaseUser._sign / cert 统一导入路径的规范化排序验签一致）

成功返回 `201 {"ok":true,"id":<key>}`；
请求体超过 `CRED_HUB_MAX_CRED_BYTES` 上限返回 `413`（在校验前拦截）；
结构/签名非法返回 `422 {"ok":false,"error":...}`。

覆盖语义与 core 一致：同 key（id）记录已存在且 signTime 不更早时返回 `409`，更新则覆盖。
key 即记录 id（格式 `role-issuer-subject`）。

### GET /creds/{key} —— 按 key 获取 cred 数据

命中返回 `200` + 完整 cred JSON；未找到返回 `404`。

### 配对码 —— POST /pairing/register + GET /pairing/resolve

「短码换用户卡片」的中转服务，解决首次交换需手输超长 userId 的问题。**信任模型与 /creds 一致：服务器只做中转，接收方拿到卡片后必须照常本地验签。**

- `POST /pairing/register`：请求体为签名 profile 卡片（profile 专用校验：不要求 `id`、豁免 expire 检查——core 的 profile API 返回的签名载荷视图即此形态；签名验证方式与 `/creds` 一致，另要求 `role=profile` 且 issuer === subject）。成功返回 `200 {"ok":true,"code":"6或8位小写字母数字","expiresAt":<毫秒时间戳>}`（自适应码长：活跃码 ≤300 发 6 位，否则 8 位）；`expiresAt` 为当前窗口（5 分钟）到期时刻，同用户同窗口重复提交幂等。
- `GET /pairing/resolve?code=xxx`：凭码取回完整卡片 JSON；码大小写不敏感。无效 / 过期返回 `404 {"ok":false,"error":...}`；**未命中**才计入限流（每 IP 每分钟 30 次，超限 `429`），成功解析不占额度——防的是脚本盲扫（几乎全是未命中），不误伤 CGNAT 共享出口 IP 的真实用户。
- 码解读期 = 窗口剩余 + 一个窗口宽限（约 10 分钟）；卡片仅存内存，重启清空。

### 管理 API —— GET /admin/stats、/admin/hot、/admin/expiring

需配置 `CRED_HUB_ADMIN_TOKEN`，请求带 `Authorization: Bearer <token>`（错/缺 401；未配置 token 时这些路由一律 404）：

```bash
curl -H "Authorization: Bearer $TOKEN" localhost:8787/admin/stats
curl -H "Authorization: Bearer $TOKEN" "localhost:8787/admin/hot?limit=50"          # 最后访问倒序热点
curl -H "Authorization: Bearer $TOKEN" "localhost:8787/admin/expiring?withinDays=30" # 未来 N 天内到期，升序
```

`stats` 返回凭证总量 / active（最近一半保留期内被访问过）/ cooling（存活但访问变冷）与配对码有效数。条目字段：`id / role / issuer / subject / expire / lastAccessMs`。

### GET /health

健康检查，返回 `ok`。

## 示例

```bash
curl -X POST localhost:8787/creds -H 'content-type: application/json' -d @cred.json
curl localhost:8787/creds/member-alice-bob
```

## e2e 测试

Playwright（Chrome）驱动的 HTTP 接口端到端测试，位于 [e2e/](e2e/)。测试用 Node 内置 WebCrypto 在本地生成密钥并按 NoneOS 签名方案签发数据，不依赖外部服务。

```bash
cd e2e
npm install
npx playwright test        # 首次需 npx playwright install chromium
```

覆盖场景：health 检查、合法入库与读回、404、篡改验签拦截、公钥替换重放拦截、缺字段校验、非法请求体、超大小上限 413、expire 早于 signTime / 已过期拒绝、永不过期、同 key signTime 收敛（409）与覆盖更新、自定义字段持久化；配对码（取码幂等同码、凭码解析、非 profile/非自签/篡改卡片拒绝、无效码 404）。

CI：[.github/workflows/cred-hub-e2e.yml](../../.github/workflows/cred-hub-e2e.yml) 在 push / PR 到 main（涉及 `server/cred-hub/**`）时于 Ubuntu 上自动跑 Chrome 全量用例。

