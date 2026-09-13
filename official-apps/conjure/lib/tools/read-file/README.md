# read_file（工具包）

读取应用项目内已有文件的内容（迭代修改前查看），经 `lib/builder.js` 的 `readAppFile`。

## 依赖注入（ctx）

`{ fs, rootHandle? }`——`rootHandle` 存在时读本地目录渠道的 `client/`。

## 行为要点

- 文件不存在（含应用整个不存在）返回 `文件不存在：<path>` 可读提示；底层读失败同样归一为不存在，不向上抛错。

## 内置测试

`self-test.js`（基座与虚拟空间见 [../../test-space/README.md](../../test-space/README.md)）：包结构、内容原样读回、文件 / 应用不存在的提示、本地渠道读取。`test/read-file.sb.html` 跑同一 `runSelfTest()` 做回归。
