# list_files（工具包）

列出应用项目内已写入的全部文件（经 `lib/builder.js` 的 `listAppFiles`，优先 `flat()` 全量列举、旧环境回退 `keys()` 递归，输出相对 `client/` 的路径并排序）。

## 依赖注入（ctx）

`{ fs, rootHandle? }`——`rootHandle` 存在时列举本地目录渠道的 `client/`。

## 行为要点

- 空应用（无文件 / 应用不存在）返回 `（应用还没有文件）` 占位提示，不抛错。

## 内置测试

`self-test.js`（基座与虚拟空间见 [../../test-space/README.md](../../test-space/README.md)）：包结构、多文件换行列举（含深度路径）、空应用与应用不存在的占位提示、本地渠道列举。`test/list-files.sb.html` 跑同一 `runSelfTest()` 做回归。
