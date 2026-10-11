// task_list 包的内置测试模组（纯插件层：ctx.setSessionTasks 用 fake 替身）
// 基座用法见 lib/test-space/README.md

import { defineSelfTest } from "../../test-space/self-test-kit.js";

const N_SHAPE = "包结构完整（key / name / description / schema / exec / selfTest）";
const N_UNAVAILABLE = "宿主未注入 setSessionTasks 时返回可读提示";
const N_DELEGATE = "tasks 原样透传给 setSessionTasks，返回值透传";
const N_SUMMARY = "仓库层的更新结果文本（进度摘要）原样透传";

const testPlan = [N_SHAPE, N_UNAVAILABLE, N_DELEGATE, N_SUMMARY];

const taskListTest = defineSelfTest({
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check } = kit;
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_SHAPE,
      plugin.key === "taskList" &&
        plugin.name === "task_list" &&
        !!plugin.description &&
        !!plugin.schema?.tasks &&
        typeof plugin.exec === "function" &&
        /self-test\.js$/.test(plugin.selfTest || ""),
      `selfTest=${plugin.selfTest}`,
    );

    const unavailable = await plugin.exec({ tasks: [] }, {});
    await check(
      N_UNAVAILABLE,
      unavailable.includes("任务清单不可用"),
      unavailable,
    );

    // 参数透传：exec 只解构 tasks，数组原样交给仓库层
    let received = null;
    const list = [
      { text: "拆页面结构", status: "done" },
      { text: "写交互逻辑", status: "in_progress" },
    ];
    const res = await plugin.exec(
      { tasks: list },
      {
        setSessionTasks: (tasks) => {
          received = tasks;
          return "任务清单已更新（1/2 完成）";
        },
      },
    );
    await check(
      N_DELEGATE,
      received === list && Array.isArray(received) && received.length === 2,
      `received=${JSON.stringify(received)}`,
    );
    await check(
      N_SUMMARY,
      res === "任务清单已更新（1/2 完成）",
      res,
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = taskListTest.runSelfTest;
export { testPlan };
