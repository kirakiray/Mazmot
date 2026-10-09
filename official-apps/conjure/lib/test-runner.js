// 场景测试执行器（宿主侧）：解析 client/test/*.test.json 用例，经预览调试
// 通道逐条驱动应用页执行步骤并断言。步骤一律映射到已有的 dbg 指令
// （click / type / text / eval / status / console），全部穿 shadow DOM；
// reload 与 consoleErrors 两个步骤由宿主特殊处理（页面重载会打断 dbg 链路，
// 控制台错误计数从 status.meta.errors 差值取得）。
//
// 用例格式：
// {
//   "name": "任务拖拽排序",          // 必填，展示用
//   "desc": "可选说明",
//   "steps": [
//     { "click": ".task-add" },
//     { "type": { "selector": ".task-input", "value": "学英语" } },
//     { "press": "Enter" },                      // 对当前焦点元素派发按键
//     { "wait": 300 },                           // ≤5000ms
//     { "eval": "表达式或语句" },                  // 抛错或结果 === false 即失败
//     { "expect": { "text": ".item", "contains": "x" } },
//     { "expect": { "text": ".title", "equals": "x" } },
//     { "expect": { "count": ".item", "equals": 3 } },
//     { "expect": { "consoleErrors": 0 } },       // 本用例期间新增的控制台错误数
//     { "reload": true }                          // 重载应用页并等调试代理回线
//   ]
// }

import { readAppFile, listAppFiles } from "./builder.js";

export const TEST_DIR = "test";

/** 列出当前应用的测试用例清单（client/test/*.test.json，解析后的 {file,name,desc,stepCount}） */
export async function listTestCases(fs, appName, rootHandle) {
  const files = (await listAppFiles(fs, appName, rootHandle)).filter(
    (p) => p.startsWith(`${TEST_DIR}/`) && p.endsWith(".test.json"),
  );
  const out = [];
  for (const file of files) {
    try {
      const raw = await readAppFile(fs, appName, file, rootHandle);
      const parsed = parseTestFile(raw, file);
      out.push({
        file,
        name: parsed.name,
        desc: parsed.desc || "",
        stepCount: parsed.steps.length,
      });
    } catch (err) {
      out.push({ file, name: file, desc: `用例解析失败：${err.message}`, stepCount: 0, broken: true });
    }
  }
  return out;
}

/** 解析并校验单个用例文件（返回 {name, desc, steps}；格式问题抛可读错误） */
export function parseTestFile(raw, file) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("不是合法 JSON");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.steps)) {
    throw new Error("缺少 steps 数组");
  }
  const err = validateSteps(data.steps);
  if (err) throw new Error(err);
  return {
    name: String(data.name || file.replace(/^test\//, "").replace(/\.test\.json$/, "")),
    desc: String(data.desc || ""),
    steps: data.steps,
  };
}

/** 步骤合法性校验（返回错误文案或 null） */
export function validateSteps(steps) {
  for (const [i, s] of steps.entries()) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return `步骤 ${i + 1} 不是对象`;
    const keys = Object.keys(s);
    if (keys.length !== 1) return `步骤 ${i + 1} 应恰好有一个动作键（如 {"click": "..."}）`;
    const [k] = keys;
    if (k === "click" && !s.click) return `步骤 ${i + 1}：click 需要选择器`;
    if (k === "type") {
      if (!s.type?.selector) return `步骤 ${i + 1}：type 需要 { selector, value }`;
      if (typeof s.type.value !== "string") return `步骤 ${i + 1}：type.value 必须是字符串`;
    }
    if (k === "press" && !s.press) return `步骤 ${i + 1}：press 需要键名（如 "Enter"）`;
    if (k === "wait") {
      const asNumber = typeof s.wait !== "object" && Number(s.wait) >= 0;
      const asObject =
        s.wait && typeof s.wait === "object" && (s.wait.selector || s.wait.code);
      if (!asNumber && !asObject) {
        return `步骤 ${i + 1}：wait 需要毫秒数或 { selector | code, timeoutMs? }`;
      }
    }
    if (k === "eval" && !s.eval) return `步骤 ${i + 1}：eval 需要代码`;
    if (k === "reload" && s.reload !== true) return `步骤 ${i + 1}：reload 取值应为 true`;
    if (k === "expect") {
      const e = s.expect || {};
      if (e.consoleErrors != null) {
        if (!Number.isInteger(e.consoleErrors)) return `步骤 ${i + 1}：expect.consoleErrors 需要整数`;
      } else if (e.text) {
        if (!e.contains && !e.equals) return `步骤 ${i + 1}：expect.text 需要 contains 或 equals`;
      } else if (e.count) {
        if (!Number.isInteger(e.equals)) return `步骤 ${i + 1}：expect.count 需要 equals 数量`;
      } else {
        return `步骤 ${i + 1}：expect 支持 {text|count|consoleErrors}`;
      }
    }
    if (!["click", "type", "press", "wait", "eval", "reload", "expect"].includes(k)) {
      return `步骤 ${i + 1}：未知动作 "${k}"（支持 click/type/press/wait/eval/reload/expect）`;
    }
  }
  return null;
}

