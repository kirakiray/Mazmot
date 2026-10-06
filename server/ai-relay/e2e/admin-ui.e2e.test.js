// ai-relay 管理台 UI e2e：浏览器经仓库根入口安装 NoneOS Core 后打开
// server/ai-relay/admin/，与真实 ai-relay 服务器（webServer 起两台）全链路联调：
//   连接服务器 → 添加上游 key → 新建用户（配额 / key 池）→ 详情邀请码（解码与
//   服务器 API 交叉校验）→ 清零用量 → 删除用户 → 断开连接（账户保留）→
//   一键重连 → 添加第二台服务器 → 切换弹窗来回切换 → 删除账户（非活跃 / 活跃）。
// 不打真实 AI 上游（管理台操作不触发 chat），可离线跑（装 Core 需要网络，可挂 E2E_PROXY）。
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC = "http://127.0.0.1:18975";
const RELAY = "http://127.0.0.1:18974";
const RELAY2 = "http://127.0.0.1:18976";
const ADMIN_PAGE = `${STATIC}/server/ai-relay-admin/`;
const TOKEN = "e2e-ui-admin-token";
const TOKEN2 = "e2e-ui-admin-token-2";
const AUTH = { authorization: `Bearer ${TOKEN}` };

// 添加上游 key 现在会做真实上游探测，必须用真 key（根目录 test-api-keys.json）
const { deepseek: REAL_KEY, glmcodingplan: GLM_CODING_KEY } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-api-keys.json"), "utf8"),
);
const REAL_MASKED = `${REAL_KEY.slice(0, 4)}...${REAL_KEY.slice(-4)}`;

const RUN = Date.now().toString(36); // 每轮唯一后缀，数据文件跨轮保留也不冲突
const KEY_LABEL = `e2eui-key-${RUN}`;
const KEY_VALUE = REAL_KEY;
const USER_NAME = `e2eui-user-${RUN}`;


// senti confirm 弹窗的确认按钮为插槽文本，Playwright actionability 判定不过；
// 用穿 shadow DOM 的 JS 点击触发真实 click 事件（处理链路与用户点击一致）
const clickDialogButton = async (page, textRe) => {
  await page.evaluate((pattern) => {
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const hit = walk(el.shadowRoot);
          if (hit) return hit;
        }
        const own = el.childNodes.length
          ? [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim())
              .join("")
          : "";
        if (pattern.test(own)) {
          el.click();
          return el;
        }
      }
      return null;
    };
    walk(document);
  }, textRe.source ? new RegExp(textRe.source, textRe.flags) : textRe);
};

