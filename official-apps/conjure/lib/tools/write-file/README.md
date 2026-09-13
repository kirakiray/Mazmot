# write_file（工具包）

把一个 UTF-8 文本文件写入指定应用的 `client/` 目录（经 `lib/builder.js` 的 `writeAppFile`，路径经 `validateRelPath` 守卫，可覆盖重写迭代）。

## 依赖注入（ctx）

`{ fs, rootHandle?, onAppCreated?, onFileWrite? }`——每次写入成功触发 `onFileWrite({ appName, path, bytes })`；目标应用缺 `app.json` 时自动补建（视同创建），触发 `onAppCreated` 恰好一次。

## 行为要点

- 字节数按 UTF-8 计（`Blob([text]).size`），非字符串长度。
- 路径逃逸（`../`）、绝对路径、二进制扩展名（`.png` 等）返回 `写入失败：…` 可读文案，不抛错。
- `rootHandle` 存在时写本地目录渠道的 `client/`。

## 内置测试

`self-test.js`（基座与虚拟空间见 [../../test-space/README.md](../../test-space/README.md)）：包结构、写入与 UTF-8 字节数、`onFileWrite` 回调、跳过 `create_app` 的自动初始化（恰一次）、非法路径拦截、覆盖重写。`test/write-file.sb.html` 跑同一 `runSelfTest()` 做回归。
