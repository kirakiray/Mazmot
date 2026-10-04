# 003 · `action=app` 推送刷新后紧接着 `action=eval` 会超时，重试一次即可

**症状**：`preview action=app`（推送并自动刷新）返回「预览就绪」之后立刻发 `action=eval`，会报 `调试指令 eval 等待结果超时（30000ms）`；同一段代码原样重发一次就正常返回结果，看起来像「代码写错了 / 页面崩了」，容易误判成刚改的代码有问题。

**根因**：`action=app` 的返回只代表文件已推送、预览窗口开始重新加载，页面模块（`pages/home.html`）此时还在重新执行——注入的调试代理（`[bridge-link]` 通道）尚未重新连上，指令发出去没人接，于是等满 30s 超时。检测到超时的那一刻页面其实往往已经就绪。

**正确姿势**：
- `action=app` 之后**不要马上 eval**：先重发同一条 `action=eval`（第二次通常 0–2ms 返回），或先 `action=wait`（`selector` 等页面内元素出现、`code` 等 `window.__helloReady === true`）再诊断。
- 判断是否真的出错看**两次都超时**才可疑；单次超时先重试，再去看 `action=console`。
