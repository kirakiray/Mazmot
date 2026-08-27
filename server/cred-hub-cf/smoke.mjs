// 冒烟测试：先 `npm run dev` 起本地 wrangler（D1 本地库已初始化），再 `node smoke.mjs`
// 复用 Rust 版 e2e 的签名工具，保证与 NoneOS 方案同源
import { generateUser, issueCert, resign, signObject } from "../cred-hub/e2e/helpers.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8788";
let passed = 0;

function check(name, cond, extra = "") {
  if (!cond) {
    console.error(`✗ ${name}${extra ? " —— " + extra : ""}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`✓ ${name}`);
  }
}

const j = async (res) => res.json();
const post = (path, data) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

const alice = await generateUser("alice");

// —— /creds ——
{
  const cert = await issueCert(alice, { role: "member" });
  const res = await post("/creds", cert);
  check("POST /creds 合法入库", res.status === 201, `got ${res.status}: ${JSON.stringify(await j(res))}`);

  const got = await fetch(`${BASE}/creds/${cert.id}`);
  const body = await j(got);
  check(
    "GET /creds/{key} 读回一致",
    got.status === 200 && body.signature === cert.signature && body.role === "member",
  );

  cert.subject = "evil";
  check("篡改被验签拦截", (await post("/creds", cert)).status === 422);

  const older = await issueCert(alice, { role: "conv", signTime: Date.now() - 5000 });
  await post("/creds", older);
  check(
    "旧 signTime 收敛 409",
    (await post("/creds", await resign({ ...older, signTime: Date.now() - 10000 }, alice)))
      .status === 409,
  );

  // 超过 2048 字节上限 → 413；用篡改数据验证大小检查先于验签（否则会 422）
  const big = await issueCert(alice, { role: "big", pad: "x".repeat(3000) });
  big.subject = "evil";
  check("超大小上限 413 且先于验签", (await post("/creds", big)).status === 413);
}

// —— 配对码（core getProfile 形态：无 id、无 expire 的签名载荷视图）——
{
  const carol = await generateUser("carol");
  const card = await signObject(carol, {
    role: "profile",
    issuer: carol.name,
    subject: carol.name,
    publicKey: carol.publicKey,
    signTime: Date.now(),
    username: "Carol",
  });

  const reg = await j(await post("/pairing/register", card));
  check("register 返回 6/8 位小写数字码", /^[0-9a-z]{6,8}$/.test(reg.code || ""), JSON.stringify(reg));
  check("expiresAt 是未来的毫秒时间戳", reg.expiresAt > Date.now());

  const reregistered = await j(
    await post("/pairing/register", await signObject(carol, {
      role: "profile",
      issuer: carol.name,
      subject: carol.name,
      publicKey: carol.publicKey,
      signTime: card.signTime,
      username: "Carol",
    })),
  );
  check("同窗口重复提交同码幂等", reregistered.code === reg.code);

  const got = await fetch(`${BASE}/pairing/resolve?code=${reg.code}`);
  const resolved = await j(got);
  check(
    "凭码解析完整卡片",
    got.status === 200 && resolved.username === "Carol" && resolved.subject === "carol",
  );

  check(
    "无效码 404",
    (await fetch(`${BASE}/pairing/resolve?code=zzzzzz`)).status === 404,
  );

  const notProfile = await issueCert(carol, { role: "editor" });
  check("非 profile 卡片拒绝", (await post("/pairing/register", notProfile)).status === 422);

  // 改字段不重签 → 验签拦截
  const evil = { ...card, username: "evil" };
  check("篡改后的卡片被拦截", (await post("/pairing/register", evil)).status === 422);
}

// —— 管理 API（wrangler.toml 本地 vars 里的 CRED_HUB_ADMIN_TOKEN）——
{
  const auth = { authorization: "Bearer local-test-admin-token" };

  check(
    "admin 无/错 token 拒绝",
    (await fetch(`${BASE}/admin/stats`)).status === 401 &&
      (await fetch(`${BASE}/admin/stats`, { headers: { authorization: "Bearer nope" } })).status === 401,
  );

  const stats = await j(await fetch(`${BASE}/admin/stats`, { headers: auth }));
  check(
    "stats 总览",
    stats.ok && stats.creds.total >= 2 && stats.creds.active + stats.creds.cooling === stats.creds.total,
    JSON.stringify(stats),
  );

  const hot = await j(await fetch(`${BASE}/admin/hot?limit=10`, { headers: auth }));
  const sortedDesc = (arr, key) => arr.every((it, i) => i === 0 || it[key] <= arr[i - 1][key]);
  check(
    "hot 倒序列表",
    hot.ok && hot.items.length > 0 && sortedDesc(hot.items, "lastAccessMs"),
  );

  const expiring = await j(
    await fetch(`${BASE}/admin/expiring?withinDays=30`, { headers: auth }),
  );
  check(
    "expiring 升序且只含未来到期项",
    expiring.ok &&
      sortedDesc([...expiring.items].reverse(), "expire") &&
      expiring.items.every((it) => it.expire != null && it.expire > Date.now()),
  );
}

// —— CORS（本地 wrangler.toml 配 CRED_HUB_CORS="1" 通配模式）——
{
  const res = await fetch(`${BASE}/health`, { headers: { origin: "https://example.com" } });
  check(
    "CORS 通配模式回显 allow-origin:*",
    res.headers.get("access-control-allow-origin") === "*",
    `got ${res.headers.get("access-control-allow-origin")}`,
  );
}

console.log(passed ? `\n${passed} checks passed` : "");
