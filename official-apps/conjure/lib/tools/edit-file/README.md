# edit_file 工具包

对已有文件做**差量编辑**：`edits` 数组逐条应用（`old_string → new_string` 字面量替换），是修改已有应用的首选工具——省 token、不碰未提及的内容、防回归。新建文件与整体重写仍用 `write_file`。

## 语义（与 Claude Code / harness 的 edit 工具对齐）

- `old_string` 必须与文件原文**逐字一致**（含空格缩进换行），且在文件中**唯一命中**：
  - 找不到 → 报错引导先 `read_file` 读当前内容；
  - 命中多处 → 报错提示扩大上下文使其唯一，或对该条设 `replace_all: true`。
- 多条 `edits` **依序应用**：前一条的替换结果参与后一条的匹配（链式改写时可直接引用中间态）。
- 文件不存在 → 报错引导 `write_file`（差量编辑只针对已有文件）。

## 参数

| 字段 | 说明 |
| --- | --- |
| `appName` | create_app 时确定的应用名 |
| `path` | 相对 client/ 的已有文件路径 |
| `edits` | `[{ old_string, new_string, replace_all? }]`，至少一条 |

## 回报

成功时返回应用的修改处数与当前文件内容摘要（首 200 + 尾 160 字符），模型可自查替换结果。

## 回调

成功后触发 `ctx.onFileWrite({ appName, path, bytes, op: "edit", applied, prevText, nextText })`——`prevText` / `nextText` 供宿主变更卡计算行级 diff（见 `lib/diff.js`）。

## 底层

`lib/builder.js` 的 `editAppFile`（本地目录渠道同样支持：`ctx.rootHandle`）。
