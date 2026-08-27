import { test, expect } from "@playwright/test";
import { generateUser, issueCert, resign } from "./helpers.mjs";

const BASE = "http://127.0.0.1:8790";
const TOKEN = "e2e-admin-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };

test.describe("admin（Bearer Token 管理 API）", () => {
  let alice;

  test.beforeAll(async () => {
    alice = await generateUser("admin-alice");
    const post = (data) =>
      fetch(`${BASE}/creds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    // 一条普通记录 + 一条 1 小时后到期的记录
    await post(await issueCert(alice, { role: "plain" }));
    await post(
      await issueCert(alice, { role: "soon", expire: Date.now() + 3600_000 }),
    );
  });

  test("未配置外的令牌：错 token / 无 token 均 401", async ({ request }) => {
    expect(
      (await request.get(`${BASE}/admin/stats`)).status(),
    ).toBe(401);
    expect(
      (
        await request.get(`${BASE}/admin/stats`, {
          headers: { authorization: "Bearer wrong-token" },
        })
      ).status(),
    ).toBe(401);
  });

  test("GET /admin/stats 返回总览", async ({ request }) => {
    const res = await request.get(`${BASE}/admin/stats`, { headers: AUTH });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.creds.total).toBeGreaterThanOrEqual(2);
    expect(body.creds.active + body.creds.cooling).toBe(body.creds.total);
    expect(typeof body.pairing.activeCodes).toBe("number");
  });

  test("GET /admin/hot 按最后访问倒序列出记录", async ({ request }) => {
    const res = await request.get(`${BASE}/admin/hot?limit=10`, { headers: AUTH });
    expect(res.status()).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].lastAccessMs).toBeGreaterThanOrEqual(items[i].lastAccessMs);
    }
    expect(items.some((it) => it.role === "plain")).toBe(true);
  });

  test("GET /admin/expiring 找到未来一天内到期的记录，按到期升序", async ({ request }) => {
    const res = await request.get(`${BASE}/admin/expiring?withinDays=30`, { headers: AUTH });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items.some((it) => it.role === "soon")).toBe(true);
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i].expire >= body.items[i - 1].expire).toBe(true);
    }
  });

  test("永不过期与已过期的记录不出现在 expiring", async ({ request }) => {
    // 永不过期
    const forever = await issueCert(alice, { role: "forever-admin" });
    forever.id = `forever-admin-${forever.issuer}-${forever.subject}`;
    await fetch(`${BASE}/creds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forever),
    });
    const body = await (
      await request.get(`${BASE}/admin/expiring?withinDays=30`, { headers: AUTH })
    ).json();
    expect(body.items.every((it) => it.role !== "forever-admin")).toBe(true);
  });
});
