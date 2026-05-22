---
name: fs
description: 文件系统操作能力，支持文件的写入、读取和删除操作
method: main.js
test: test/fs-demo.html
---

# 文件系统操作

**fs** 提供文件系统操作能力，支持在指定路径进行文件的写入、读取和删除操作。

## 重要说明

- 所有操作都需要指定 `data-path` 参数，表示文件路径
- 文件路径相对于项目根目录，例如：`mazmot/test/test1.txt`
- 写入操作会自动创建不存在的文件和目录

## 基本用法

### 写入文件

使用 `data-mode="write"` 写入文件内容，内容放在 template 标签内部：

<cap-request>
  <template
    name="fs"
    cid="fs-write-01"
    desc="写入文件"
    data-mode="write"
    data-path="mazmot/test/test1.txt"
  >
hello world
  </template>
</cap-request>

**返回值**：写入成功返回 `true`

### 读取文件

使用 `data-mode="read"` 读取文件内容：

<cap-request>
  <template
    name="fs"
    cid="fs-read-01"
    desc="读取文件"
    data-mode="read"
    data-path="mazmot/test/test1.txt"
  >
  </template>
</cap-request>

**返回值**：返回文件的文本内容

### 删除文件

使用 `data-mode="delete"` 删除文件：

<cap-request>
  <template
    name="fs"
    cid="fs-delete-01"
    desc="删除文件"
    data-mode="delete"
    data-path="mazmot/test/test1.txt"
  >
  </template>
</cap-request>

**返回值**：删除成功返回 `true`

## 参数说明

### 必需参数

- `data-mode`：操作模式
  - `"write"` - 写入文件
  - `"read"` - 读取文件
  - `"delete"` - 删除文件
- `data-path`：文件路径（相对于项目根目录）

### 内容参数

- 标签内部内容（`content`）：写入模式下，要写入的文件内容

## 完整测试示例

查看 [test/fs-demo.html](test/fs-demo.html) 了解完整的测试用例，包括：

- 写入文件并验证
- 读取文件内容
- 删除文件
- 验证文件已被删除
