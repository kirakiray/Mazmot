// show-form 包的内置测试模组
// 约定：视觉工具包目录下的 self-test.js 用 lib/tools/visual-test-kit.js 的
// defineVisualSelfTest 声明用例，导出：
//   testPlan     —— 用例名清单（对话框运行前渲染「待测 list」）
//   runSelfTest(onCase) —— onCase 可选，每完成一条断言即回调（对话框测试
//                   iframe 用它实时逐条打勾），返回 { ok, cases }
// 两个消费方：
//   1. 宿主页工具详情对话框「内置测试」Tab（组件已预载，含组件渲染断言）
//   2. 本包 test/show-form.sb.html（无 Core / senti-ui 环境也可跑，组件未
//      预载时组件类用例自动记跳过）

import { defineVisualSelfTest } from "../visual-test-kit.js";

const MIN_SPEC = {
  title: "自测",
  fields: [{ key: "a", label: "A", type: "text" }],
};

// 用例名与 run() 里的 check() 一一对应，避免两处漂移
const N_STRUCT = "包结构完整（插件 / 视觉组件地址 / 视觉标签）";
const N_NO_CTX = "无 requestForm 环境返回可读提示";
const N_CLEAN = "参数清洗：非法字段剔除 / 类型归一";
const N_INVALID = "全部字段不合法时拒绝渲染";
const N_SUBMIT = '用户提交后返回 {"data":{...}}';
const N_CANCEL = '用户取消 / 停止返回 {"cancelled":true}';
const N_RENDER = "待填表单渲染控件并经 form-submit 冒泡数据";
const N_REQUIRED = "required 未填写时提交被拦截";
const N_READONLY = "历史提交只读回填（无控件、值正确、只读徽标）";
const N_XSS = "字段文本 HTML 转义（防注入）";

const testPlan = [
  N_STRUCT,
  N_NO_CTX,
  N_CLEAN,
  N_INVALID,
  N_SUBMIT,
  N_CANCEL,
  N_RENDER,
  N_REQUIRED,
  N_READONLY,
  N_XSS,
];

