// ai-relay 管理台 UI e2e：浏览器经仓库根入口安装 NoneOS Core 后打开
// server/ai-relay/admin/，与真实 ai-relay 服务器（webServer 起）全链路联调：
//   连接服务器 → 添加上游 key → 新建用户（配额 / key 池）→ 详情邀请码（解码与
//   服务器 API 交叉校验）→ 清零用量 → 删除用户 → 断开连接。
// 不打真实 AI 上游（管理台操作不触发 chat），可离线跑（装 Core 需要网络，可挂 E2E_PROXY）。
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC = "http://127.0.0.1:18975";
const RELAY = "http://127.0.0.1:18974";
const ADMIN_PAGE = `${STATIC}/server/ai-relay-admin/`;
const TOKEN = "e2e-ui-admin-token";
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
    // 走真实用户路径：根入口 nos-version 自动安装 Core，完成后跳 /apps/main/
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
    await expect(page.locator(".brand-text p")).toHaveText(RELAY);
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

  test("断开连接回到连接页并清空本地凭据", async ({ }, testInfo) => {
    await page
      .locator("st-icon-button", {
        has: page.locator('n-icon[icon="mdi:link-off"]'),
      })
      .click();
    await expect(
      page.locator("st-button", { hasText: "连接" }).first(),
    ).toBeVisible();
    // storage 由页面经 /nos/storage 清除；重连表单应为空
    await expect(page.locator("st-input input").nth(0)).toHaveValue("");
  });
});
