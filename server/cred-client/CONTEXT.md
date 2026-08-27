# CONTEXT.md — cred-client

本文件为 AI 代理提供 cred-client 的架构速查。cred-client 是 cred-hub 的浏览器端管理器，只消费只读管理 API，不涉及存储与验签逻辑；管理 API 语义见 [../cred-hub/CONTEXT.md](../cred-hub/CONTEXT.md) 的「管理 API」章节（CF 版同语义）。

## 项目概览

- **定位**：cred-hub（Rust 版 / CF 版通用）的管理 UI，纯静态单页，无框架、无构建、无第三方依赖。
- **边界**：只读——仅调用 `/admin/stats` / `/admin/hot` / `/admin/expiring`；不提供写操作（cred-hub 本身的管理 API 也只有只读端点）。**不使用** `/nos/*`、`/gh/*` 等 NoneOS Core 资源（本工具在 Core 体系外独立运行），持久化用 localStorage（仅本浏览器）。

## 目录结构

```
server/cred-client/
├── index.html   # 单页结构：连接设置卡 + 三标签（概览 / 热点凭证 / 即将到期）
├── style.css    # 中性灰配色，跟随系统深浅色（prefers-color-scheme）
├── app.js       # 全部逻辑：连接管理 + API 封装 + 表格渲染 + 标签页切换
├── README.md    # 运行与使用说明
└── CONTEXT.md   # 本文件
```

## 关键实现

- **连接（app.js `connect` / `api`）**：地址 + Bearer 令牌存 localStorage（键 `cred-client-conn`），刷新后自动重连；`/admin/stats` 兼作连通性 / 令牌 / 管理 API 开关的探测（401=令牌错，404=服务器未配置令牌，fetch 异常=不可达或未开 CORS），错误分文案提示。
- **数据加载**：标签页切换即刷新对应数据（`loaders.stats/hot/expiring`），另有手动刷新按钮；hot 的 `limit`（1–200）与 expiring 的 `withinDays`（1–3650）与服务端上限一致并在前端 clamp。
- **渲染**：`renderTable` 统一表格渲染（`esc` 做 HTML 转义防注入）；时间戳本地化展示，`expire: null` 显示「永不过期」。