/** 步骤一句话描述（报告用） */
export function describeStep(s) {
  const [k, v] = Object.entries(s)[0];
  if (k === "click") return `click ${v}`;
  if (k === "type") return `type ${v.selector} ⋐ ${String(v.value).slice(0, 20)}`;
  if (k === "press") return `press ${v}`;
  if (k === "wait") {
    if (v && typeof v === "object") {
      return `wait ${v.selector || String(v.code || "").slice(0, 40)}${v.absent ? "（消失）" : ""}`;
    }
    return `wait ${v}ms`;
  }
  if (k === "reload") return "reload";
  if (k === "eval") return `eval ${String(v).split("\n")[0].slice(0, 60)}`;
  if (k === "expect") {
    if (v.consoleErrors != null) return `expect consoleErrors ≤ ${v.consoleErrors}`;
    if (v.text) return `expect text ${v.text} ${v.contains ? "∋ " + v.contains : "= " + v.equals}`;
    if (v.count) return `expect count ${v.count} = ${v.equals}`;
  }
  return k;
}

// 把 eval 片段安全嵌入生成代码：JSON.stringify 输出是合法 JS 字面量
const embed = (v) => JSON.stringify(v);

/** 执行单个步骤（返回 dbg 结果或宿主判定；失败抛错） */
async function runStep(step, previewDebug) {
  const [k, v] = Object.entries(step)[0];
  if (k === "click") {
    await previewDebug("click", { selector: v });
    return null;
  }
  if (k === "type") {
    await previewDebug("type", { selector: v.selector, text: v.value });
    return null;
  }
  if (k === "press") {
    await previewDebug("eval", {
      code:
        `(() => { const t = document.activeElement || document.body; ` +
        `t.dispatchEvent(new KeyboardEvent("keydown", { key: ${embed(v)}, bubbles: true })); ` +
        `t.dispatchEvent(new KeyboardEvent("keyup", { key: ${embed(v)}, bubbles: true })); ` +
        `return "pressed"; })()`,
    });
    return null;
  }
  if (k === "wait") {
    if (v && typeof v === "object") {
      // 对象形式：等元素出现 / 谓词成立（走 dbg wait 的 200ms 轮询，优于定值睡眠）
      const args = { timeoutMs: Math.min(10_000, Number(v.timeoutMs) || 10_000) };
      if (v.absent) args.absent = true;
      if (v.selector) args.selector = v.selector;
      else if (v.code) args.code = v.code;
      else throw new Error("wait 对象形式需要 selector 或 code");
      await previewDebug("wait", args, args.timeoutMs + 15_000);
      return null;
    }
    await new Promise((r) => setTimeout(r, Math.min(5000, Number(v) || 0)));
    return null;
  }
  if (k === "eval") {
    // 代码作为异步函数体执行：抛错即失败，断言值显式 return（false 视为失败）。
    // 共享上下文 T 宿主注入（用例内跨步骤传递辅助函数与状态；reload 后随页面
    // 重置）——AI 不必在每个步骤里重复定义工具函数
    const wrapped = `(globalThis.__T ??= {}), (async (T) => {\n${v}\n})(globalThis.__T)`;
    const res = await previewDebug("eval", { code: wrapped });
    if (res?.result === "false") throw new Error("表达式结果为 false");
    return res?.result;
  }
  if (k === "expect") {
    if (v.consoleErrors != null) return "console-delta"; // 宿主在用例层判定
    if (v.text) {
      const r = await previewDebug("text", { selector: v.text });
      const text = String(r?.result ?? "");
      if (v.contains != null && !text.includes(v.contains)) {
        throw new Error(`文本不包含期望值：期望 ∋ ${JSON.stringify(v.contains)}，实际 ${JSON.stringify(text.slice(0, 200))}`);
      }
      if (v.equals != null && text.trim() !== String(v.equals)) {
        throw new Error(`文本不相等：期望 ${JSON.stringify(v.equals)}，实际 ${JSON.stringify(text.slice(0, 200))}`);
      }
      return text.slice(0, 100);
    }
    if (v.count) {
      const r = await previewDebug("eval", {
        code: `(await $$(${embed(v.count)})).length`,
      });
      const n = Number(r?.result);
      if (n !== v.equals) throw new Error(`元素数量不符：期望 ${v.equals}，实际 ${n}`);
      return String(n);
    }
  }
  throw new Error(`未知步骤：${k}`);
}

