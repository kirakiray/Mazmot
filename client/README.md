# client/ — Mazmot 桌面运行时

这里放两个**能力对等**的桌面壳，目标相同：把 Mazmot 静态站点封装成原生多窗口应用运行时，站点代码零补丁。

| 目录 | 技术 | 说明 |
| ---- | ---- | ---- |
| [`projectR/`](projectR/README.md) | Tauri 2（系统 WebView + Rust `tiny_http`） | 体积小，复用系统 WebView；规范见 [`projectR/AGENTS.md`](projectR/AGENTS.md)，架构见 [`projectR/CONTEXT.md`](projectR/CONTEXT.md) |
| [`projectE/`](projectE/README.md) | Electron（内置 Chromium + Node `http`） | 渲染一致性好，自带 Chromium；规范见 [`projectE/AGENTS.md`](projectE/AGENTS.md)，架构见 [`projectE/CONTEXT.md`](projectE/CONTEXT.md) |

两者共享的硬约束：

- **端口即 origin**：主站 `30031`（被占用时回退 `30033-30036`），conjure 隔离域固定 `30032`；改动端口候选必须两边同步。
- **站点零补丁**：适配只发生在各自的 shim / 主进程，禁止 fork 站点源码。
- **不指向自定义协议 / `file://`**：NoneOS Core 依赖 Service Worker，必须通过内置回环 HTTP 服务器提供真实 `http://localhost` 源。

改哪个壳，就先读它自己的 `AGENTS.md` 和 `CONTEXT.md`；仓库根的 [`AGENTS.md`](../AGENTS.md)「client/（桌面运行时：projectR / projectE）」一节提供全局摘要。
