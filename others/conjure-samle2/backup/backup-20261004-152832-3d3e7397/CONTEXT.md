# CONTEXT.md — Hello World

项目上下文（**活文档**）：项目事实与使用指南。维护规则见 AGENTS.md「文档同步规则」——代码怎么变，本文件就怎么改。

## 一句话定位

一个最小可用的 ofa.js + senti-ui 示例应用（无构建步骤）：展示「Hello, World!」问候语，用户可以输入自己的名字、在 5 种语言（英 / 中 / 日 / 法 / 德）间切换问候语、点按钮打声招呼，用来验证微应用骨架（入口 / 路由 / 页面模块 / M3 配色）是否跑通。

## 使用指南

单页应用，页面垂直居中，从上到下依次是：

- **顶部**：emoji + `Hello, World!` 标题 + 一行副标题；
- **主卡片（st-card，`variant="outlined"`）**：
  - `st-input` 输入框 —— 输入名字后，下方问候语实时变为「问候词, 名字!」（留空时用 `World`）；
  - 问候语大字 —— 前面跟当前语言的国旗 emoji；
  - st-button「🎲 换个语言」—— 从其余 4 种语言里随机切一种；
  - st-button「👋 打个招呼」（`variant="outlined"`）—— 打招呼次数 +1、顶部 emoji 随机换一个；
  - 操作提示条（`o-if` 条件渲染）—— 显示最近一次操作结果，2.4 秒后自动消失；
- **语言气泡行（`o-fill` 渲染）**：5 个国旗+问候语气泡（🇬🇧 Hello / 🇨🇳 你好 / 🇯🇵 こんにちは / 🇫🇷 Bonjour / 🇩🇪 Hallo），点击即切换该语言，当前语言的气泡为高亮态（`class:is-active`）；
- **底部**：`已打招呼 N 次` 统计。

数据都在内存里，刷新即重置，无持久化。

## 目录结构

```
client/
├── app.json          # 应用元信息（displayName「Hello World」/ icon 👋 / description）
├── index.html        # 入口：ofa.js + router + senti-ui boot，o-router fix-body 包 o-app
├── app-config.js     # 只导出 home = "./pages/home.html"
└── pages/
    └── home.html     # 唯一页面模块：问候语卡片 + 语言气泡 + 打招呼计数
```

## 数据模型

无持久化（未使用 `/nos/storage`），页面 `data` 全为内存状态：

| 字段 | 类型 | 含义 |
| ---- | ---- | ---- |
| `langs` | `{id, flag, word}[]` | 5 种问候语字典（模块常量 `LANGS`：英 / 中 / 日 / 法 / 德），`fill-key="id"` 用于 `o-fill` |
| `langId` | string | 当前语言 id（`en` / `zh` / `ja` / `fr` / `de`） |
| `flag` / `word` | string | 当前语言的国旗 emoji 与问候词（由 `refresh()` 同步，供模板直接插值） |
| `name` | string | 用户输入的名字（`st-input` 的 `input` 事件写入，空值按 `World` 处理） |
| `greeting` | string | 完整问候语 `${word}, ${who}!`，由 `refresh()` 计算 |
| `emoji` | string | 顶部大 emoji，`sayHello()` 时从 `EMOJIS` 随机换一个 |
| `bumpTimes` | number | 打招呼次数，底部统计用 |
| `hint` | string | 操作提示文案，`showHint()` 写入，2.4s 后清空（模块级 `hintTimer` 负责防抖） |

## 关键流程

1. **启动**：`index.html` → `<o-router fix-body>` → `<o-app src="./app-config.js">` → `app-config.js` 的 `home` → 渲染 `pages/home.html`（渲染后 `ready()` 打定位日志并置 `window.__helloReady = true`）。
2. **改名换问候**：`st-input` 触发 `input` → `onNameInput($event)` 写 `data.name` → `refresh()` 依据 `langId` 重算 `flag` / `word` / `greeting`。
3. **切换语言**：点语言气泡 → `pickLang($data.id)`（`o-fill` 内，共 5 个气泡）或点「换个语言」→ `nextLang()`（在其余 4 种语言里随机取一个）→ `refresh()` + `showHint()`；高亮态由 `class:is-active="$data.id === $host.langId"` 驱动。
4. **打招呼**：点「打个招呼」→ `sayHello()` → `bumpTimes++`、`emoji` 随机替换、`showHint(问候语 + 欢迎语)`。

> 以上 2–4 三条即「完成标准」里必须实测的核心链路。

## 踩坑索引

> 一坑一文件收在 `pitfalls/` 目录（命名与格式见 `pitfalls/README.md`）；本表只放索引，禁止把坑的正文写进本表。使用方式：按标题判断与本回合任务是否相关，命中才精读对应文件。

| 编号 | 标题 | 文件 |
| ---- | ---- | ---- |
| 001 | preview 里向 senti-ui 输入框打字必须选中宿主标签，不能穿透到内部原生 input | `pitfalls/001-preview-type-senti-ui-host.md` |
| 002 | 取当前页面 / 诊断渲染要查 `o-app > o-page`（本版本 `$('o-app').current` 为 undefined，o-page 是 o-app 的插槽子节点） | `pitfalls/002-ofa-app-current-undefined.md` |
| 003 | `action=app` 推送刷新后紧接着 `action=eval` 会超时，重试一次即可 | `pitfalls/003-preview-eval-timeout-after-push.md` |
