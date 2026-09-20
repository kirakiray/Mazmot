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

  const { deepseek: realKey, glmcodingplan: glmCodingKey } = JSON.parse(
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

  // 假 key 应被上游探测拒绝（422），且不落库
  const mf = await request("/admin/apikeys", {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { provider: "deepseek", label: "e2e-fake", apiKey: "sk-e2e-fake-key" },
  });
  const listAfterFake = await request("/admin/apikeys", { token: ADMIN_TOKEN });
  const mt = await request(`/admin/apikeys/${keyId}/test`, { method: "POST", token: ADMIN_TOKEN });
  check("POST /admin/apikeys/{id}/test 实时探测真 key 可用",
    mt.status === 200 && mt.data.ok === true, `status=${mt.status}`);

  const mt404 = await request("/admin/apikeys/no-such-id/test", { method: "POST", token: ADMIN_TOKEN });
  check("test 端点对不存在的 key 返回 404", mt404.status === 404);

  check("假 key 被上游探测拒绝（422 且不落库）",
    mf.status === 422 &&
      !(listAfterFake.data?.data?.apikeys || []).some((k) => k.label === "e2e-fake"),
    `status=${mf.status}`);


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
  const rec1ok =
    rec1.length === 1 &&
    typeof rec1[0].cacheHitTokens === "number" &&
    typeof rec1[0].cacheMissTokens === "number" &&
    rec1[0].promptTokens > 0;
  check("非流式对话后用量流水落账（含输入/输出/缓存明细）",
    rec1ok, `records=${rec1.length} tokens=${total1} hit=${rec1[0]?.cacheHitTokens} miss=${rec1[0]?.cacheMissTokens}`);

  const uAfter = await request("/admin/users", { token: ADMIN_TOKEN });
  const userAfter = (uAfter.data?.data?.users || []).find((u) => u.id === user.id);
  check("用户 usedTokens 与对话轮数已累计",
    userAfter?.usedTokens === total1 && userAfter?.totalRequests === rec1.length,
    `usedTokens=${userAfter?.usedTokens} totalRequests=${userAfter?.totalRequests}`);

  // ———— 2.5 GLM Coding Plan：glm-* 模型转发 + 缓存记账 ————
  if (glmCodingKey) {
    const mgc = await request("/admin/apikeys", {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { provider: "glm-coding", label: "e2e-glm-coding", apiKey: glmCodingKey },
    });
    check("glm-coding 上游 key 可登记", mgc.status === 201);
    const codingKeyId = mgc.data?.data?.id;

    const mgcu = await request("/admin/users", {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { name: "e2e-glm-user", apiKeyIds: [codingKeyId] },
    });
    const glmUser = mgcu.data?.data;
    check("glm-coding 用户创建成功", mgcu.status === 201);

    // 与 deepseek key 池隔离：glm 用户只能服务 glm-* 模型
    const crossModels = await request("/v1/models", { token: glmUser.bearkey });
    const crossIds = (crossModels.data?.data || []).map((m) => m.id);
    check("glm-coding 用户模型列表不含 deepseek（池隔离）",
      crossModels.status === 200 && crossIds.every((id) => !id.startsWith("deepseek")),
      `${crossIds.length} 个模型`);

    const glmChat = await request("/v1/chat/completions", {
      method: "POST",
      token: glmUser.bearkey,
      body: {
        model: "glm-4.7",
        messages: [{ role: "user", content: "回复两个字：你好" }],
        max_tokens: 64,
        thinking: { type: "disabled" },
      },
    });
    // 思考型模型偶发把输出全放进 reasoning_content 且被 max_tokens 截断，
    // 转发成功的本质判据：200 + usage 有 completion 消耗
    check("glm-coding 用户 glm-4.7 对话成功",
      glmChat.status === 200 &&
        ((glmChat.data?.choices?.[0]?.message?.content || "").length > 0 ||
          (glmChat.data?.usage?.completion_tokens ?? 0) > 0),
      `content=${JSON.stringify(glmChat.data?.choices?.[0]?.message?.content)?.slice(0, 40)} usage=${JSON.stringify(glmChat.data?.usage)?.slice(0, 60)}`);

    const gu = await request(`/admin/usage?userId=${glmUser.id}`, { token: ADMIN_TOKEN });
    const grec = (gu.data?.data?.items || [])[0] || {};
    const hitOk =
      typeof grec.cacheHitTokens === "number" &&
      grec.cacheHitTokens >= 0 &&
      typeof grec.cacheMissTokens === "number" &&
      grec.cacheHitTokens + grec.cacheMissTokens === grec.promptTokens;
    check("glm-coding 用量流水缓存记账自洽（命中+未命中=输入）",
      hitOk && grec.promptTokens > 0,
      `prompt=${grec.promptTokens} hit=${grec.cacheHitTokens} miss=${grec.cacheMissTokens}`);
  } else {
    check("glm-coding 缓存记账（根目录 test-api-keys.json 无 glmcodingplan key，跳过）", true);
  }

  // ———— 2.8 用户级模型白名单 ————
  const mpatch = await request(`/admin/users/${user.id}`, {
    method: "PATCH",
    token: ADMIN_TOKEN,
    body: { allowedModels: ["deepseek-flash"] },
  });
  check("PATCH allowedModels 生效", mpatch.status === 200 &&
    JSON.stringify(mpatch.data.data.allowedModels) === JSON.stringify(["deepseek-flash"]),
    `status=${mpatch.status} body=${JSON.stringify(mpatch.data).slice(0, 200)}`);

  const blockedChat = await request("/v1/chat/completions", {
    method: "POST",
    token: user.bearkey,
    body: { model: "deepseek-reasoner", messages: [{ role: "user", content: "hi" }] },
  });
  check("白名单外模型被 403 拦截",
    blockedChat.status === 403 && !!blockedChat.data?.error?.message,
    `status=${blockedChat.status}`);

  const filteredModels = await request("/v1/models", { token: user.bearkey });
  const filteredIds = (filteredModels.data?.data || []).map((m) => m.id);
  check("/v1/models 按白名单过滤",
    filteredModels.status === 200 && filteredIds.length === 1 && filteredIds[0] === "deepseek-flash",
    JSON.stringify(filteredIds));

  await request(`/admin/users/${user.id}`, {
    method: "PATCH",
    token: ADMIN_TOKEN,
    body: { allowedModels: [] },
  });
  const unblockedModels = await request("/v1/models", { token: user.bearkey });
  check("清空白名单后模型恢复不限制",
    (unblockedModels.data?.data || []).length === 2,
    `${(unblockedModels.data?.data || []).length} 个模型`);

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
    `records=${rec2.length} hit=${rec2[0]?.cacheHitTokens} miss=${rec2[0]?.cacheMissTokens}`);

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
