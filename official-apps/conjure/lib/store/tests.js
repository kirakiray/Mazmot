/* ---------- 场景测试（client/test/*.test.json，经预览调试通道执行） ----------
 * 用例清单读取、结果持久化（test-results:<app>）、跑测主流程（预览探活 →
 * 逐条执行 → 失败回流 autoErrors）、失败用例一键修复（发进对话由专门回合
 * 接手）。回合收尾自动跑已移除（用户拍板：自动跑体验太密）——场景测试只经
 * preview 工具 action=run-tests（AI 主动）或测试管理抽屉（用户点跑）触发。
 */

import {
  listTestCases,
  parseTestFile,
  runTestCases,
  summarizeResults,
} from "../test-runner.js";
import { sanitizeAppName, readAppFile, buildTestFixMessage } from "../builder.js";

export function createTestsPart(api) {
  const { state, set, setMany, fs, selfStore, pushLocalError } = api;

  const testResultsKey = (appName) => `test-results:${sanitizeAppName(appName)}`;

  // 用例清单（测试抽屉 / 回合自动跑的存在性判断）
  async function refreshTests() {
    if (state.currentAppName === "" || !fs) return;
    try {
      const rootHandle = await api.backupRootHandle();
      set("tests", await listTestCases(fs, state.currentAppName, rootHandle));
    } catch (err) {
      console.warn("读取测试用例失败：", err);
    }
  }

  // 还原上次全量测试结果（随应用切换加载；草稿态清空）
  async function restoreTestResults() {
    if (state.currentAppName === "" || !selfStore) {
      setMany({ testResults: {}, testLastRun: null });
      return;
    }
    try {
      const saved = await selfStore.getItem(testResultsKey(state.currentAppName));
      set("testResults", saved?.results ? Object.fromEntries(saved.results.map((r) => [r.file, r])) : {});
      set("testLastRun", saved ? { at: saved.at, ok: saved.ok, pass: saved.pass, fail: saved.fail } : null);
    } catch {
      /* 还原失败按无结果处理 */
    }
  }

  // reload 步骤后等调试代理回线：轮询 status 直到可应答（应用页重载会打断
  // dbg 链路，inject 重新挂载并心跳后恢复）
  async function waitTestAgentOnline(timeoutMs = 30_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        await api.previewDebug("status", {}, 5_000);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    return false;
  }

  /**
   * 跑场景用例（files 缺省 = 全部）：确保预览在线（离线先走推送流程，测的
   * 永远是最新代码）→ 逐条执行 → 结果落 state.testResults / testLastRun 并
   * 持久化（test-results:<app>）；失败行写 autoErrors 回流下回合修复
   */
  async function runTests(files) {
    if (state.testBusy || state.currentAppName === "" || !fs) return null;
    set("testBusy", true);
    try {
      await refreshTests();
      const all = state.tests.filter((t) => !t.broken);
      const picked = files?.length ? all.filter((t) => files.includes(t.file)) : all;
      if (!picked.length) {
        return { ok: true, noTests: true, summary: "没有测试用例", results: [] };
      }
      // 连接预检：previewOnline 可能是陈旧亮标（窗口已关 / 页面卡死），
      // status 探活失败就重推最新代码再跑
      try {
        await api.previewDebug("status", {}, 8_000);
      } catch {
        await api.runRemotePreview(state.currentAppName, state.currentAppMode);
      }
      const rootHandle = await api.backupRootHandle();
      const cases = [];
      for (const t of picked) {
        const raw = await readAppFile(fs, state.currentAppName, t.file, rootHandle);
        const parsed = parseTestFile(raw, t.file);
        cases.push({ file: t.file, name: parsed.name, steps: parsed.steps });
      }
      const results = await runTestCases({
        cases,
        previewDebug: api.previewDebug,
        waitOnline: waitTestAgentOnline,
        onProgress: (p) => set("testRunning", p),
        // 单条用例跑完立即回填抽屉（✓/✗ 逐条点亮，不等全量结束）；
        // 跑完全量后再整体替换一次（自愈重试等的最终态以它为准）
        onCaseResult: (r) =>
          set("testResults", { ...state.testResults, [r.file]: r }),
        // 用例中途连接失效的自愈：重推预览 + 等回线后重试该用例
        recover: async () => {
          await api.runRemotePreview(state.currentAppName, state.currentAppMode);
          await waitTestAgentOnline();
        },
      });
      const pass = results.filter((r) => r.ok).length;
      const summary = {
        at: Date.now(),
        ok: pass === results.length,
        pass,
        fail: results.length - pass,
      };
      set("testResults", Object.fromEntries(results.map((r) => [r.file, r])));
      set("testLastRun", summary);
      set("testRunning", null);
      try {
        await selfStore.setItem(testResultsKey(state.currentAppName), {
          at: summary.at,
          ok: summary.ok,
          pass,
          fail: summary.fail,
          results,
        });
      } catch {
        /* 结果持久化失败不影响本次报告 */
      }
      // 失败回流：写 autoErrors（下回合提示词自动附带，UI 可忽略），AI 从
      // 摘要行定位失败用例
      const fails = results.filter((r) => !r.ok);
      if (fails.length) {
        set(
          "autoErrors",
          fails.map((r) => `[测试] ${r.name}：${r.error}`),
        );
        api.invalidateAgent();
      }
      return { ok: summary.ok, summary: summarizeResults(results), results };
    } catch (err) {
      // 回合内（preview 工具触发）：错误卡片进对话，不弹横幅；但 runRemotePreview
      // 自身失败时已镜像过「隔离预览失败」卡（reported 标记），跳过防双卡。
      // 非回合入口（测试抽屉）没有对话现场，走 keyError 横幅
      if (state.sending && !err?.reported) {
        pushLocalError(`测试执行失败：${err.message}`);
      } else if (!state.sending) {
        set("keyError", `测试执行失败：${err.message}`);
      }
      return null;
    } finally {
      set("testBusy", false);
      set("testRunning", null);
    }
  }

  // 测试抽屉「修复失败用例」：把上一轮跑测的失败内容（用例名 / 文件 / 失败
  // 步骤与期望实际）整理成对话自动发给 AI，由这个专门的修复回合接手；提示词
  // 已约定修完只重跑失败的用例文件（不全量跑），跑测循环由 AI 在回合内完成
  async function fixFailedTests() {
    if (state.sending) return { ok: false, reason: "sending" };
    if (state.currentAppName === "") return { ok: false, reason: "draft" };
    const text = buildTestFixMessage(Object.values(state.testResults));
    if (!text) return { ok: false, reason: "no-fail" };
    return api.send(text);
  }

  return { refreshTests, restoreTestResults, runTests, fixFailedTests };
}
