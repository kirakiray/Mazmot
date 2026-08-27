# CONTEXT.md — cred-client

本文件为 AI 代理提供 cred-client 的架构速查。cred-client 是 cred-hub 的浏览器端管理器，只消费只读管理 API，不涉及存储与验签逻辑；管理 API 语义见 [../cred-hub/CONTEXT.md](../cred-hub/CONTEXT.md) 的「管理 API」章节（CF 版同语义）。

## 项目概览

- **定位**：cred-hub（Rust 版 / CF 版通用）的管理 UI，基于 ofa.js 的单页应用，无构建。
- **运行环境**：**NoneOS Core 体系外独立运行**——没有 Service Worker 提供 `/gh/`、`/nos/*`，因此入口 `index.html` 与页面模块内的 senti-ui / ofa.js 资源一律使用完整 jsdelivr URL（ofa.js 锁版本 `@4.7.1`，senti-ui 用 `@latest`）；不使用 locale-text / n-icon（属 /nos/*），文案为中文写死。
- **边界**：只读——仅调用 `/admin/stats` / `/admin/hot` / `/admin/expiring`；持久化用 localStorage（仅本浏览器）。

## 目录结构

```
server/cred-client/
├── index.html      # 入口：jsdelivr 加载 ofa.js@4.7.1#debug + <o-page src="./pages/home.html">
├── pages/
│   └── home.html   # 唯一页面模块：连接表单 + 登录过的服务器列表 + 三标签（概览/热点/即将到期）
├── README.md       # 运行与使用说明
└── CONTEXT.md      # 本文件
```

## 页面逻辑（pages/home.html）

- **连接（proto.connect / api）**：`/admin/stats` 兼作连通性 / 令牌 / 管理 API 开关的探测（401=令牌错，404=服务器未配置令牌，fetch 异常=不可达或未开 CORS），错误分文案提示；状态徽标 `connState`（off/ok/err）经 watch 映射文案。
- **登录过的服务器（localStorage 键 `cred-client-accounts`）**：连接成功即 `saveAccount` 按 url 去重置顶（最多 10 条，含令牌）；`attached` 时回填最近一条并自动重连；每条支持「使用 / 忘记」，另有「全部忘记」。选中项高亮（`class:current` 比对 `$data.url === $host.urlInput`）。
- **数据标签页**：`tab`（stats/hot/expiring）watch 切换即刷新（`refreshTab` → `loadStats/loadHot/loadExpiring`）；hot 的 `limit`（1–200）与 expiring 的 `withinDays`（1–3650）与服务端上限一致并在前端 clamp。
- **渲染**：凭证列表用 `o-fill` + 卡片行（role 徽章 + issuer → subject + 时间），文本插值自动转义无注入风险；`fmtTime` 经 `$host` 在 o-fill 内调用。

## 存储键（localStorage）

| 键 | 内容 |
| --- | --- |
| `cred-client-accounts` | 登录过的服务器数组 `[{ url, token }]`（最近使用在前，最多 10 条） |
