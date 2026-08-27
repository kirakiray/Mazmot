# cred-client

cred-hub 的浏览器端管理器：一个**纯静态、零依赖**的单页应用，调用 cred-hub 的只读管理 API（`/admin/stats`、`/admin/hot`、`/admin/expiring`）查看服务状态。与 [server/cred-hub](../cred-hub)（Rust 版）和 [server/cred-hub-cf](../cred-hub-cf)（CF 版）均兼容——两版管理 API 语义一致。

## 运行

无构建，任意静态服务器直接托管本目录即可：

```bash
cd server/cred-client
npx http-server -p 8090 -c-1
# 打开 http://localhost:8090
```

也可以直接双击 `index.html` 用 `file://` 打开（fetch 到 http 服务器的跨域由服务器的 CORS 配置决定）。

## 使用

1. 填入 cred-hub 服务器地址与管理令牌（即服务器端 `CRED_HUB_ADMIN_TOKEN`），点「连接」；连接信息只保存在本浏览器 localStorage。
2. **概览**：凭证总数、active（最近一半保留期内被访问）/ cooling（变冷）、有效配对码数、保留期。
3. **热点凭证**：按最后访问倒序列出（`/admin/hot`，条数 1–200）。
4. **即将到期**：未来 N 天内到期的凭证，升序（`/admin/expiring`）。

常见报错：

- **401**：令牌错误。
- **404**：服务器未配置 `CRED_HUB_ADMIN_TOKEN`，管理 API 整体关闭（不暴露存在痕迹，属预期行为）。
- **网络请求失败**：服务器不可达，或浏览器直连但服务器未开跨域——Rust 版启动加 `CRED_HUB_CORS=1`（根目录 `npm run cred-hub` 已带），CF 版设 `CRED_HUB_CORS="1"` 或域名白名单；反代部署时由网关统一放行本页面的来源。

> 管理令牌经浏览器发给 cred-hub，请勿在不可信机器上使用；生产环境建议只经 HTTPS 反代访问。
