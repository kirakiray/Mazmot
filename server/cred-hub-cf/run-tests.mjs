// 自动化测试入口：自管生命周期 —— 初始化本地 D1 → 拉起 wrangler dev → 跑 smoke → 清理
// 用法：npm test（本目录）或根目录 npm run cred-hub-cf-test
import { spawn } from "node:child_process";

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

function run(cmd, args, { capture } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: new URL(".", import.meta.url).pathname,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    if (capture) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    child.on("close", (code) => resolve({ code, out }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(maxMs = 60_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(800);
  }
  return false;
}

let devProcess = null;

// 已有实例在跑就复用，否则自己拉一个
let hasServer = false;
try {
  hasServer = (await fetch(`${BASE}/health`)).ok;
} catch {}

if (!hasServer) {
  await run("npx", ["wrangler", "d1", "execute", "cred-hub", "--local", "--file=schema.sql"]);
  devProcess = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local"], {
    cwd: new URL(".", import.meta.url).pathname,
    stdio: "ignore",
    detached: true,
  });
}

process.env.BASE_URL = BASE;

let smokeCode = 1;
if (await waitForHealth()) {
  smokeCode = (await run(process.execPath, ["smoke.mjs"])).code;
} else {
  console.error("wrangler dev 未能在时限内就绪");
}

if (devProcess) {
  try {
    process.kill(-devProcess.pid);
  } catch {}
}

process.exit(smokeCode);
