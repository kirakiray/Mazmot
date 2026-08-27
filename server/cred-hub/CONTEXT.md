# CONTEXT.md — cred-hub

本文件为 AI 代理提供 cred-hub 的架构速查：目录结构、数据模型、验签方案与关键流程。与代码保持同步维护；**查看或修改 cred-hub 前必读本文件**。

## 项目概览

- **定位**：专门存储 NoneOS 凭证（cred / 证书）数据的独立 HTTP 服务器。Rust + axum 实现，不依赖前端静态部署，也不参与 NoneOS Core Service Worker 体系。
- **状态**：暂无认证，任何人可访问；防滥用手段为保留期冷淘汰 + 单条大小上限（`CRED_HUB_MAX_CRED_BYTES`，默认 2048 字节，超限 413 且在验签前拦截）；鉴权机制为后续规划项，实现时需同步更新本文件与 README。
- **签名兼容性（核心约束）**：所有验签逻辑必须与 NoneOS Core 保持一致——改动 `src/validate.rs` 的序列化或验签方式前，先核对 `noneos-core` 的 `BaseUser._sign` / cert 统一导入路径。

## 目录结构

```
server/cred-hub/
├── Cargo.toml               # 包名 cred-hub；依赖 axum / tokio / serde(derive) / serde_json(preserve_order) / redb / p256 / base64 / sha2
├── CONTEXT.md               # 本文件
├── README.md                # 运行与接口文档
├── src/
│   ├── main.rs              # axum 服务：路由 + redb 持久化（内存读缓存 + 到期索引冷淘汰）+ signTime 收敛覆盖语义
│   ├── pairing.rs           # 配对码模块：短码（6-10 位小写数字）换签名用户卡片的中转，见「配对码」章节
│   ├── admin.rs             # 管理 API：Bearer Token 鉴权（CRED_HUB_ADMIN_TOKEN，常数时间比较；未配置 = /admin/* 404）+ stats/hot/expiring 只读统计端点
│   └── validate.rs          # cred 数据校验：结构校验 / 有效期校验 / ECDSA P-256 规范化排序验签
└── e2e/
    ├── package.json         # e2e 独立 npm 环境（@playwright/test）；npm test = 主套件 → retention 套件顺序执行
    ├── playwright.config.js          # 主套件（19 用例）；webServer 自动 cargo run（端口 8790，独立数据文件）
    ├── retention.playwright.config.js # 冷数据淘汰专项（3 用例）；短保留期实例（端口 8791，CRED_HUB_RETENTION_MS=2000）
    ├── helpers.mjs          # 公共签名工具（NoneOS 方案：WebCrypto P-256 + 规范化序列化）
    ├── cred-hub.e2e.test.js        # 接口用例
    ├── pairing.e2e.test.js         # 配对码用例
    ├── cred-retention.e2e.test.js  # 淘汰时序用例（观察走 ?touch=0 不续命）
    └── .gitignore           # node_modules / test-results 等
```

## 接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/creds` | 上传 cred 数据：超大小上限 `413`（校验前拦截）→ 结构 → 有效期 → 验签三层校验后入库。成功 `201 {"ok":true,"id":<key>}`；非法 `422 {"ok":false,"error":...}`；同 key 且 signTime 不更新 `409` |
| GET | `/creds/{key}` | 按 key（记录的 `id`）返回完整 cred JSON；未找到 `404`。`?touch=0` 只读不续命 |
| POST | `/pairing/register` | 提交签名用户卡片换取配对码，见「配对码」章节 |
| GET | `/pairing/resolve?code=` | 凭码取回完整用户卡片，见「配对码」章节 |
| GET | `/admin/stats` `/admin/hot` `/admin/expiring` | 管理 API（只读统计），见「管理 API」章节 |
| GET | `/health` | 健康检查，返回文本 `ok` |

key 即记录 id，格式 `role-issuer-subject`。

### 配对码（pairing.rs）

解决「首次交换需要手输超长 userId」：客户端提交自己的签名 profile 卡片换短码，对方凭码解析回完整卡片后**照常本地验签**——服务器只做中转、不是身份权威。规则：

- 码 = 6 或 8 位小写字母数字（**自适应**：发码时内存有效条目 ≤300 发 6 位，否则 8 位；存储按字面码索引，长短混存不影响解析），由 `sha256(secret || userId || ":" + 窗口号)` 截取派生；窗口 5 分钟，同用户同窗口重复提交幂等（同长同码覆盖存储）；响应带服务器时间 `expiresAt` 供前端倒计时
- 解读期 = 窗口剩余 + 一个完整窗口宽限（约 10 分钟），过期条目惰性删除；同用户注册新窗口的码时旧码立即作废
- register 走 `validate_profile_card`（profile 专用：不要求 `id`——core 的 profile API 返回签名载荷视图无 DB 外层 id；豁免 expire 检查，与 core 对 profile 的例外一致），额外要求 `role=profile` 且 issuer === subject（自签）
- 卡片存内存（重启清空无碍），不进 redb 主表
- resolve 按**字面码**查找（无需知道 userId），大小写不敏感；限流只针对**未命中**（每 IP 每分钟 30 次，固定窗口，超限 429）——成功解析不占额度（CGNAT 下大量真实用户共享出口 IP），而盲扫流量几乎全是未命中；404 无效/过期不区分
- 密钥首次启动生成并持久化在 redb 的 `meta` 表（key: `pairing-secret`），保证重启后同窗口派生相同的码

### 管理 API（admin.rs）

