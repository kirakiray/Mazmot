# create_app（工具包）

生成一个新应用前必须先调用：创建 `<name>/client/` 载体目录并写入 `app.json`（经 `lib/builder.js` 的 `createAppDir`，同名视为覆盖重建）。

## 依赖注入（ctx）

`{ fs, rootHandle?, onAppCreated? }`——`fs` 是 `/nos/fs/main.js` 模块；`rootHandle` 存在时写本地目录渠道的 `client/`；成功后触发 `onAppCreated({ appName, displayName, icon })`（icon 缺省补 📦）让宿主登记应用并出预览卡片。

## 行为要点

- 应用名经 `sanitizeAppName` 规范化（大写/空格 → 小写短横线）；规范化后为空（如纯中文）返回 `创建失败：应用名不合法…` 可读文案，不抛错。
- 返回文案引导后续 `write_file`（路径相对 `client/`）。

## 内置测试

`self-test.js`（基座与虚拟空间见 [../../test-space/README.md](../../test-space/README.md)）：包结构、`client/app.json` 落盘内容、`onAppCreated` 回调（规范化 / icon 缺省）、非法名可读失败、同名覆盖重建。`test/create-app.sb.html` 跑同一 `runSelfTest()` 做回归。