const showFormTest = defineVisualSelfTest({
  // 被测视觉组件 + 组件类用例依赖的 senti 控件
  tag: "show-form-card",
  requiredTags: ["st-input", "st-textarea", "st-select", "st-checkbox", "st-radio"],
  plan: testPlan.map((name) => ({ name })),

  async run(kit) {
    const { check, wait, componentReady, mount } = kit;

    // ---- 插件层（纯 JS，任何环境可跑） ----
    const plugin = (await import(new URL("./index.js", import.meta.url).href))
      .default;

    await check(
      N_STRUCT,
      plugin.name === "show_form" &&
        typeof plugin.exec === "function" &&
        plugin.tags?.includes("视觉") &&
        /form-card\.html$/.test(plugin.visual || ""),
      `visual=${plugin.visual}`,
    );

    const noCtx = await plugin.exec(MIN_SPEC, {});
    await check(N_NO_CTX, noCtx.includes("不支持"), noCtx);

    // 参数清洗：非法字段剔除、options 归一（剔除 null / 空值）、required 转 boolean
    let cleaned = null;
    await plugin.exec(
      {
        title: "T",
        description: "D",
        fields: [
          { key: "name", label: "姓名", type: "text", required: 1, placeholder: "p" },
          { key: "bad", label: "", type: "text" }, // label 空 → 剔除
          { key: "opt", label: "选项", type: "select", options: ["甲", 2, null] },
        ],
      },
      { requestForm: async (s) => ((cleaned = s), { data: {} }) },
    );
    const byKey = Object.fromEntries(
      (cleaned?.fields || []).map((f) => [f.key, f]),
    );
    await check(
      N_CLEAN,
      cleaned?.title === "T" &&
        cleaned.description === "D" &&
        cleaned.fields.length === 2 &&
        byKey.name?.required === true &&
        byKey.name?.placeholder === "p" &&
        byKey.opt?.options?.join(",") === "甲,2",
      JSON.stringify(cleaned),
    );

    const bad = await plugin.exec(
      { title: "t", fields: [{ key: "x" }] },
      { requestForm: async () => ({ data: {} }) },
    );
    await check(N_INVALID, bad.includes("不合法"), bad);

    const okRes = JSON.parse(
      await plugin.exec(MIN_SPEC, {
        requestForm: async () => ({ data: { a: "1" } }),
      }),
    );
    await check(
      N_SUBMIT,
      okRes.data?.a === "1" && okRes.cancelled === undefined,
      JSON.stringify(okRes),
    );

    const cancelRes = JSON.parse(
      await plugin.exec(MIN_SPEC, {
        requestForm: async () => ({
          cancelled: true,
          reason: "用户停止了生成",
        }),
      }),
    );
    await check(
      N_CANCEL,
      cancelRes.cancelled === true && cancelRes.reason === "用户停止了生成",
      JSON.stringify(cancelRes),
    );

    // ---- 组件层（视觉组件 + senti 控件就绪才跑，否则记一条跳过占位） ----
    if (!componentReady) {
      await check(
        N_RENDER,
        true,
        "跳过：宿主页面未预载视觉组件或 senti 表单控件（sb-test 纯模块环境）",
      );
      return;
    }

    // 待填渲染 + required 拦截 + 提交事件
    const card = await mount();
    card.applySpec({
          title: "自测表单",
          description: "",
          status: "pending",
          fields: [
            { key: "who", label: "姓名", type: "text", required: true },
            { key: "agree", label: "同意", type: "checkbox" },
          ],
          data: null,
        });
    await wait(100);
    const input = card.shadow.$('st-input[name="who"]')?.ele;
    const chk = card.shadow.$('st-checkbox[name="agree"]')?.ele;
    const submitBtn = card.shadow.$(".form-submit")?.ele;

    let fired = null;
    card.on("form-submit", (e) => (fired = e.data ?? null));
    submitBtn?.click(); // required 未填：应被拦截（toast 提示）
    await wait(300);
    const requiredBlocked = fired === null;

    // senti 控件：value 走 property，勾选态走 checked 属性
    if (input) input.value = "李四";
    if (chk) chk.setAttribute("checked", "");
    submitBtn?.click();
    await wait(150);
    await check(
      N_RENDER,
      !!input && !!chk && !!submitBtn && fired?.who === "李四" && fired?.agree === true,
      JSON.stringify(fired),
    );
    await check(N_REQUIRED, requiredBlocked);
    card.remove(); // 一项一项来：当前用例的卡片移除后再挂下一个
    await wait(250);

    // 只读回填（submitted 历史）：无任何可编辑控件
    const ro = await mount();
    ro.applySpec({
          title: "历史表单",
          description: "",
          status: "submitted",
          fields: [{ key: "who", label: "姓名", type: "text" }],
          data: { who: "张三" },
        });
    await wait(100);
    const noEditable = !ro.shadow.$("st-input,st-textarea,st-select,st-checkbox,st-radio,.form-submit");
    const reviewText = ro.shadow.$(".form-review-value")?.ele?.textContent;
    const badge = ro.shadow.$(".form-badge")?.ele?.textContent || "";
    await check(
      N_READONLY,
      noEditable && reviewText === "张三" && badge.includes("只读"),
      `value=${reviewText} badge=${badge}`,
    );
    ro.remove();
    await wait(250);

    // XSS 转义：label / placeholder 中的 HTML 不应被注入
    const xss = await mount();
    const payload = '<img src=x onerror="window.__xss=1">';
    xss.applySpec({
          title: payload,
          description: "",
          status: "pending",
          fields: [
            { key: "f", label: payload, type: "text", placeholder: payload },
          ],
          data: null,
        });
    await wait(100);
    await check(
      N_XSS,
      !xss.shadow.$("img") &&
        !window.__xss &&
        xss.shadow.$(".form-label")?.ele?.textContent?.includes("onerror"),
    );
  },
});

// 消费方约定导出（对话框 / sb.html 按具名引入）
export const runSelfTest = showFormTest.runSelfTest;
export { testPlan };

