// 工具插件包：show_form（视觉交互工具）
// 目录即独立包：index.js 是工具插件（默认导出），form-card.html 是配套的
// ofa.js 视觉组件模块（表单卡片），由宿主页面预载后以 <show-form-card> 渲染。
// 分工：工具负责参数清洗与「等待用户提交」的 Promise 生命周期；组件负责表单
// 渲染、输入收集与 required 校验，提交数据经 form-submit 事件冒泡给宿主页面，
// 页面再调 store.submitForm 落盘并把数据交回本工具。
// 依赖注入：ctx = { requestForm(spec) }（由 builder-store 提供）

// 配套视觉组件模块地址（宿主页面 load 后 <show-form-card> 自定义元素才可用）
export const visual = new URL("./form-card.html", import.meta.url).href;
// 内置测试模组地址（工具详情对话框「运行内置测试」按需加载并展示断言结果）
export const selfTest = new URL("./self-test.js", import.meta.url).href;

export default {
  key: "showForm",
  name: "show_form",
  tags: ["视觉"], // 面板列表标注：带视觉交互界面
  visual, // 配套视觉组件模块地址（宿主页面经 visualModules 预载）
  selfTest, // 内置测试模组地址（视觉工具详情对话框的「运行内置测试」）
  description: [
    "向用户展示一张可交互的表单卡片，用户在界面上填写并点击「提交」后，你会收到用户交互产生的数据：",
    'JSON 对象 {"data": {<字段key>: <用户输入值>}}；用户取消/中断时返回 {"cancelled": true}。',
    "适用场景：需要用户补充结构化信息（选择选项、确认参数、收集多项内容），而不是让用户用自然语言回复。",
    "fields 每项规范：{ key, label, type, options?, placeholder?, required? }：",
    "- type=text：单行文本；type=textarea：多行文本；type=number：数字（均可带 placeholder）",
    "- type=select：下拉选择；type=radio：单选——两者必须提供 options（字符串数组）",
    "- type=checkbox：布尔勾选（提交 true/false，label 里说明勾选含义）",
    "- key：全表单唯一的英文标识；label：展示给用户的中文标签；required：是否必填",
    "注意：表单会挂起本轮对话直到用户提交（或用户点停止），一轮只展示一张表单；",
    "普通问答不要用表单。用户提交后数据即为最终结论，不要要求用户重复填写。",
  ].join(""),
  schema: {
    title: { type: "string", description: "表单标题（中文短语）" },
    description: {
      type: "string",
      description: "给用户的填写说明，一两句话",
      optional: true,
    },
    fields: {
      type: "array",
      description: "表单字段清单，2~8 个为宜",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "字段英文标识，表单内唯一" },
          label: { type: "string", description: "展示给用户的标签" },
          type: {
            type: "string",
            description: "text / textarea / number / select / radio / checkbox",
          },
          options: {
            type: "array",
            description: "select / radio 的选项（字符串数组）",
            optional: true,
          },
          placeholder: { type: "string", description: "输入提示", optional: true },
          required: { type: "boolean", description: "是否必填", optional: true },
        },
        required: ["key", "label", "type"],
      },
    },
  },
  async exec(args, ctx) {
    if (!ctx.requestForm) return "当前环境不支持表单交互";
    const fields = (Array.isArray(args.fields) ? args.fields : [])
      .filter((f) => f && f.key && f.label && f.type)
      .map((f) => {
        // options 归一：剔除 null / 空值后转字符串，空数组整个剥掉
        const options = Array.isArray(f.options)
          ? f.options
              .filter((o) => o !== null && o !== undefined && o !== "")
              .map(String)
          : [];
        return {
          key: String(f.key),
          label: String(f.label),
          type: String(f.type),
          ...(options.length ? { options } : {}),
          ...(f.placeholder ? { placeholder: String(f.placeholder) } : {}),
          required: !!f.required,
        };
      });
    if (!fields.length) return "表单字段不合法：至少需要一个 key/label/type 齐全的字段";
    const res = await ctx.requestForm({
      title: String(args.title || "请填写表单"),
      description: String(args.description || ""),
      fields,
    });
    return res.cancelled
      ? JSON.stringify({ cancelled: true, reason: res.reason || "" })
      : JSON.stringify({ data: res.data });
  },
};
