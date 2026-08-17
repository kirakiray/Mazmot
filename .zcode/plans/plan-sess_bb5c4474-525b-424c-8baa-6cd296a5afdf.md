将 `~/.trae-cn/skills/` 的 skills 拷贝到 `~/.agents/skills/`（供 ZCode 全局发现）。

**现状（已勘察）**：
- 源目录 `~/.trae-cn/skills/` 含 7 个 skill：`ever-cache`、`mazmot-api`、`noneos-core-docs`、`obook-doc-generator`、`ofajs-docs`、`punch-ui`、`sibyl-test`，另有 `_update.js` 脚本和 `.DS_Store` 垃圾文件
- 目标 `~/.agents/` 目录不存在，无冲突风险

**执行步骤**：
1. `mkdir -p ~/.agents/skills/` 创建目标目录
2. `rsync -a --exclude '.DS_Store' ~/.trae-cn/skills/ ~/.agents/skills/` 完整拷贝（保留 7 个 skill 目录 + `_update.js`，排除 macOS 垃圾文件）
3. 验证：列出目标目录内容，确认每个 skill 子目录的 `SKILL.md` 都存在，对比源/目标文件数一致

**说明**：拷贝完成后新技能需在新的 ZCode 会话中才会被发现；后续 Trae CN 侧若更新这些 skill，两边不会自动同步（是拷贝不是软链接）。