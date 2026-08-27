import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // 只跑主套件（cred 接口 + 配对码 + 管理 API）；冷数据淘汰用例由 retention.playwright.config.js 单独串行执行
  testMatch: /(cred-hub|pairing|admin)\.e2e\.test\.js/,
  timeout: 15_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "chrome", use: { browserName: "chromium" } }],
  webServer: {
    // 启动被测服务器（独立数据文件，避免污染开发数据）
    command: "cargo run",
    cwd: "..",
    url: "http://127.0.0.1:8790/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CRED_HUB_PORT: "8790",
      CRED_HUB_DATA: "data/e2e-cred-store.redb",
      CRED_HUB_ADMIN_TOKEN: "e2e-admin-token",
    },
  },
});
