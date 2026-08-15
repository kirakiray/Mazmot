// 本地专用测试入口：用 sb-test -f 显式运行 ai/test 下的 *-sb.html（不进 CI 的命名）。
// 依赖 sibyl-test >= 1.0.15 的 -f 多文件 + 后缀不限 .sb.html 能力，无需再临时改名。
// 用法：npm run local-test [-- sb-test 参数...]，如 npm run local-test -- --browsers chrome
import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TEST_DIR = join(ROOT, "ai", "test");

const files = existsSync(TEST_DIR)
  ? readdirSync(TEST_DIR)
      .filter((name) => name.endsWith("-sb.html"))
      .map((name) => relative(ROOT, join(TEST_DIR, name)))
  : [];

if (files.length === 0) {
  console.error(`未在 ${TEST_DIR} 找到 *-sb.html 测试文件`);
  process.exit(1);
}

console.log(`运行本地测试：${files.join(", ")}`);

// stdio: inherit 直接透传 sb-test 的彩色进度与失败详情
const child = spawn("npx", ["sb-test", "-f", ...files, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: ROOT,
  shell: process.platform === "win32",
});
child.on("error", (e) => {
  console.error(`启动 sb-test 失败：${e.message}`);
  process.exit(1);
});
child.on("close", (code) => process.exit(code ?? 1));
