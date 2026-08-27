// 冷数据淘汰专项配置：短保留期实例（与主套件同一个 cargo run，独立端口/数据文件）。
// 由 npm script 在主套件跑完后顺序执行， Playwright 单配置无法按 project 切换 webServer，
// 故拆成两个配置文件串行（见 package.json 的 test 脚本）。
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /retention\.e2e\.test\.js/,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "chrome", use: { browserName: "chromium" } }],
  webServer: {
    command: "cargo run",
    cwd: "..",
    url: "http://127.0.0.1:8791/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CRED_HUB_PORT: "8791",
      CRED_HUB_DATA: "data/e2e-retention-store.redb",
      CRED_HUB_RETENTION_MS: "2000",
    },
  },
});
