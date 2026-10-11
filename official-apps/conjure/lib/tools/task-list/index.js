// 工具插件包：task_list（会话任务清单）
// 开发前拆解任务、随做随勾（业界 coding agent 的 todo/plan 模式）：
// 清单显示在对话右侧面板，用户实时看到进度；按会话持久化，暂停 /
// 刷新后继续开发时清单原样恢复（每回合由系统提示词喂回模型）。
// 全量提交（TodoWrite 语义）：每次调用传完整清单，宿主整体替换。
// 预览自动检测的运行错误由宿主自动登记 / 勾完成，模型无需手动管理。
//
// 依赖注入：ctx = { setSessionTasks(tasks) }（builder-store 提供，规整 /
// 校验 / 持久化 / 状态广播都在仓库层，插件只做透传与不可用提示）

// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载执行）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "taskList",
  name: "task_list",
  selfTest,
  description: `维护当前会话的任务清单（对话右侧面板实时展示）：开发动手前把需求拆解成有序任务（每条一个可独立验证的具体单元，3~8 条为宜），之后随做随更——开始一条前置 in_progress（同时只允许一条），完成并实测验证后置 done，收尾时全部 done。全量提交：每次调用传完整清单（整体替换，不是增量）。用户新需求与现有清单明显不同时先重写清单再开发；单点小改不必拆解。`,
  schema: {
    tasks: {
      type: "array",
      description:
        "完整任务清单（整体替换）：[{ text: 任务描述（≤120 字）, status: pending | in_progress | done }]，按执行顺序排列；已完成项也必须包含在数组里（status=done）",
    },
  },
  async exec({ tasks }, ctx) {
    if (typeof ctx.setSessionTasks !== "function") {
      return "任务清单不可用：宿主未注入任务通道（请从妙造主界面使用）";
    }
    return ctx.setSessionTasks(tasks);
  },
};
