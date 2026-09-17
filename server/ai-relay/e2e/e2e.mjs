// ai-relay e2e 功能测试：起真服务器（临时数据目录），用根目录 test-api-keys.json
// 里的真实 DeepSeek key 走通完整链路：
//   管理端添加上游 key → 创建用户（配额）→ 签发邀请码 → 解码校验
//   → /v1/models → /v1/chat/completions（非流式 + 流式）→ 用量落账 → 配额拦截 → 鉴权拒绝
//
// 运行：cd server/ai-relay && node e2e/e2e.mjs
// 依赖：cargo（服务器自动编译启动）、根目录 test-api-keys.json 的 deepseek key；
//       走真实上游会产生少量 token 消耗（测试统一 max_tokens=16）。

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", ".."); // 仓库根
const PORT = 18971;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = "e2e-admin-token-" + Math.random().toString(36).slice(2);

// ———— 极简断言与运行器 ————
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const request = async (path, { method = "GET", token, body } = {}) => {
  const resp = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* 非 JSON */
  }
  return { status: resp.status, data };
};

// ———— 启动服务器 ————
const dataDir = mkdtempSync(join(tmpdir(), "ai-relay-e2e-"));
const server = spawn("cargo", ["run"], {
  cwd: join(__dirname, ".."),
  env: {
    ...process.env,
    AI_RELAY_ADMIN_TOKEN: ADMIN_TOKEN,
    AI_RELAY_PORT: String(PORT),
    AI_RELAY_DATA: join(dataDir, "relay.redb"),
    AI_RELAY_PUBLIC_URL: "https://relay.example.com",
    AI_RELAY_CORS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const waitForHealth = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const resp = await fetch(`${BASE}/health`);
      if (resp.ok) return;
    } catch {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("服务器 60s 内未就绪\n" + serverLog.slice(-2000));
};

try {
  await waitForHealth();
  console.log("服务器已启动");

  const { deepseek: realKey } = JSON.parse(
    readFileSync(join(ROOT, "test-api-keys.json"), "utf8"),
  );
  if (!realKey) throw new Error("根目录 test-api-keys.json 缺少 deepseek key");

  // ———— 1. 管理端：添加上游 key / 建用户 / 邀请码 ————
  const mk = await request("/admin/apikeys", {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { provider: "deepseek", label: "e2e-deepseek", apiKey: realKey },
  });
  check("添加上游 apikey 返回 201 且明文不回传",
    mk.status === 201 && mk.data.ok && mk.data.data.maskedKey !== realKey,
    `maskedKey=${mk.data?.data?.maskedKey}`);

  const keyId = mk.data.data.id;

  const unauth = await request("/admin/overview");
  check("无令牌访问管理 API 返回 401", unauth.status === 401);

  const mu = await request("/admin/users", {
    method: "POST",
    token: ADMIN_TOKEN,
    body: {
      name: "e2e-user",
      note: "e2e",
      quotaTokens: 100000,
      apiKeyIds: [keyId],
    },
  });
  check("创建用户返回 201 且带 bearkey", mu.status === 201 && !!mu.data.data.bearkey);
  const user = mu.data.data;

  const invite = await request(`/admin/users/${user.id}/invite`, {
    token: ADMIN_TOKEN,
  });
  check("邀请码接口返回 code/serverUrl/bearkey",
    invite.status === 200 &&
      invite.data.data.serverUrl === "https://relay.example.com" &&
      invite.data.data.bearkey === user.bearkey,
    `serverUrl=${invite.data?.data?.serverUrl}`);

  // 按客户端解法验证邀请码内容
  const payload = JSON.parse(
    Buffer.from(invite.data.data.code.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
  );
  check("邀请码可解出服务器地址与 bearkey",
    payload.u === "https://relay.example.com" && payload.k === user.bearkey,
    JSON.stringify(payload));

  // ———— 2. 用户端：models / chat 非流式 ————
  const badAuth = await request("/v1/models", { token: "wrong-bearkey" });
  check("错误 bearkey 访问 /v1 返回 401", badAuth.status === 401);

  const models = await request("/v1/models", { token: user.bearkey });
  const modelIds = (models.data?.data || []).map((m) => m.id);
  check("/v1/models 返回 deepseek 模型列表",
    models.status === 200 && modelIds.some((id) => id.startsWith("deepseek")),
    `${modelIds.length} 个模型`);

  const chat = await request("/v1/chat/completions", {
    method: "POST",
    token: user.bearkey,
    body: {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "回复两个字：你好" }],
      max_tokens: 16,
    },
  });
  check("/v1/chat/completions 非流式返回内容",
    chat.status === 200 && (chat.data?.choices?.[0]?.message?.content || "").length > 0,
    `content=${JSON.stringify(chat.data?.choices?.[0]?.message?.content)?.slice(0, 60)}`);

  const usage1 = await request(`/admin/usage?userId=${user.id}`, { token: ADMIN_TOKEN });
  const rec1 = usage1.data?.data?.items || [];
  const total1 = rec1.reduce(
    (sum, r) => sum + r.promptTokens + r.completionTokens,
    0,
  );
  check("非流式对话后用量流水落账（token > 0）",
    rec1.length === 1 && total1 > 0, `records=${rec1.length} tokens=${total1}`);

  const uAfter = await request("/admin/users", { token: ADMIN_TOKEN });
  const userAfter = (uAfter.data?.data?.users || []).find((u) => u.id === user.id);
  check("用户 usedTokens 已累计", userAfter?.usedTokens === total1,
    `usedTokens=${userAfter?.usedTokens}`);

  // ———— 3. 流式 ————
  const streamResp = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.bearkey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "数到三" }],
      max_tokens: 16,
      stream: true,
    }),
  });
  const raw = await streamResp.text();
  const chunks = raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  const streamText = chunks
    .map((c) => c.choices?.[0]?.delta?.content || "")
    .join("");
  const hasStreamUsage = chunks.some((c) => c.usage);
  check("流式响应透传 SSE 且末 chunk 带 usage",
    streamResp.status === 200 && streamText.length > 0 && hasStreamUsage,
    `text=${JSON.stringify(streamText).slice(0, 40)} usage=${JSON.stringify(chunks.at(-1)?.usage)}`);

  const usage2 = await request(`/admin/usage?userId=${user.id}`, { token: ADMIN_TOKEN });
  const rec2 = usage2.data?.data?.items || [];
  check("流式对话后第二条用量流水落账",
    rec2.length === 2 && rec2[0].promptTokens + rec2[0].completionTokens > 0,
    `records=${rec2.length}`);

  // ———— 4. 配额拦截 ————
  // 配额语义：用满即拒（used >= quota 时拒绝），首次请求前 used=0 必然放行，
  // 因此先消费一次使 used 超过配额，再验证后续请求被 402
  const mu2 = await request("/admin/users", {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { name: "e2e-broke", quotaTokens: 1, apiKeyIds: [keyId] },
  });
  const broke = mu2.data.data;
  await request("/v1/chat/completions", {
    method: "POST",
    token: broke.bearkey,
    body: {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
    },
  });
  const denied = await request("/v1/chat/completions", {
    method: "POST",
    token: broke.bearkey,
    body: { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] },
  });
  check("超额用户请求被 402 拒绝",
    denied.status === 402 && !!denied.data?.error?.message,
    `status=${denied.status}`);

  const unbound = await request("/v1/chat/completions", {
    method: "POST",
    token: broke.bearkey.replace(/.$/, (c) => (c === "x" ? "y" : "x")),
  });
  check("伪造 bearkey 被拒绝", unbound.status === 401);

  // ———— 5. 重置 bearkey 后旧码作废 ————
  const reset = await request(`/admin/users/${user.id}/reset-bearkey`, {
    method: "POST",
    token: ADMIN_TOKEN,
  });
  const oldKey = user.bearkey;
  const oldStillWorks = await request("/v1/usage", { token: oldKey });
  const newWorks = await request("/v1/usage", { token: reset.data.data.bearkey });
  check("重置 bearkey 后旧码 401、新码可用",
    reset.status === 200 && oldStillWorks.status === 401 && newWorks.status === 200);
} catch (error) {
  check("e2e 流程异常中断", false, error.message);
} finally {
  server.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