Bearer Token 鉴权的只读统计：`CRED_HUB_ADMIN_TOKEN` 未配置 = `/admin/*` 一律 404；配置后需 `Authorization: Bearer <token>`，错/缺 401，比对为常数时间实现。

- `/admin/stats`：总量、active（最近一半保留期内被访问）、cooling、配对码有效数
- `/admin/hot?limit=50`（上限 200）：最后访问倒序条目
- `/admin/expiring?withinDays=30`：未来 N 天内到期记录，升序；expire 为 null（永不过期）与已过期的不在内

### CORS

默认**关闭**，经环境变量 `CRED_HUB_CORS=1` 开启（tower-http `CorsLayer::permissive`，放行任意 Origin）。本地裸跑用根目录 `npm run cred-hub`（脚本已带此参数，浏览器前端跨域直连需要）；反代部署时保持关闭、CORS 统一交给 nginx——若两侧都配会导致响应携带重复的 `Access-Control-Allow-Origin` 头被浏览器拒绝。

### 校验规则（validate.rs）

1. **结构**：必填字段 `id`、`role`、`issuer`、`subject`、`signTime`、`publicKey`、`signature`。
2. **有效期**：`expire` 若存在且非 null，必须是毫秒时间戳，晚于 `signTime` 且未过期；`expire: null` = 永不过期。时间戳解析兼容数字、纯数字字符串、ISO-8601 UTC 字符串。
3. **验签**：ECDSA P-256 + SHA-256。
   - `publicKey`：base64(SPKI DER)，用 `p256::VerifyingKey::from_public_key_der` 解析；
   - `signature`：base64(WebCrypto raw r||s，64 字节)，`Signature::from_slice` 直接解析；
   - 待签内容：剥离 `signature` 后，其余全部字段按 key 字母序递归排序、紧凑无空白地 `JSON.stringify`（`to_canonical_json`），与 NoneOS Core 证书统一导入路径的规范化排序验签一致，不受字段顺序影响。

## 数据模型

存储即上传的完整 cred JSON 原样（含 `signature` / `publicKey` 及任意自定义字段）。持久化用 [redb](https://docs.rs/redb)（纯 Rust 嵌入式 KV，ACID 事务，单文件，默认 `data/cred-store.redb`，可经 `CRED_HUB_DATA` 改路径）：每条记录以内部信封 `{ cred, lastAccessMs }` 序列化存入 `creds` 表（对外接口仍返回裸 cred）；覆盖检查（同 key signTime 收敛）与插入在同一个写事务内完成。内存另持一份 `HashMap` 读缓存 + `(截止时间, key)` 有序集合到期索引，写事务提交成功后才更新，读取不落盘。

### 冷数据淘汰（数据保留）

生命周期由**访问热度**决定而非证书 `expire`：写入时初始化 `lastAccessMs`，GET 命中刷新（续命），后台单个清扫任务按「最后访问时间 + 保留期」删除冷记录（保留期 `CRED_HUB_RETENTION_MS`，默认 7 天；清扫间隔 = 保留期/10，下限 1 秒）。索引用 BTreeSet，清扫只弹出真正到期的条目，无全量遍历；重启后经启动加载流程重建缓存与索引。⚠️ 索引元组统一为「截止时间 = lastAccessMs + retention」，续命/删除时构造旧条目必须同格式（曾因一边存截止时间、一边存访问时间导致热记录被误删的坑）。

覆盖语义与 core 一致：同 id 新记录 `signTime` 更晚才覆盖入库，否则返回 `409` 拒绝（幂等收敛）。

## 关键流程

### 上传（POST /creds）

读取原始请求体 → 大小上限检查（超限 `413`，不做任何校验/运算）→ 解析 JSON → `validate::validate_cred`（结构 / 有效期 / 排序序列化验签）→ 与既有同 key 记录比较 `signTime`（更旧/相同则 409）→ 写入内存并落盘 → 返回 201。任一步失败立即返回对应错误码，不做部分写入。

### 启动

读环境变量（`CRED_HUB_PORT` 默认 8787、`CRED_HUB_DATA` 默认 `data/cred-store.redb`、`CRED_HUB_RETENTION_MS` 默认 7 天、`CRED_HUB_MAX_CRED_BYTES` 默认 2048）→ 打开 redb 库并把全部记录加载进内存读缓存与到期索引 → 启动后台清扫任务 → 绑定 `0.0.0.0:<port>` 提供服务。注意 redb 以文件魔数识别库格式，旧的 JSON 存储文件会被拒绝打开，切换前需迁移或删除。

## e2e 测试

- 位置 [e2e/](e2e/)，Playwright + Chrome，本地运行 `cd e2e && npx playwright test`。
- 配置在 `playwright.config.js` 的 `webServer`：自动 `cargo run` 起服务（端口 8790、数据文件 `data/e2e-cred-store.redb`），就绪后才执行用例。
- 测试自身用 Node 内置 WebCrypto 按 NoneOS 同款方案生成密钥并签名（`sortedStringify` 复刻 Rust 端 `to_canonical_json`），**重签数据前必须先剥离旧 `signature` 字段**，否则签名内容包含旧签名导致验签失败（踩过的坑）。
- CI：[.github/workflows/cred-hub-e2e.yml](../../.github/workflows/cred-hub-e2e.yml)（push/PR 到 main 且涉及 `server/cred-hub/**` 触发，Ubuntu 上先 cargo build 再跑 Chrome 全量用例）。

## 本仓库其他入口

- 根目录 `npm run cred-hub` 可直接启动本服务（等价 `cd server/cred-hub && cargo run --release`）。
