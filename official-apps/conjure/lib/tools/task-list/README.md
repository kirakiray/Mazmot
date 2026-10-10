# task_list（会话任务清单）

开发前拆解任务、随做随勾的清单工具（业界 coding agent 的 todo/plan 模式）。清单显示在对话右侧面板，用户实时看到进度；按会话持久化（`tasks:<app>:<sid>`），暂停 / 刷新后继续开发时原样恢复并随系统提示词喂回模型。

## 契约

- `exec({ tasks }, ctx)` → `ctx.setSessionTasks(tasks)` 的返回文本（仓库层规整 / 持久化 / 广播）。
- **全量提交（TodoWrite 语义）**：`tasks: [{ text, status }]`，每次调用整体替换清单；status ∈ `pending / in_progress / done`，非法回落 pending；条数上限 24、单条文本截 120 字（`builder.js` 的 `normalizeTaskList`）。
- 运行错误任务（`source: "error"`，带 `errKey`）由宿主自动管理：`autoCheckPreview` 每回合收尾检测预览控制台，新错误自动追加任务、消失的错误自动勾完成（`builder.js` 的 `mergeErrorTasks` 纯函数）；模型重写清单时在案错误会自动补回。

## 状态与持久化（builder-store）

- `state.sessionTasks`：当前会话清单的响应式镜像（右侧面板渲染源）。
- 存储键 `tasks:<appName>:<sid>`；会话切换加载（带视图竞态守卫）、fork 复制、新会话清空、草稿态不可用。

## 测试

- `self-test.js`：插件层（结构 / 不可用提示 / 参数与返回值透传），工具详情对话框「运行内置测试」可跑。
- `test/task-list.sb.html`：sibyl-test 版同范围用例（fake ctx 直驱 exec）。
- 纯函数（`normalizeTaskList` / `mergeErrorTasks`）用例在仓库 `test/builder.sb.html`。
