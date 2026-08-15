// 本地专用测试入口：
// 1. 临时把 ai/test 下的 `-sb.html`（不进 CI 的命名）改成 `.sb.html`
// 2. 自行生成 test-all.html（sb-test-suite + 两个 include），用 sb-test --run-only 一次跑完
//    （不跑全量扫描，避免误跑项目里其他 .sb.html；浏览器侧 include 只 fetch 内容，不校验后缀）
// 3. 结束后（无论成败 / Ctrl+C）删除生成的 test-all.html 并还原命名
// 用法：npm run local-test [-- sb-test 参数...]，如 npm run local-test -- --browsers chrome
import { spawn } from "node:child_process";
import { existsSync, renameSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TEST_DIR = join(ROOT, "ai", "test");

const entries = existsSync(TEST_DIR) ? readdirSync(TEST_DIR) : [];
// [原名, 临时名]，只记录实际被改名的文件
const renamed = entries
  .filter((name) => name.endsWith("-sb.html"))
  .map((name) => [join(TEST_DIR, name), join(TEST_DIR, name.replace(/-sb\.html$/, ".sb.html"))]);

const ALL_HTML = join(ROOT, "test-all.html");

const restore = () => {
  for (const [from, to] of renamed) {
    if (existsSync(to)) {
      renameSync(to, from);
      console.log(`已还原：${from}`);
    }
  }
  if (existsSync(ALL_HTML)) rmSync(ALL_HTML); // sb-test 异常退出时兜底清理
};

// 信号处理必须是同步运行时能被调度到的（事件循环空闲），故用异步 spawn 而非 spawnSync
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

if (renamed.length === 0) {
  console.error(`未在 ${TEST_DIR} 找到 *-sb.html 测试文件`);
  process.exit(1);
}

for (const [from, to] of renamed) {
  renameSync(from, to);
  console.log(`临时改名：${relative(ROOT, from)} -> ${relative(ROOT, to)}`);
}

// 生成 test-all.html（模板与 sibyl-test generateAllHtml 保持一致）
const includeTags = renamed
  .map(([, to]) => `      <include src="./${relative(ROOT, to)}"></include>`)
  .sort()
  .join("\n");
writeFileSync(
  ALL_HTML,
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>All Tests</title>
    <script type="module" src="https://cdn.jsdelivr.net/gh/ofajs/sibyl-test/components/sb-test-suite.mjs"></script>
  </head>
  <body>
    <sb-test-suite>
${includeTags}
    </sb-test-suite>
  </body>
</html>
`,
  "utf-8"
);

let exitCode = 0;
try {
  // stdio: inherit 直接透传 sb-test 的彩色进度与失败详情
  const result = await new Promise((resolve) => {
    const child = spawn("npx", ["sb-test", "--run-only", ...process.argv.slice(2)], {
      stdio: "inherit",
      cwd: ROOT,
      shell: process.platform === "win32",
    });
    child.on("error", (e) => {
      console.error(`启动 sb-test 失败：${e.message}`);
      resolve({ status: 1 });
    });
    child.on("close", (code) => resolve({ status: code ?? 1 }));
  });
  exitCode = result.status;
} finally {
  restore();
}

process.exit(exitCode);
