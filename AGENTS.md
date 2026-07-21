# AI 代理开发指南 (AGENTS.md)

本文件为参与此项目开发的 AI 代理提供核心技术栈上下文和开发规范。在开始任何开发任务前，请务必遵循以下准则。

## 核心技术架构

- **底层架构 (Base Layer)**：基于 `noneos-core` 开发。
  - 涉及文件系统、用户管理及服务通信时，请参考 `noneos-core-docs` 知识库。
- **应用框架 (Application Layer)**：基于 `ofa.js` 开发。
  - 进行组件开发、路由配置或状态管理时，请参考 `ofajs-docs` 知识库。

## 依赖 URL 规范

ofa.js / ofa.js router / Punch-UI 的 CDN URL 必须统一，避免版本碎片化。

- **ofa.js**：入口 HTML 与页面/组件模块的前缀不同，见下方「按加载位置区分前缀」。
  - 必须带 `#debug`，开发期保留调试信息
  - 顶层入口 HTML（如 `index.html` / `apps/*/index.html`）可酌情锁定具体版本（如 `@4.7.1`）；组件 / 页面模块 / 测试页一律用 `@latest`
- **ofa.js router**：路径 `ofajs/ofa.js/libs/router/dist/router.min.mjs`（无版本号，跟随主仓库），前缀同样按加载位置区分。
- **Punch-UI**：统一使用 `https://punch-ui-v2.pages.dev/packages/<component>/<component>.html`（CSS 用 `.../css/pui-global.css`，工具函数用 `.../util.js`）

### 按加载位置区分前缀（重要）

同一份 ofa.js 仓库资源，**加载位置不同，前缀不同**：

- **顶层入口 HTML**（`index.html` / `apps/*/index.html`）：必须使用 `https://cdn.jsdelivr.net/gh/ofajs/...`
  - 入口 HTML 加载时 NoneOS Core Service Worker 可能尚未注册，`/gh/`、`/npm/` 本地前缀不可用，因此走 jsdelivr 完整 URL。
  - 例：`https://cdn.jsdelivr.net/gh/ofajs/ofa.js@4.7.1/dist/ofa.mjs#debug`
