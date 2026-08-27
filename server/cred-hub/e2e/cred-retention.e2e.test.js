// cred-hub 冷数据淘汰 e2e：验证「最后访问时间 + 保留期」的生命周期
// —— 未被访问的记录到期被清扫删除；被 GET 访问的续命；续命期过后同样消失。
// 运行方式由 retention.playwright.config.js 承载（保留期 2 秒），时序断言用
// 轮询而非固定 sleep，避免清扫周期抖动造成 flake。
import { test, expect } from "@playwright/test";
import { generateUser, issueCert, resign } from "./helpers.mjs";

const BASE = "http://127.0.0.1:8791";
const RETENTION_MS = 2000;
const SWEEP_MS = 1000; // = max(retention/10, 1000)

async function pollStatus(request, id, want, timeoutMs) {
  const start = Date.now();
  for (;;) {
    // 观察用 touch=0（不续命），否则轮询本身会让记录永生
    const res = await request.get(`${BASE}/creds/${id}?touch=0`);
    if (res.status() === want) return Date.now();
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待 ${id} 变为 ${want} 超时（当前 ${res.status()}）`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

test.describe("cred-hub 冷数据淘汰", () => {
  let alice;

  test.beforeAll(async () => {
    alice = await generateUser("alice");
  });

  test("未被访问的记录在保留期后被清除", async ({ request }) => {
    const cert = await issueCert(alice, { role: "cold" });
    const post = await request.post(`${BASE}/creds`, { data: cert });
    expect(post.status()).toBe(201);

    // 保留期内仍可读
    expect((await request.get(`${BASE}/creds/${cert.id}`)).status()).toBe(200);

    // 到保留期 + 一个清扫周期后确认被清除
    const evictedAt = await pollStatus(request, cert.id, 404, RETENTION_MS + SWEEP_MS * 3);
    // 写入时刻无从精确取回，但至少应晚于接近一个保留期的耗时
    expect(evictedAt - Number(cert.signTime)).toBeGreaterThanOrEqual(RETENTION_MS);
  });

  test("GET 访问持续续命；停止访问后过保留期才清除", async ({ request }) => {
    const cert = await issueCert(alice, { role: "hot" });
    const post = await request.post(`${BASE}/creds`, { data: cert });
    expect(post.status()).toBe(201);

    // 持续访问超过「原始保留期的好几倍」，每次命中都续命 → 始终应存活。
    // 若没有续命机制，这条记录早在写入后 retention+清扫周期内就该消失
    let lastAliveAt = Date.now();
    while (Date.now() - cert.signTime < RETENTION_MS * 3 + SWEEP_MS * 2) {
      expect((await request.get(`${BASE}/creds/${cert.id}`)).status()).toBe(200);
      lastAliveAt = Date.now();
      await new Promise((r) => setTimeout(r, Math.floor(RETENTION_MS / 3)));
    }

    // 停止访问，等待最后那次续命到期
    await pollStatus(request, cert.id, 404, lastAliveAt + RETENTION_MS + SWEEP_MS * 3 - Date.now());
  });

  test("覆盖更新会重置热度", async ({ request }) => {
    const v1 = await issueCert(alice, { role: "fresh" });
    expect((await request.post(`${BASE}/creds`, { data: v1 })).status()).toBe(201);

    // 等 v1 的原始生命周期大部分流逝（若是同一热度本接近被淘汰）
    await new Promise((r) => setTimeout(r, RETENTION_MS / 2));

    // 同 key 新 signTime 覆盖写入 → 热度从覆盖时刻重新起算
    const v2 = await resign({ ...v1, subject: "carol", signTime: Date.now() }, alice);
    expect((await request.post(`${BASE}/creds`, { data: v2 })).status()).toBe(201);
    const got = await (await request.get(`${BASE}/creds/${v1.id}`)).json();
    expect(got.subject).toBe("carol");

    // 覆盖后的完整保留期内仍存活
    await new Promise((r) => setTimeout(r, RETENTION_MS));
    expect((await request.get(`${BASE}/creds/${v1.id}`)).status()).toBe(200);
  });
});
