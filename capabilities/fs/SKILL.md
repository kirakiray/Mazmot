---
name: fs
description: 文件系统操作能力，支持文件的写入、读取、删除、移动、复制以及目录操作
method: main.js
test: test/fs-demo.html
---

# 文件系统操作

**fs** 提供完整的文件系统操作能力，支持文件和目录的创建、读取、写入、删除、移动、复制等操作。

## 重要说明

- 所有操作都需要指定 `data-path` 参数，表示文件或目录路径
- 文件路径相对于项目根目录，例如：`mazmot/test/test1.txt`
- 写入和创建目录操作会自动创建不存在的父目录

## 文件操作

### 写入文件

使用 `data-mode="write"` 写入文件内容。所有写入内容都需要使用 `<script type="text/plain">` 标签包裹，以确保内容被正确传递：

<cap-request>
  <template
    name="fs"
    cid="fs-write"
    desc="写入文件"
    data-mode="write"
    data-path="mazmot/test/test1.txt"
  >
    <script type="text/plain">
hello world
    </script>
  </template>
</cap-request>

**返回值**：写入成功返回 `true`

**说明**：
- 使用 `<script type="text/plain">` 标签包裹所有写入内容
- 内容会被原样保留，不会被浏览器解析
- 适用于写入任何类型的文件内容（纯文本、HTML、JSON、代码等）

### 读取文件

使用 `data-mode="read"` 读取文件内容：

<cap-request>
  <template
    name="fs"
    cid="fs-read"
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
    cid="fs-delete"
    desc="删除文件"
    data-mode="delete"
    data-path="mazmot/test/test1.txt"
  >
  </template>
</cap-request>

**返回值**：删除成功返回 `true`

### 检查文件是否存在

使用 `data-mode="exists"` 检查文件或目录是否存在：

<cap-request>
  <template
    name="fs"
    cid="fs-exists"
    desc="检查文件是否存在"
    data-mode="exists"
    data-path="mazmot/test/test1.txt"
  >
  </template>
</cap-request>

**返回值**：存在返回 `true`，不存在返回 `false`

### 获取文件信息

使用 `data-mode="info"` 获取文件或目录的详细信息：

<cap-request>
  <template
    name="fs"
    cid="fs-info"
    desc="获取文件信息"
    data-mode="info"
    data-path="mazmot/test/test1.txt"
  >
  </template>
</cap-request>

**返回值**：
```json
{
  "kind": "file",
  "name": "test1.txt",
  "path": "mazmot/test/test1.txt",
  "size": 11,
  "lastModified": 1234567890
}
```

### 移动文件

使用 `data-mode="move"` 移动文件或目录：

<cap-request>
  <template
    name="fs"
    cid="fs-move"
    desc="移动文件"
    data-mode="move"
    data-path="mazmot/test/test1.txt"
    data-target-path="mazmot/backup"
    data-target-name="test1_backup.txt"
  >
  </template>
</cap-request>

**参数**：
- `data-target-path`：目标目录路径（必需）
- `data-target-name`：新文件名（可选，不指定则保持原名）

**返回值**：
```json
{
  "kind": "file",
  "name": "test1_backup.txt",
  "path": "mazmot/backup/test1_backup.txt"
}
```

### 复制文件

使用 `data-mode="copy"` 复制文件或目录：

<cap-request>
  <template
    name="fs"
    cid="fs-copy"
    desc="复制文件"
    data-mode="copy"
    data-path="mazmot/test/test1.txt"
    data-target-path="mazmot/backup"
    data-target-name="test1_copy.txt"
  >
  </template>
</cap-request>

**参数**：
- `data-target-path`：目标目录路径（必需）
- `data-target-name`：新文件名（可选，不指定则保持原名）

**返回值**：
```json
{
  "kind": "file",
  "name": "test1_copy.txt",
  "path": "mazmot/backup/test1_copy.txt"
}
```

## 目录操作

### 创建目录

使用 `data-mode="mkdir"` 创建目录：

<cap-request>
  <template
    name="fs"
    cid="fs-mkdir"
    desc="创建目录"
    data-mode="mkdir"
    data-path="mazmot/newdir"
  >
  </template>
</cap-request>

**返回值**：创建成功返回 `true`

### 列出目录内容

使用 `data-mode="list"` 列出目录中的所有文件和子目录：

<cap-request>
  <template
    name="fs"
    cid="fs-list"
    desc="列出目录内容"
    data-mode="list"
    data-path="mazmot/test"
  >
  </template>
</cap-request>

**返回值**：
```json
[
  {
    "name": "test1.txt",
    "kind": "file",
    "path": "mazmot/test/test1.txt"
  },
  {
    "name": "subdir",
    "kind": "dir",
    "path": "mazmot/test/subdir"
  }
]
```

## 参数说明

### 必需参数

- `data-mode`：操作模式
  - `"write"` - 写入文件
  - `"read"` - 读取文件
  - `"delete"` - 删除文件或目录
  - `"exists"` - 检查是否存在
  - `"info"` - 获取信息
  - `"list"` - 列出目录内容
  - `"mkdir"` - 创建目录
  - `"move"` - 移动文件或目录
  - `"copy"` - 复制文件或目录
- `data-path`：文件或目录路径（相对于项目根目录）

### 可选参数

- `data-target-path`：目标路径（用于 move 和 copy 操作）
- `data-target-name`：目标名称（用于 move 和 copy 操作）
- 标签内部内容（`content`）：写入模式下，要写入的文件内容