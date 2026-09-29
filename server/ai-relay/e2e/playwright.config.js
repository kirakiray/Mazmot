import { defineConfig } from "@playwright/test";

// admin-ui e2e：真实起 ai-relay 服务器（cargo run）+ 仓库静态服务器，
// 浏览器先经根入口安装 NoneOS Core（/gh/ 与 /nos/* 由 SW 提供），再进管理台全链路操作。
// 需要外网下载 Core / CDN 资源时，用 E2E_PROXY 环境变量给浏览器挂代理，如：
//   E2E_PROXY=http://127.0.0.1:8118 npx playwright test
const proxy = process.env.E2E_PROXY
  ? { server: process.env.E2E_PROXY, bypass: "127.0.0.1,localhost" }
  : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: /admin-ui.*\.test\.js/,
  globalSetup: "./global-setup.mjs",
  timeout: 60_000,
  retries: 0,
  workers: 1, // 用例共享同一浏览器上下文（Core 只装一次），必须串行
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    { name: "chrome", use: { browserName: "chromium", proxy } },
  ],
  webServer: [
    {
      // 被测 ai-relay 服务器（独立端口 + 独立数据文件）
      command: "cargo run",
      cwd: "..",
      url: "http://127.0.0.1:18974/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AI_RELAY_PORT: "18974",
        AI_RELAY_DATA: "data/e2e-ui.redb",
        AI_RELAY_ADMIN_TOKEN: "e2e-ui-admin-token",
      },
    },
    {
      // 第二台 ai-relay（多账户保存 / 切换 / 删除用例）
      command: "cargo run",
      cwd: "..",
      url: "http://127.0.0.1:18976/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AI_RELAY_PORT: "18976",
        AI_RELAY_DATA: "data/e2e-ui2.redb",
        AI_RELAY_ADMIN_TOKEN: "e2e-ui-admin-token-2",
        AI_RELAY_SERVER_NAME: "E2E Relay Two",
      },
    },
    {
      // 仓库静态服务器（承载管理台前端与根 Core 引导入口）
      command: "npx http-server . -p 18975 -c-1 --silent",
      cwd: "../../..",
      url: "http://127.0.0.1:18975/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
