# 018 · 宿主未注入 run-tests 通道时，如何本地回放 .test.json（含三条硬限制）

**症状**：`preview action=run-tests` 返回「预览调试不可用：宿主未注入预览通道（请从妙造主界面使用）」，而同一时刻 `action=status` / `eval` 都正常（预览窗口在线、无报错）。也就是说：**通道只缺 run-tests 这一类动作，其它调试动作照常可用**，别误判成「预览整个坏掉」。

**根因**：run-tests 需要宿主在页面里额外注入测试驱动通道；本会话没有注入。但 `eval` 可用，于是可以自己写一个「按同一套步骤语义」的本地驱动来跑用例（本次落在 `client/test/_driver.js`，`run(file, from, to)`：eval 用 `new Function('T', ...)` 执行、reload 步骤返回断点、wait 支持毫秒与选择器、expect 交回宿主校验）。

**三条硬限制（都是实际撞过的）**：
1. **动态 import 的相对路径会解析到 `/bridge/`**：`await import('./test/_driver.js')` 报 `Failed to fetch dynamically imported module: .../bridge/test/_driver.js`（eval 所在的模块 URL 是桥脚本，不是应用页）。必须用绝对 URL：`await import(new URL('./test/_driver.js', location.href).href + '?t=' + Date.now())`（`fetch('./test/x.json')` 不受影响——fetch 相对的是 document）。
2. **单次 eval 总耗时不能超过 30s（长等待要单独占一条指令）**：一条指令里跑完整用例、而用例里有两处 5.8s / 5.9s 倒计时等待时，会以 `调试指令 eval 等待结果超时（30000ms）` 收尾——返回值丢失、只看得到页面已改到一半的状态。**解法：给驱动加 `to` 端点参数，按步骤分片跑**（本次 `trash-purge` 拆成 2–5 / 5–7 / 7–9 / 10– 四片）。
3. **`reload` 必须单独发一条指令**（`location.reload(); return 'reloading'`），不能在同一条里 `await` 后续步骤（reload 会断开调试桥 → 该次指令静默超时，见踩坑 014）。驱动遇到 reload 步骤时返回 `{ reloadAt: i+1 }`，重载后再 `run(file, reloadAt)` 续跑；重载后 `window.__RUN`（即 T）也随页面重置，所以**用例里 reload 之后的步骤必须不依赖 T**（本套用例统一用 `document.querySelector('o-page').shadowRoot` 直查）。

**正确姿势**：先试官方 `action=run-tests`；不可用时按上面三条用 `test/_driver.js` 本地回放，**每个用例都要跑到「最后一步 restore + 无控制台报错」**才算绿。另外：用例开头的 wipe 步骤做了「先备份再清空」，但**失败 / 超时中断时收尾的 restore 步骤不会执行**，用户数据会留在「已清空」状态（本次开场就发现上次运行遗留的 `__todo_test_dirty = "1"` 与空存储，已用备份恢复）——所以跑完必须核对 `localStorage.__todo_test_dirty` 已清、存储里用户数据已回来。
