---
name: get-aimap
description: 获取项目的所有文件 aimap 索引信息，帮助了解项目的整体结构。
method: main.js
---

# 获取项目 aimap 索引

**get-aimap** 用于在应用开发模式下获取项目的所有 aimap 索引信息。它会递归扫描项目目录，查找所有 `.aimap` 目录下的 `.md` 文件，并返回结构化的索引数据，帮助快速了解项目结构。

## 获取项目的所有 aimap 索引

<cap-request>
  <template name="get-aimap" cid="aim001" desc="获取项目的所有 aimap 索引信息" data-project-path="your-project-path">
  </template>
</cap-request>

工具将返回项目中所有文件的 aimap 索引信息，包括文件路径、aimap 文件路径和索引描述内容。
