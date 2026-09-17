# ai-relay v1.0.0 — linux-amd64

AI API 转发服务器（apikey 隔离 + 用户 token 配额统计）的 x86_64 Linux 静态构建。

## 包内容

- `ai-relay` — musl 静态链接的可执行文件（无需任何系统依赖，glibc / alpine 均可直接跑）
- `ai-relay.toml.example` — 配置示例（复制为 `ai-relay.toml` 后修改）

## 快速开始

```bash
AI_RELAY_ADMIN_TOKEN=your-admin-token ./ai-relay
# 默认监听 0.0.0.0:8791；更多配置项见 ai-relay.toml.example 内注释
```

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `AI_RELAY_ADMIN_TOKEN` | 无 | 管理 API Bearer 令牌；未配置时 /admin/* 一律 404 |
| `AI_RELAY_PORT` | 8791 | 监听端口 |
| `AI_RELAY_DATA` | `data/ai-relay.redb` | redb 数据文件 |
| `AI_RELAY_PUBLIC_URL` | 按请求 Host 推导 | 邀请码里的服务器地址（反代 / HTTPS 部署时务必配置） |
| `AI_RELAY_CORS` | `1` | 是否放行 CORS（浏览器直连为主场景） |

管理后台前端在仓库 `server/ai-relay-admin/`，完整文档见仓库 `server/ai-relay/CONTEXT.md`。

## 重新打包

开发机上执行（需 cargo-zigbuild + zig）：

```bash
cd server/ai-relay
cargo zigbuild --release --target x86_64-unknown-linux-musl
# 产物：target/x86_64-unknown-linux-musl/release/ai-relay
```
