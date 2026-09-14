# preview（工具包 · 隔离预览统一工具）

一个工具 + `action` 参数分发全部预览操作：把生成的应用推送到隔离预览窗口实际运行（`app`），并对运行中的页面做黑盒调试（`status / console / dom / text / click / type / wait / eval / screenshot`）。调试指令在预览页的常驻代理内执行（`/bridge/debug-runtime.js`），主域不执行任何 AI 代码。

## 依赖注入（ctx）

`{ openPreview(appName), previewDebug(cmd, args, timeoutMs), onPreviewShot(dataUrl, meta) }`——均由 builder-store 提供（底层为 `lib/remote-preview.js` 的 `runRemotePreview` / `debugPreviewCommand`）；缺失时返回可读的不可用提示。

## 行为要点

- `action=app` 走推送主流程（返回即预览页已在跑最新代码、调试代理可响应）；其余 action 走 dbg 指令通道，`screenshot` 映射指令 `shot`。
- exec 内做各 action 必填参数校验与结果超时表（screenshot 90s / wait 按其 `timeoutMs` +15s 上限 60s / console·eval 30s / 其余默认 25s）。
- 截图经 `onPreviewShot` 以 `role:"image"` 卡片展示给用户；模型无法看图，返回文案引导布局核验用 `action=dom`。
- 排查用户反馈先 `status` 确认在线再取证，不要急着重推（刷新会清空控制台缓冲，丢失报错现场）——见 builder.js 系统提示词的工作流约束。

## 内置测试

`self-test.js`（基座用法见 [../../test-space/README.md](../../test-space/README.md)，预览通道全程 fake 替身）：包结构、未知 action、必填参数校验、`action=app` 流程与不可用提示、指令分发与 args 透传、结果排版（meta.ms 前缀）、超时表、截图卡片流（含无图兜底）、错误包装。`test/preview.sb.html` 跑同一 `runSelfTest()` 做回归。
