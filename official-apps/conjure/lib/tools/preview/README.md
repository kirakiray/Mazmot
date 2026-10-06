# preview（工具包 · 隔离预览统一工具）

一个工具 + `action` 参数分发全部预览操作：把生成的应用推送到隔离预览窗口实际运行（`app`），列出当前打开的预览窗口（`windows`），并对运行中的页面做黑盒调试（`status / console / dom / text / click / type / wait / eval / screenshot`）。调试指令在预览页的常驻代理内执行（`/bridge/debug-runtime.js`），主域不执行任何 AI 代码。（预览气泡的窗口方块缩略图走 `wire` 线框指令本地重绘，不在本工具的 action 集内。）

支持**多窗口**（上限 10，本机 popup 与手机扫码设备平等，见 `/bridge` 多窗口协议与 `lib/remote-preview.js`）：顶层可选 `winId`（`action=windows` 清单里的 id，即 `userId|sessionId`）定向调试某个窗口；**省略 `winId` 时指令投递给最近心跳的在线窗口**；窗口注册表为空时回退存储的 bridge userId 广播（兼容旧窗口）。

## 依赖注入（ctx）

`{ openPreview(appName), previewDebug(cmd, args, timeoutMs, winId), listPreviewWindows(), onPreviewShot(dataUrl, meta) }`——均由 builder-store 提供（底层为 `lib/remote-preview.js` 的 `runRemotePreview` / `debugPreviewCommand` / `listPreviewWindows`）；缺失时返回可读的不可用提示。

## 行为要点

- `action=app` 走推送主流程（返回即预览页已在跑最新代码、调试代理可响应；多个在线窗口时全部同步）；`action=windows` 列窗口注册表（id / 应用 / 设备 / 在线 / 心跳），多窗口调试前先调用；其余 action 走 dbg 指令通道（按 `winId` 定向），`screenshot` 映射指令 `shot`。
- exec 内做各 action 必填参数校验与结果超时表（screenshot 90s / wait 按其 `timeoutMs` +15s 上限 60s / console·eval 30s / 其余默认 25s）。
- 截图经 `onPreviewShot` 以 `role:"image"` 卡片展示给用户；模型无法看图，返回文案引导布局核验用 `action=dom`。
- 排查用户反馈先 `status` 确认在线再取证，不要急着重推（刷新会清空控制台缓冲，丢失报错现场）——见 builder.js 系统提示词的工作流约束。

## 内置测试

`self-test.js`（基座用法见 [../../test-space/README.md](../../test-space/README.md)，预览通道全程 fake 替身）：包结构、未知 action、必填参数校验、`action=app` 流程与不可用提示、`action=windows` 清单排版与空态、`winId` 定向透传、指令分发与 args 透传、结果排版（meta.ms 前缀）、超时表、截图卡片流（含无图兜底）、错误包装。`test/preview.sb.html` 跑同一 `runSelfTest()` 做回归。