/**
 * 跑一批用例。deps：
 *   cases            [{file, name, steps}]（parseTestFile 产物 + file）
 *   previewDebug     (cmd, args, timeoutMs) => dbg 结果（含 {result, meta}）
 *   waitOnline       () => Promise（reload 后等调试代理回线）
 *   recover          () => Promise（可选；dbg 投递失败时重推预览并等回线，
 *                      每个用例失败后自动重试一次）
 *   onProgress       ({done, total, current}) 可选
 *   stepTimeoutMs    单步 dbg 超时（默认 30s）
 * 返回 [{file, name, ok, ms, consoleErrors, steps: [{desc, ok, result?, error?}], error?}]
 */
export async function runTestCases({
  cases,
  previewDebug,
  waitOnline,
  recover,
  onProgress,
  stepTimeoutMs = 30_000,
}) {
  const results = [];
  for (const [ci, testCase] of cases.entries()) {
    onProgress?.({ done: ci, total: cases.length, current: testCase.name });
    const t0 = Date.now();
    const stepResults = [];
    let ok = true;
    let error = "";
    let consoleErrors = null;
    // 预览连接陈旧（窗口被关 / 页面卡死）导致的投递失败可自愈：重推最新
    // 代码并等回线后重试本用例一次（仅投递类错误，断言失败不重试）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 用例期间新增的控制台错误数 = status.errors 差值
        const statusBefore = await previewDebug("status", {}, stepTimeoutMs);
        const errorsBefore = statusBefore?.meta?.errors ?? 0;
        // reload 切分段：段内步骤连续走 dbg，跨 reload 由宿主重载并等回线
        const segments = [[]];
        for (const s of testCase.steps) {
          if (s.reload === true) segments.push(null), segments.push([]);
          else segments[segments.length - 1].push(s);
        }
        for (const seg of segments) {
          if (seg === null) {
            await previewDebug("eval", { code: "location.reload()" }, 3_000).catch(() => {});
            await waitOnline?.();
            continue;
          }
          for (const s of seg) {
            const desc = describeStep(s);
            try {
              const r = await runStep(s, (cmd, args, t) => previewDebug(cmd, args, t ?? stepTimeoutMs));
              if (r === "console-delta") continue;
              stepResults.push({ desc, ok: true, result: r == null ? "" : String(r).slice(0, 120) });
            } catch (err) {
              stepResults.push({ desc, ok: false, error: err.message });
              throw err;
            }
          }
        }
        const statusAfter = await previewDebug("status", {}, stepTimeoutMs);
        consoleErrors = Math.max(0, (statusAfter?.meta?.errors ?? 0) - errorsBefore);
        const expectConsole = testCase.steps
          .filter((s) => s.expect?.consoleErrors != null)
          .pop();
        if (expectConsole && consoleErrors > expectConsole.expect.consoleErrors) {
          throw new Error(`控制台新增 ${consoleErrors} 条错误（期望 ≤ ${expectConsole.expect.consoleErrors}）`);
        }
        ok = true;
        error = "";
        break;
      } catch (err) {
        const stale = /ACK timeout|无响应|投递失败/.test(err.message);
        if (stale && attempt === 0 && recover) {
          stepResults.length = 0; // 重试从头执行本用例
          await recover();
          continue;
        }
        ok = false;
        error = err.message;
        break;
      }
    }
    results.push({
      file: testCase.file,
      name: testCase.name,
      ok,
      ms: Date.now() - t0,
      consoleErrors,
      steps: stepResults,
      ...(error ? { error } : {}),
    });
  }
  onProgress?.({ done: cases.length, total: cases.length, current: "" });
  return results;
}

/** 结果汇总一句话（"4 通过 / 1 失败" 或 "2 通过"） */
export function summarizeResults(results) {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  return fail ? `${pass} 通过 / ${fail} 失败` : `${pass} 通过`;
}