- **页面模块 / 组件模块 / 普通模块 / 测试页**：必须使用 `/gh/`（或 `/npm/`）本地前缀，由 NoneOS Core Service Worker 拦截（离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net`。
  - 例：`/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`、`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`

> ofa.js 仓库资源（`ofa.mjs` / router 等）版本必须统一（入口锁版本、模块用 `@latest`），禁止使用 `cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs`（无版本）等历史写法；也禁止在页面/组件模块里写死 jsdelivr 完整 URL。

## NoneOS Core 依赖加载

`/nos/*` 模块（`/nos/fs/main.js`、`/nos/user/main.js`、`/nos/publish/data-publisher.js` 等）由 NoneOS Core Service Worker 提供，**加载时机受 Core 是否就绪约束**。不同位置允许的写法不同：

- **顶层入口 HTML**（如 [index.html](index.html)、[apps/main/index.html](apps/main/index.html)、[apps/network/index.html](apps/network/index.html)）
  - 可以用顶层 `await import("/nos/xxx/main.js")` 做 Core 检测；失败时 `location.href = "/?redirect=..."` 回根入口升级。
- **`app-config.js`**
  - 如果该入口对应的页面**确信 Core 已就绪**（比如紧跟入口 HTML 的校验），允许顶层 `await init("mazmot")`，参考 [apps/main/app-config.js](apps/main/app-config.js)。
  - 如果该入口的页面模块会自己装 Core（如 [apps/run-app/app-config.js](apps/run-app/app-config.js)），**禁止**在 `app-config.js` 顶层调用 `init()` 或 import `/nos/*`。
- **页面模块 / 普通模块 / 组件**
  - 顶层**禁止** `import "/nos/*"`；必须用 `const load = lm(import.meta); await load("/nos/xxx/main.js")` 在 `attached` 或运行时按需加载。
  - 参考实现：[apps/run-app/run-app.html](apps/run-app/run-app.html) 的 Core 就绪 Promise + `load(...)` 并行加载模式。

> 违反这条规则最典型的现象：首次访问或 Core 升级后白屏，因为模块加载早于 Core 注册 SW。

## UI 与视觉规范

- **组件库**：项目深度集成 `punch-ui` 组件库。
- **视觉系统**：严格遵循 `punch-ui` 的颜色方案与设计语言。
- **开发参考**：在实现 UI 相关功能前，请查阅 `punch-ui` 知识库以保持风格一致性。
- **图标**：业务代码统一使用 `<n-icon icon="mdi:xxx">`（由 NoneOS Core 提供，底层基于 `iconify-icon` 实现）。
  - **禁止**业务代码直接调用 `iconify-icon` 的 API 或将其作为依赖加载（`n-icon` 会按需加载底层运行时）。
  - CSS 子选择器统一引用 `n-icon` 标签名（如 `.step-circle n-icon { ... }`），保持与业务代码一致的封装层级，避免直接触碰底层渲染节点。
  - 新增页面 / 组件应通过 `<l-m src="/nos/n-icon/n-icon.html"></l-m>` 显式声明依赖。

## 开发指令

1. **先读 Skill**：在编写代码或提供建议前，必须先检索并阅读上述对应的 Skill 文档。
2. **遵循模式**：优先采用框架推荐的最佳实践，确保与现有代码库的风格一致。
3. **架构对齐**：所有改动需符合 `noneos-core` 与 `ofa.js` 的设计哲学。更多项目细节请参考 [CONTEXT.md](CONTEXT.md)。
4. **同步更新 Context（强制）**：发生以下任一变更时，**必须同步更新** [CONTEXT.md](CONTEXT.md) 对应章节，不得事后补：
   - 新增 / 删除 / 重命名任何文件或目录（→ 同步目录树与"关键代码文件速查"表）
   - 修改公开 API / 模块导出 / 页面 proto 方法签名（→ 同步"关键代码文件速查"或新增小节）
   - 修改数据结构字段（`apps[]` 持久化字段、payload 结构、manifest 字段等）（→ 同步"数据模型"）
   - 修改关键流程（应用生命周期、分享接收流程、Core 加载顺序等）（→ 同步对应流程图/步骤描述）
   - 新增 / 删除一个应用（apps/<name>/）或组件（comps/<name>/）
5. **禁止历史冗余**：[CONTEXT.md](CONTEXT.md) 只记录当前架构与活跃流程，禁止写入改造前/已废弃/一次性迁移/未来幻想等历史冗余信息。如需保留历史决策，写入 git 提交信息或独立历史文档，不要污染上下文。
6. **禁止使用 file 协议路径**：文档、注释、配置中的文件引用统一使用相对路径或仓库内可解析的路径（如 `AGENTS.md`、`apps/main/home.html`），禁止使用 `file://` 等本地绝对路径，避免在不同机器上失效。
7. **补充上下文**：若发现 [CONTEXT.md](CONTEXT.md) 中存在信息缺失，应及时补充完善。

## 目录与文件放置规则

不同类型的文件有约定位置，新增内容前请对号入座：

- **新应用**：放在 [apps/](apps/) 下，目录名即 URL 路径（`apps/<name>/` = `/apps/<name>/`）；同时更新 [CONTEXT.md](CONTEXT.md) 目录树。
- **新系统级组件**：放在 [comps/](comps/) 下，独立子目录 + `<tag>.html` + `README.md`（推荐带 `demo.html`）；**必须同步更新 [comps/CONTEXT.md](comps/CONTEXT.md)** 的目录树与组件说明，若被主系统使用也需更新根 [CONTEXT.md](CONTEXT.md)。
- **新应用模板**：在 [apps/main/home/templates/](apps/main/home/templates/) 下建 `<id>/` 子目录，含 `__files.json` + 源文件；**必须在 [templates/manifest.json](apps/main/home/templates/manifest.json) 里登记** id / name / desc。
- **测试**：`<被测模块所在目录>/test/<被测模块同名>.sb.html`，详见上方"测试规范"。
- **业务工具库**：`apps/<app>/lib/`（参考 [apps/main/lib/](apps/main/lib/)、[apps/run-app/lib/](apps/run-app/lib/)），与 UI 页面模块分离，便于单测。
- **不参与新逻辑的目录**：[old/](old/)（v1-v4 历史版本）、[others/](others/)（实验性测试页）、[ai/](ai/)（独立子项目）。修改这些目录前请先与开发者确认，AI 默认应忽略。


## 测试规范

- **客户端测试框架**：项目使用 `sibyl-test` 作为客户端测试框架，测试用例以 `.sb.html` 文件形式编写。
- **测试义务**：开发完功能或组件后，应在其所在目录补充编写对应的 `.sb.html` 测试文件。
- **测试位置**：测试文件应跟随被测组件或页面模块存放，推荐在 `lib/`（或被测模块同级）下建 `test/` 子目录，文件名与被测模块同名（如 `run-app-utils.sb.html` 测试 `run-app-utils.js`）。
- **执行前确认**：写完测试文件后，不要急于自动执行测试，应先询问开发者是否让 AI 执行自动化测试并根据反馈自动修复模块。
- **快速反馈**：开发者同意后，优先使用 `npx sb-test -f <目标测试文件>.sb.html --browsers chrome` 在 Chrome 中快速测试，根据结果动态修复代码。
- **完整测试**：执行 `npm test`（即 `sb-test`）启动默认多浏览器测试流程。
- **CI**：[.github/workflows/test.yml](.github/workflows/test.yml) 会在 `push` / `pull_request` 到 main/master 时，通过 `ofajs/sibyl-test@v1` action 跑 **Chrome（Ubuntu）/ Firefox（Ubuntu）/ WebKit（macOS）** 三浏览器矩阵。修改测试或被测代码前请意识到：在一种浏览器下通过不等于全绿。
- **查阅 Skill**：在编写、修改或调试 `.sb.html` 测试前，必须先查阅 `sibyl-test` Skill 文档。


## P2P 分享关键约束

应用分享基于 NoneOS Core `DataPublisher`（点对点，无后端）。修改分享相关代码必须遵守：

- **只支持 UTF-8 文本文件**：[share-mgr.js](apps/main/lib/share-mgr.js) 的 `readAppFiles` 把每个文件按文本读取后塞进 JSON。二进制资源（图片、字体、音视频等）目前**不可分享**，扩展方向是给 `app.json` 文件清单加 `encoding: "base64"` 字段，不要绕过这个约定私自塞 base64 进 payload。
- **发布者必须在线**：接收端通过 `?u=<userId>&h=<payloadHash>` 短链接从发布者 IndexedDB 拉取 chunk。发布者标签页（`apps/main/`）一旦关闭，未拉完的 chunk 无法继续。设计分享相关 UI（如关闭提醒、断网重试）时以此为前提。
- **URL 字段固定**：分享链接**只有 `u` 和 `h` 两个 query 参数**，其他历史格式（`?p=`、`?data=` 等）已废弃。修改 [share-mgr.js](apps/main/lib/share-mgr.js) 的 `buildRunUrl` / `parseShareUrl` 前请先评估向后兼容。
- **签名链不可省**：接收端验证顺序为 `connectUser` → `requestManifest`（内部 `verifyData`）→ `requestChunk`（内部 SHA-256）→ 显式 `isPublicKeyOfUser`。任何一步失败即进错误页，**不要**用 try/catch 吞错。


## 技能资源与导入 (Skill Resources)

若本地环境中缺少相关知识库，请通过以下链接获取最新版本：

- **ofa.js-docs**
  - [GitHub 在线源码](https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/ofa.js/refs/heads/main/skills/ofajs-docs.zip)
- **punch-ui-docs**
  - [GitHub 在线源码](https://github.com/ofajs/Punch-UI/tree/v2/skills/punch-ui)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/Punch-UI/refs/heads/v2/skills/punch-ui.zip)
- **noneos-core-docs**
  - [GitHub 在线源码](https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/kirakiray/noneos-core/refs/heads/main/skills/noneos-core-docs.zip)
- **ever-cache**
  - 涉及存储数据（如 localStorage）时，应优先使用 EverCache 替代原生存储方案。
  - 使用前请检查本地是否有 ever-cache Skill，若无则需导入。
  - [Skill 在线文件](https://github.com/kirakiray/ever-cache/blob/main/skills/ever-cache/SKILL.md)
- **sibyl-test**
  - 该项目使用 `sibyl-test` 作为测试模块。
  - 使用前请检查本地是否有 sibyl-test Skill，若无则需导入。
  - [Skill 在线文件](https://raw.githubusercontent.com/ofajs/sibyl-test/refs/heads/main/skills/sibyl-test/SKILL.md)

### ⚠️ 导入注意事项

导入技能包时，若压缩包内包含 `references` 与 `assets` 目录，**必须完整导入这两个目录下的全部文件**。前者存储核心技术细节文档，后者包含示例资源、素材等补充材料，任何遗漏都会导致技能知识库残缺，直接影响开发流程的准确性与效率。
