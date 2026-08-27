import { test, expect } from "@playwright/test";
import { generateUser, issueCert, resign } from "./helpers.mjs";

const BASE = "http://127.0.0.1:8790";

async function postCred(request, cred) {
  return request.post(`${BASE}/creds`, { data: cred });
}

test.describe("cred-hub e2e", () => {
  let alice;

  test.beforeAll(async () => {
    alice = await generateUser("alice");
  });

  test("GET /health 返回 ok", async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("POST /creds 合法数据返回 201 并入库", async ({ request }) => {
    const cert = await issueCert(alice, { role: "member" });
    const res = await postCred(request, cert);
    expect(res.status()).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: cert.id });

    const got = await request.get(`${BASE}/creds/${cert.id}`);
    expect(got.status()).toBe(200);
    expect(await got.json()).toMatchObject({
      id: cert.id,
      role: "member",
      issuer: "alice",
      subject: "bob",
      signature: cert.signature,
    });
  });

  test("GET 不存在的 key 返回 404", async ({ request }) => {
    const res = await request.get(`${BASE}/creds/member-nobody-x`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test("篡改字段后被验签拦截（422）", async ({ request }) => {
    const cert = await issueCert(alice, { role: "editor" });
    cert.subject = "evil";
    const res = await postCred(request, cert);
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toContain("签名验证失败");
  });

  test("换公钥重放签名被拒绝（422）", async ({ request }) => {
    const cert = await issueCert(alice, { role: "admin" });
    const mallory = await generateUser("mallory");
    cert.publicKey = mallory.publicKey;
    const res = await postCred(request, cert);
    expect(res.status()).toBe(422);
  });

  test("缺必填字段返回 422", async ({ request }) => {
    for (const missing of ["id", "role", "issuer", "subject", "signature"]) {
      const cert = await issueCert(alice, { role: `t-${missing}` });
      delete cert[missing];
      const res = await postCred(request, cert);
      expect(res.status()).toBe(422);
      expect((await res.json()).error).toContain(missing);
    }
  });

  test("非 JSON 对象请求体返回 422", async ({ request }) => {
    const res = await postCred(request, [1, 2, 3]);
    expect(res.status()).toBe(422);
  });

  test("超过大小上限（默认 2048 字节）返回 413，且先于验签", async ({ request }) => {
    const cert = await issueCert(alice, { role: "big", pad: "x".repeat(3000) });
    cert.subject = "evil"; // 若验签先执行会得到 422；413 证明大小检查在前
    const res = await postCred(request, cert);
    expect(res.status()).toBe(413);
    expect((await res.json()).error).toContain("上限");
  });

  test("expire 早于 signTime 返回 422", async ({ request }) => {
    const now = Date.now();
    const cert = await issueCert(alice, {
      role: "backwards",
      expire: now - 1000,
    });
    const res = await postCred(request, cert);
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toContain("expire");
  });

  test("已过期的证书返回 422", async ({ request }) => {
    const cert = await issueCert(alice, {
      role: "stale",
      signTime: Date.now() - 90_000,
      expire: Date.now() - 60_000,
    });
    const res = await postCred(request, cert);
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toContain("过期");
  });

  test("expire 为 null 表示永不过期，可正常入库", async ({ request }) => {
    const cert = await issueCert(alice, { role: "forever" });
    cert.id = "forever-alice-bob";
    const res = await postCred(request, cert);
    expect(res.status()).toBe(201);
  });

  test("同 key 旧 signTime 返回 409 收敛；新 signTime 覆盖成功", async ({ request }) => {
    const older = await issueCert(alice, { role: "conv", signTime: Date.now() - 5_000 });
    expect((await postCred(request, older)).status()).toBe(201);

    // 更旧的重复记录 → 409
    const stale = await resign({ ...older, signTime: Date.now() - 10_000 }, alice);
    const conflict = await postCred(request, stale);
    expect(conflict.status()).toBe(409);

    // 数据仍是最初那条
    const kept = await (await request.get(`${BASE}/creds/${older.id}`)).json();
    expect(kept.signTime).toBe(older.signTime);

    // 更新的记录覆盖成功
    const newer = await resign(
      {
        ...older,
        signTime: Date.now(),
        subject: "carol",
      },
      alice
    );
    const overwrite = await postCred(request, newer);
    expect(overwrite.status()).toBe(201);
    const updated = await (await request.get(`${BASE}/creds/${newer.id}`)).json();
    expect(updated.subject).toBe("carol");
  });

  test("persist 后可经 GET 读回完整记录（含自定义字段）", async ({ request }) => {
    const cert = await issueCert(alice, { role: "extra", level: "gold", tags: ["a", "b"] });
    const res = await postCred(request, cert);
    expect(res.status()).toBe(201);
    const got = await (await request.get(`${BASE}/creds/${cert.id}`)).json();
    expect(got.level).toBe("gold");
    expect(got.tags).toEqual(["a", "b"]);
  });
});