test.describe.serial("ai-relay 管理台 × 真实服务器", () => {
  let page;
  let context;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test("根入口安装 NoneOS Core 并打开管理台连接页", async () => {
    test.setTimeout(180_000);
    // 走真实用户路径：根入口 nos-version 自动安装 Core，完成后进入主应用 /
    await page.goto(`${STATIC}/`);
    await page.waitForURL(/apps\/main/, { timeout: 150_000 });

    await page.goto(ADMIN_PAGE);
    // 连接页出现「连接」按钮即代表 ofa.js / senti-ui / 页面模块经 Core SW 全部就绪
    await expect(
      page.locator("st-button", { hasText: "连接" }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("连接服务器进入管理面板", async () => {
    const inputs = page.locator("st-input input");
    await inputs.nth(0).fill(RELAY);
    await inputs.nth(1).fill(TOKEN);
    await page.locator("st-button", { hasText: "连接" }).first().click();

    // 连接成功后连接表单消失、品牌区显示服务器地址、tab 面板出现
    await expect(page.locator("st-button", { hasText: "上游 API Key" })).toBeVisible();
    await expect(page.locator(".brand-text p")).toContainText(RELAY);
  });

  test("添加上游 API Key（弹窗内添加，masked 展示不回明文）", async () => {
    // 列表卡片右上角「添加 Key」按钮 → 弹窗内填写
    await page.locator("st-button", { hasText: /添加 Key|Add Key/ }).click();
    const dialog = page.locator("st-dialog.dlg-key");
    await dialog.locator("st-input input").nth(0).fill(KEY_LABEL);
    await dialog.locator("st-input input").nth(1).fill(KEY_VALUE);
    await dialog.locator("st-button", { hasText: /添加|Add/ }).click();

    await expect(
      page.locator("st-list-item", { hasText: KEY_LABEL }),
    ).toBeVisible();
    await expect(
      page.locator("st-list-item", { hasText: REAL_MASKED }).first(),
    ).toBeVisible();
  });

  test("新建用户（配额 + 勾选 key 池）", async () => {
    // 当前在「上游 API Key」页，先切到用户页（用户页 tab；「新建用户」按钮此时未渲染）
    await page.locator("st-button").filter({ hasText: "用户" }).first().click();
    await page.locator("st-button", { hasText: "新建用户" }).click();
    const dialog = page.locator("st-dialog.dlg-user");
    await dialog.locator("st-input input").nth(0).fill(USER_NAME);
    await dialog.locator("st-input input").nth(1).fill("e2e ui user");
    // 配额带单位：先填 500 token，切 k 后输入框应自动换算为 0.5（绝对量不变）
    await dialog.locator("st-input input").nth(2).fill("500");
    await dialog
      .locator("st-select")
      .first()
      .evaluate((el) => {
        el.value = "k";
        el.dispatchEvent(new Event("change"));
      });
    await expect(dialog.locator("st-input input").nth(2)).toHaveValue("0.5");
    // 再填 500 → 500 k = 500,000 token
    await dialog.locator("st-input input").nth(2).fill("500");
    // 勾选唯一可选的上游 key
    await dialog.locator("st-checkbox").first().click();
    await dialog.locator("st-button", { hasText: "创建" }).click();

    await expect(
      page.locator("st-list-item", { hasText: USER_NAME }).first(),
    ).toBeVisible();

    // 与服务器交叉校验：配额 / key 池确实落库
    const res = await fetch(`${RELAY}/admin/users`, { headers: AUTH });
    const user = (await res.json()).data.users.find((u) => u.name === USER_NAME);
    expect(user.quotaTokens).toBe(500000);
    expect(user.usedTokens).toBe(0);
    expect(user.apiKeyIds.length).toBe(1);
  });

  test("详情弹窗邀请码可解码且与服务器 bearkey 一致", async () => {
    // 限定在本轮创建的用户条目内点详情（数据文件跨轮保留，列表里可能有历史用户）
    await page
      .locator("st-list-item", { hasText: USER_NAME })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon*="text-box-search"]'),
      })
      .click();
    const code = await page.locator(".invite-code-box .mono").textContent();
    expect(code.length).toBeGreaterThan(20);

    // 按客户端同款解法解出 serverUrl + bearkey
    const payload = JSON.parse(
      Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    expect(payload.u).toBe(RELAY);

    const res = await fetch(`${RELAY}/admin/users`, { headers: AUTH });
    const user = (await res.json()).data.users.find((u) => u.name === USER_NAME);
    // 用户列表接口不回 bearkey，用 invite 接口交叉校验
    const inviteRes = await fetch(`${RELAY}/admin/users/${user.id}/invite`, {
      headers: AUTH,
    });
    expect(payload.k).toBe((await inviteRes.json()).data.bearkey);

    // 最近用量区已渲染（暂无记录）
    await expect(page.locator(".invite-code-box")).toBeVisible();
    await page.locator("st-dialog.dlg-invite st-button", { hasText: "关闭" }).click();
  });

  test("详情弹窗内编辑配额与可用 key 池并保存", async () => {
    // 服务器侧再加一个上游 key，形成「勾选切换」的空间
    const mk = await fetch(`${RELAY}/admin/apikeys`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ provider: "glm-coding", label: `e2eui-key2-${RUN}`, apiKey: GLM_CODING_KEY }),
    });
    const key2Id = (await mk.json()).data.id;

    await page
      .locator("st-list-item", { hasText: USER_NAME })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon*="text-box-search"]'),
      })
      .click();
    const dialog = page.locator("st-dialog.dlg-invite");
    await expect(dialog).toBeVisible();

    // 白名单填 glm-4.7*（通配），保存后服务端校验
    await dialog.locator("st-textarea textarea").fill("glm-4.7*");

    // 改配额：详情回填为 500k，切回 token 单位应自动换算为 500000，再改填 777
    await dialog
      .locator("st-select")
      .first()
      .evaluate((el) => {
        el.value = "token";
        el.dispatchEvent(new Event("change"));
      });
    await expect(dialog.locator("st-input input").nth(0)).toHaveValue("500000");
    await dialog.locator("st-input input").nth(0).fill("777");

    // 换绑：取消勾选 key1，勾选 key2
    const boxes = dialog.locator("st-checkbox");
    await expect(boxes).toHaveCount(2);
    await boxes.nth(0).click(); // 取消 key1
    await boxes.nth(1).click(); // 勾选 key2

    await dialog.locator("st-button", { hasText: /保存修改|Save changes/ }).click();

    // 服务器侧校验
    let user;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${RELAY}/admin/users`, { headers: AUTH });
      user = (await res.json()).data.users.find((u) => u.name === USER_NAME);
      if (user.quotaTokens === 777) break;
      await page.waitForTimeout(300);
    }
    expect(user.quotaTokens).toBe(777);
    expect(user.apiKeyIds).toEqual([key2Id]);
    expect(user.allowedModels).toEqual(["glm-4.7*"]);
    await dialog.locator("st-button", { hasText: /关闭|Close/ }).click();
  });

  test("清零用量：确认弹窗后用户用量归零", async () => {
    // 清零按钮在主行 suffix（mdi:restart 图标）
    await page
      .locator("st-list-item", { hasText: USER_NAME })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:restart"]'),
      })
      .click();
    await clickDialogButton(page, /^(清零|Reset)$/);

    // 等服务器侧归零生效
    let used = -1;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${RELAY}/admin/users`, { headers: AUTH });
      const user = (await res.json()).data.users.find((u) => u.name === USER_NAME);
      used = user.usedTokens;
      if (used === 0) break;
      await page.waitForTimeout(300);
    }
    expect(used).toBe(0);
  });

  test("删除用户（确认弹窗）后列表与服务器同步移除", async () => {
    await page
      .locator("st-list-item", { hasText: USER_NAME })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:delete-outline"]'),
      })
      .click();
    await clickDialogButton(page, /^(删除|Delete)$/);

    await expect(
      page.locator("st-list-item", { hasText: USER_NAME }),
    ).toHaveCount(0);
    const res = await fetch(`${RELAY}/admin/users`, { headers: AUTH });
    const users = (await res.json()).data.users;
    expect(users.find((u) => u.name === USER_NAME)).toBeUndefined();
  });

  test("服务器设置弹窗改名并同步服务端", async () => {
    await page.locator('st-icon-button', {
      has: page.locator('n-icon[icon="mdi:cog-outline"]'),
    }).click();
    const dlg = page.locator("st-dialog.dlg-settings");
    await expect(dlg).toBeVisible();
    const name = `UI Relay ${RUN}`;
    await dlg.locator("st-input input").fill(name);
    await dlg.locator("st-button", { hasText: /保存|Save/ }).click();

    // 品牌副标题展示新命名；服务端 /v1/server 一致
    await expect(page.locator(".brand-text p")).toContainText(name);
    const info = await fetch(`${RELAY}/v1/server`).then((r) => r.json());
    expect(info.name).toBe(name);
  });

  test("断开连接回连接页，账户保留在已保存列表", async () => {
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:link-off"]'),
      })
      .click();
    // 二次确认弹窗（误触防护）
    await clickDialogButton(page, /^(断开|Disconnect)$/);
    await expect(
      page.locator("st-button", { hasText: "连接" }).first(),
    ).toBeVisible();
    // 账户凭据保留（供一键重连 / 切换），仅表单清空
    await expect(page.locator("st-list-item", { hasText: RELAY })).toBeVisible();
    await expect(page.locator("st-input input").nth(0)).toHaveValue("");
  });

  test("点已保存账户一键重连", async () => {
    await page.locator("st-list-item", { hasText: RELAY }).first().click();
    await expect(
      page.locator("st-button", { hasText: "上游 API Key" }),
    ).toBeVisible();
    await expect(page.locator(".brand-text p")).toContainText(RELAY);
  });

  test("添加第二台服务器账户", async () => {
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:link-off"]'),
      })
      .click();
    await clickDialogButton(page, /^(断开|Disconnect)$/);
    const inputs = page.locator("st-input input");
    await inputs.nth(0).fill(RELAY2);
    await inputs.nth(1).fill(TOKEN2);
    await page.locator("st-button", { hasText: "连接" }).first().click();

    // 面板副标题展示第二台服务器命名 + 地址（env AI_RELAY_SERVER_NAME 初始值）
    await expect(page.locator(".brand-text p")).toContainText("E2E Relay Two");
    await expect(page.locator(".brand-text p")).toContainText(RELAY2);
    // 连接页此前已有第一台的账户，此时共两个
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:swap-horizontal"]'),
      })
      .click();
    const dlg = page.locator("st-dialog.dlg-switch");
    await expect(dlg.locator("st-list-item")).toHaveCount(2);
  });

  test("切换弹窗标记当前账户，可来回切换且服务器状态独立", async () => {
    const dlg = page.locator("st-dialog.dlg-switch");
    // 当前连接在第二台：带「当前」标记
    await expect(
      dlg.locator("st-list-item", { hasText: RELAY2 }).locator(".rounds-chip"),
    ).toContainText("当前");

    // 切回第一台
    await dlg.locator("st-list-item", { hasText: RELAY }).first().click();
    await expect(page.locator(".brand-text p")).toContainText(RELAY);

    // 再切到第二台
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:swap-horizontal"]'),
      })
      .click();
    await page
      .locator("st-dialog.dlg-switch st-list-item", { hasText: RELAY2 })
      .first()
      .click();
    await expect(page.locator(".brand-text p")).toContainText(RELAY2);

    // 两台服务器状态各自独立：第一台命名是设置弹窗改的，第二台是 env 初始值
    const info1 = await fetch(`${RELAY}/v1/server`).then((r) => r.json());
    expect(info1.name).toBe(`UI Relay ${RUN}`);
    const info2 = await fetch(`${RELAY2}/v1/server`).then((r) => r.json());
    expect(info2.name).toBe("E2E Relay Two");
  });

  test("删除非活跃账户：列表移除且不影响当前连接", async () => {
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:swap-horizontal"]'),
      })
      .click();
    const dlg = page.locator("st-dialog.dlg-switch");
    await dlg
      .locator("st-list-item", { hasText: RELAY })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:delete-outline"]'),
      })
      .click();
    await clickDialogButton(page, /^(删除|Delete)$/);

    await expect(dlg.locator("st-list-item", { hasText: RELAY })).toHaveCount(0);
    // 仍连接在第二台上
    await expect(page.locator(".brand-text p")).toContainText(RELAY2);
  });

  test("删除当前连接的账户：断开回连接页且列表清空", async () => {
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:swap-horizontal"]'),
      })
      .click();
    const dlg = page.locator("st-dialog.dlg-switch");
    await dlg
      .locator("st-list-item", { hasText: RELAY2 })
      .first()
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:delete-outline"]'),
      })
      .click();
    await clickDialogButton(page, /^(删除|Delete)$/);

    await expect(
      page.locator("st-button", { hasText: "连接" }).first(),
    ).toBeVisible();
    await expect(page.locator("st-list-item", { hasText: RELAY2 })).toHaveCount(0);
  });
});
