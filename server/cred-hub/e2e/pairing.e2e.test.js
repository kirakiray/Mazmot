import { test, expect } from "@playwright/test";
import { generateUser, issueCert, resign, signObject } from "./helpers.mjs";

const BASE = "http://127.0.0.1:8790";

function profileCard(user, extra = {}) {
  return issueCert(user, {
    role: "profile",
    issuer: user.name,
    subject: user.name,
    username: user.name,
    ...extra,
  });
}

/** core getProfile 形态的卡片：签名载荷视图，不含 id、无 expire */
function payloadCard(user, extra = {}) {
  return signObject(user, {
    role: "profile",
    issuer: user.name,
    subject: user.name,
    publicKey: user.publicKey,
    signTime: Date.now(),
    username: user.name,
    ...extra,
  });
}

test.describe("pairing（配对码）", () => {
  let carol;

  test.beforeAll(async () => {
    carol = await generateUser("carol");
  });

  test("提交合法用户卡片返回 6-10 位小写数字码 + expiresAt", async ({ request }) => {
    const card = await profileCard(carol);
    const res = await request.post(`${BASE}/pairing/register`, { data: card });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toMatch(/^[0-9a-z]{6,10}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  test("同窗口重复提交返回同一个码", async ({ request }) => {
    const card = await profileCard(carol);
    const first = await (
      await request.post(`${BASE}/pairing/register`, { data: card })
    ).json();
    const second = await (
      await request.post(`${BASE}/pairing/register`, { data: await resign(card, carol) })
    ).json();
    expect(second.code).toBe(first.code);
  });

  test("凭码 resolve 返回完整卡片；无效码 404", async ({ request }) => {
    const card = await profileCard(carol, { username: "Carol!" });
    const { code } = await (
      await request.post(`${BASE}/pairing/register`, { data: card })
    ).json();
    const res = await request.get(`${BASE}/pairing/resolve?code=${code}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      role: "profile",
      subject: "carol",
      issuer: "carol",
      username: "Carol!",
      signature: card.signature,
    });

    const missing = await request.get(`${BASE}/pairing/resolve?code=zzzzzzzz`);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).ok).toBe(false);
  });

  test("resolve 码大小写不敏感、可带空白", async ({ request }) => {
    const { code } = await (
      await request.post(`${BASE}/pairing/register`, { data: await profileCard(carol) })
    ).json();
    const res = await request.get(
      `${BASE}/pairing/resolve?code=${encodeURIComponent(` ${code.toUpperCase()} `)}`,
    );
    expect(res.status()).toBe(200);
  });

  test("非 profile 卡片 / 非自签卡片被拒绝（422）", async ({ request }) => {
    const notProfile = await issueCert(carol, { role: "editor" });
    expect(
      (await request.post(`${BASE}/pairing/register`, { data: notProfile })).status(),
    ).toBe(422);

    // issuer ≠ subject 的伪卡片
    const fake = await issueCert(carol, { role: "profile", issuer: "carol", subject: "bob" });
    expect(
      (await request.post(`${BASE}/pairing/register`, { data: fake })).status(),
    ).toBe(422);
  });

  test("core getProfile 形态（无 id、无 expire）的卡片可正常取码与解析", async ({ request }) => {
    const card = await payloadCard(carol, { username: "NoIdCarol" });
    const reg = await request.post(`${BASE}/pairing/register`, { data: card });
    expect(reg.status()).toBe(200);
    const { code } = await reg.json();
    const res = await request.get(`${BASE}/pairing/resolve?code=${code}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      role: "profile",
      subject: "carol",
      username: "NoIdCarol",
      signature: card.signature,
    });
  });

  test("自适应码长：活跃码 ≤300 发 6 位；超过后发 8 位且旧 6 位码仍可解析", async ({ request }) => {
    // 低活跃期由独立用户持有 6 位码（carol 稍后要再注册，会作废自己的旧码）
    const holder = await generateUser("short-holder");
    const sixCode = (
      await (
        await request.post(`${BASE}/pairing/register`, { data: await payloadCard(holder) })
      ).json()
    ).code;
    expect(sixCode.length).toBe(6);

    // 注册一批独立用户把有效条目数顶过阈值（同一用户重复提交会被去重替换）
    for (let i = 0; i < 305; i++) {
      const u = await generateUser(`bulk-${i}`);
      const res = await request.post(`${BASE}/pairing/register`, {
        data: await payloadCard(u),
      });
      expect(res.status()).toBe(200);
    }

    const high = await (
      await request.post(`${BASE}/pairing/register`, { data: await profileCard(carol) })
    ).json();
    expect(high.code.length).toBe(8);

    // 新 8 位码可解析
    expect(
      (await request.get(`${BASE}/pairing/resolve?code=${high.code}`)).status(),
    ).toBe(200);
    // 此前签发的 6 位码仍在解读期内，长短混存互不影响
    expect(
      (await request.get(`${BASE}/pairing/resolve?code=${sixCode}`)).status(),
    ).toBe(200);
  });

  test("限流只针对未命中：连续 404 触发 429 后，成功解析不受影响", async ({ request }) => {
    // 灌满失败额度（此前其他用例已有零星失败计数，这里多打一些确保超限）
    let saw429 = false;
    for (let i = 0; i < 45 && !saw429; i++) {
      const res = await request.get(`${BASE}/pairing/resolve?code=dead${i}xx`);
      if (res.status() === 429) saw429 = true;
    }
    expect(saw429).toBe(true);

    // 超限后有效码仍可正常解析（成功不占失败额度，CGNAT 共享 IP 场景关键）
    const { code } = await (
      await request.post(`${BASE}/pairing/register`, { data: await profileCard(carol) })
    ).json();
    expect(
      (await request.get(`${BASE}/pairing/resolve?code=${code}`)).status(),
    ).toBe(200);
  });

  test("篡改后的卡片被验签拦截（422）", async ({ request }) => {
    const card = await profileCard(carol);
    card.username = "evil";
    const res = await request.post(`${BASE}/pairing/register`, { data: card });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toContain("签名验证失败");
  });
});
