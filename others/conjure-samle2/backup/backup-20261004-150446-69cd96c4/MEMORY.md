# MEMORY.md — Hello World

项目记忆体：每回合**有改动**就在下方顶部追加一条（日期 / 改了什么 / 为什么 / 验证结论），最新在最上；纯讨论不记。容量上限 50 条：满 50 先把最旧 20 条压缩成 3–4 条（只留仍生效的决策与约束、用户偏好、未解决待办）。完整规则见 AGENTS.md「记忆体规则」。

## 记录

### 2026-06-04 · 加回法语，语言种数 3 → 4（英 / 中 / 日 / 法）

- **改了什么**：`pages/home.html` 的 `LANGS` 常量在 `ja` 之后追加 `{ id: "fr", flag: "🇫🇷", word: "Bonjour" }`；`CONTEXT.md` 的定位 / 使用指南 / 数据模型（`langs`·`langId`）/ 关键流程 3 同步改为 4 种语言（并把 nextLang 的「其余 2 种」改为「其余 3 种」、气泡数 3 → 4）。`pitfalls/002` 补了两条实测细节（`o-app` shadowRoot 里查不到 `o-page`；滚动测量用 `$deep('.wrap').getRootNode().host`）。逻辑零改动——`o-fill` + `fill-key`、`nextLang()` 的 filter+random 都自适应语言数量。
- **为什么**：用户要求「再增加一个法语」。
- **验证结论**（preview 实测）：`action=app` 刷新正常；`action=eval` 数出 4 个 `span.chip`（🇬🇧 Hello / 🇨🇳 你好 / 🇯🇵 こんにちは / 🇫🇷 Bonjour）；`action=click` 点第 4 个气泡（法语）→ 问候语变「🇫🇷Bonjour, World!」、高亮态落到法语；`action=type` 向 `st-input` 写「Emma」→「🇫🇷Bonjour, Emma!」（随后已清空输入框恢复原状）；`action=click` 点「🎲 换个语言」→ 随机切 en、提示条「已切换为「Hello」」；滚动容器 805/805 无溢出；`action=console` 无应用报错（仅 `[hello]` 定位日志与 `[bridge-link]` 噪声）。

### 2026-06-04 · 语言从 6 种精简为 3 种（英 / 中 / 日）

- **改了什么**：`pages/home.html` 的 `LANGS` 常量删掉 `fr` / `es` / `ko` 三条，只剩 `en` / `zh` / `ja`；`CONTEXT.md` 对应描述（定位 / 使用指南 / 数据模型 `langs`·`langId` / 关键流程）同步改为 3 种。逻辑未动：`nextLang()` 用 filter + 随机、`o-fill` 用 `fill-key` 渲染，均自适应语言数量。
- **为什么**：用户要求「保留英语中文日语就够了」，6 种语言的气泡行偏冗余。
- **验证结论**（preview 实测）：`action=app` 刷新正常；`action=click` 点「🇨🇳 你好」气泡 → 问候语变「🇨🇳你好, World!」、提示条「已切换为「你好」」、高亮态正确；`action=type` 向 `st-input` 写「小美」→「🇨🇳你好, 小美!」；点「🎲 换个语言」→ 随机切到 en 且高亮同步；点「👋 打个招呼」→ 计数 1、emoji 换 😄、提示条出现。气泡数实测 3 个，`action=console` 无应用报错（仅 `[hello]` 定位日志与 `[bridge-link]` 噪声），滚动容器正常（scrollHeight 805 = clientHeight 805，无溢出）。

### 2026-06-03 · 从空项目搭建 Hello World 应用（首个可运行版本）

- **改了什么**：`app.json`（displayName「Hello World」/ icon 👋 / description）、`index.html`（标准 ofa.js 入口骨架）、`app-config.js`（`home = "./pages/home.html"`）、`pages/home.html`（唯一页面：emoji 标题 + `st-input` 输入名字 + 问候语大字 + 「换个语言」/「打个招呼」按钮 + `o-if` 操作提示条 + `o-fill` 6 个语言气泡 + 打招呼计数）；文档 `CONTEXT.md` / `MEMORY.md` / `pitfalls/001`、`002` 填充为真实内容。
- **为什么**：用户要一个简单的 hello world 应用 → 做成可交互的最小示例（输入名字实时改问候语、切语言、打招呼计数），同时把微应用骨架与 M3 配色跑通；状态刻意只放内存，不引入 `/nos/storage`，保持最小实现。
- **验证结论**（preview 实测，非只看代码）：`action=app` 打开正常；`action=console` 无应用报错（仅 `[bridge-link]` 噪声与自埋的 `[hello]` 定位日志）；`action=type` 向 `st-input` 写入「小美」→ 问候语变「🇬🇧Hello, 小美!」；`action=click` 点「🎲 换个语言」→ 语言与高亮气泡同步变为 ja；JS 点击「👋 打个招呼」→ 计数 `0 → 1`、顶部 emoji 换成 ✨、提示条出现「…很高兴见到你 🎉」；`window.__helloReady === true` 确认 `ready()` 生命周期实际执行。
