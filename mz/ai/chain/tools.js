/**
 * 工具定义（对齐 LangChain 的 tool()）。
 * 浏览器环境没有 zod，schema 用简写对象，内部转成 JSON Schema 给供应商 API：
 *   { 参数名: { type: "string" | "number" | "boolean" | "array" | "object",
 *              description: "...", optional: true } }
 */

export const tool = (fn, { name, description = "", schema = {} }) => {
  if (!name) throw new Error("tool requires a name");
  if (typeof fn !== "function") throw new Error("tool requires a function");

  return {
    name,
    description,
    schema,

    /**
     * 执行工具：rawArgs 是模型给出的 JSON 字符串。
     * 任何失败（JSON 非法 / 校验不过 / 执行抛错）都以可读文本返回给模型，
     * 让模型自行纠正，而不是让整个 Agent 循环崩溃。
     */
    async invoke(rawArgs) {
      let args = {};
      if (rawArgs != null && rawArgs !== "") {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          return `工具参数不是合法 JSON：${rawArgs}`;
        }
      }

      const invalid = _validate(schema, args);
      if (invalid) return invalid;

      try {
        const output = await fn(args);
        return output == null ? "" : String(output);
      } catch (e) {
        return `工具执行出错：${e?.message ?? e}`;
      }
    },

    /** 转 OpenAI wire 格式 */
    toWire() {
      return {
        type: "function",
        function: { name, description, parameters: _toParameters(schema) },
      };
    },
  };
};

export const toolsToWire = (tools) => (tools ?? []).map((t) => t.toWire());

export const findTool = (tools, name) =>
  (tools ?? []).find((t) => t.name === name) ?? null;

const _toParameters = (schema) => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(schema).map(([key, def]) => {
      const { optional, ...rest } = def;
      return [key, rest];
    })
  ),
  required: Object.entries(schema)
    .filter(([, def]) => !def.optional)
    .map(([key]) => key),
});

const _validate = (schema, args) => {
  for (const [key, def] of Object.entries(schema)) {
    const value = args?.[key];
    if (value === undefined || value === null) {
      if (!def.optional) return `缺少必填参数：${key}`;
      continue;
    }
    const type = def.type ?? "string";
    const typeOk =
      (type === "string" && typeof value === "string") ||
      (type === "number" && typeof value === "number") ||
      (type === "boolean" && typeof value === "boolean") ||
      (type === "array" && Array.isArray(value)) ||
      (type === "object" && typeof value === "object" && !Array.isArray(value));
    if (!typeOk) {
      return `参数 ${key} 需要 ${type} 类型，实际是 ${
        Array.isArray(value) ? "array" : typeof value
      }`;
    }
  }
  return null;
};
