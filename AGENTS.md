# AI 代理开发指南 (AGENTS.md)

本文件为参与此项目开发的 AI 代理提供核心技术栈上下文和开发规范。在开始任何开发任务前，请务必遵循以下准则。

## 核心技术架构

- **底层架构 (Base Layer)**：基于 `noneos-core` 开发。
  - 涉及文件系统、用户管理及服务通信时，请参考 `noneos-core-docs` 知识库。
- **应用框架 (Application Layer)**：基于 `ofa.js` 开发。
  - 进行组件开发、路由配置或状态管理时，请参考 `ofajs-docs` 知识库。

## 依赖 URL 规范

ofa.js / ofa.js router / Senti-UI 的 CDN URL 必须统一，避免版本碎片化。

- **ofa.js**：除 Core 引导入口（根 `index.html` 与 `apps/run-app/` 下所有文件）外一律使用 `/gh/` 本地前缀，见下方「按加载位置区分前缀」。
  - 必须带 `#debug`，开发期保留调试信息
  - 根 `index.html` 与 `apps/run-app/` 走 jsdelivr 完整 URL，根入口可锁定具体版本（如 `@4.7.1`）；其余入口 / 组件 / 页面模块 / 测试页一律用 `/gh/...@latest`
- **ofa.js router**：路径 `ofajs/ofa.js/libs/router/dist/router.min.mjs`（无版本号，跟随主仓库），前缀同样按加载位置区分。
- **Punch-UI（已废弃，逐步退出）**：**新代码一律禁止引入**。仅维护存量 punch-ui 代码时允许继续使用既有 URL（`https://punch-ui-v2.pages.dev/packages/<component>/<component>.html`，CSS 用 `.../css/pui-global.css`，工具函数用 `.../util.js`），并应趁机迁移到 senti-ui，禁止引入其他来源的 punch-ui 资源
- **Senti-UI**：统一走 `/gh/ofajs/senti-ui@latest/packages/...`（本地前缀，由 NoneOS Core Service Worker 拦截，离线可用；**始终用 `@latest`，不锁定版本**）；**例外**：根 `index.html` 与 `apps/run-app/` 下所有文件（含 `apps/run-app/index.html` 的主题引导 `.../packages/boot/st-boot.js`、`run-app.html` 的组件引用）用完整 jsdelivr URL（`https://cdn.jsdelivr.net/gh/ofajs/senti-ui@latest/...`，加载时 SW 可能尚未注册），其余所有文件（含其他入口 HTML 与页面模块）一律 `/gh/`。禁止混用无版本裸路径或其他来源的 senti-ui 资源

### 按加载位置区分前缀（重要）

同一份 ofa.js 仓库资源，**仅根 `index.html` 与 `apps/run-app/` 下所有文件可用 jsdelivr 完整 URL，其余一律 `/gh/` 本地前缀**：

- **Core 引导入口（仅此两处）**：根目录 [index.html](index.html) 与 [apps/run-app/](apps/run-app/) 下所有文件（含 [run-app.html](apps/run-app/run-app.html)），使用 `https://cdn.jsdelivr.net/gh/ofajs/...` 完整 URL。
  - run-app 是自装 Core 的首访入口，其页面（进度 / 确认安装 UI）可能在 NoneOS Core SW 注册前渲染，`/gh/`、`/npm/` 本地前缀不可用，因此整个目录统一走 jsdelivr 完整 URL（根入口可锁定具体版本，如 `@4.7.1`）。
  - 例：`https://cdn.jsdelivr.net/gh/ofajs/ofa.js@4.7.1/dist/ofa.mjs#debug`
- **其余所有文件**（`apps/main/index.html`、`apps/network/index.html`、`official-apps/*/index.html`、模板应用等其他入口 HTML，以及全部页面模块 / 组件模块 / 普通模块 / 测试页）：必须使用 `/gh/`（或 `/npm/`）本地前缀，由 NoneOS Core Service Worker 拦截（离线可用、跨域安全），**禁止**写死 `https://cdn.jsdelivr.net`。
  - 这些入口均先经根引导入口装好 Core 再进入，SW 必定就绪，`/gh/` 可用；入口 HTML 自身的 Core 就绪校验（`await import("/nos/xxx/main.js")`）同样依赖 SW，二者一致。
  - 例：`/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`、`/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`

> ofa.js 仓库资源（`ofa.mjs` / router 等）版本必须统一（入口锁版本、模块用 `@latest`），禁止使用 `cdn.jsdelivr.net/gh/ofajs/ofa.js/dist/ofa.mjs`（无版本）等历史写法；也禁止在页面/组件模块里写死 jsdelivr 完整 URL。

## NoneOS Core 依赖加载

`/nos/*` 模块（`/nos/fs/main.js`、`/nos/user/main.js`、`/nos/storage/main.js`、`/nos/publish/data-publisher.js` 等）由 NoneOS Core Service Worker 提供，**加载时机受 Core 是否就绪约束**。不同位置允许的写法不同：

- **顶层入口 HTML**（如 [index.html](index.html)、[apps/main/index.html](apps/main/index.html)、[apps/network/index.html](apps/network/index.html)）
  - 可以用顶层 `await import("/nos/xxx/main.js")` 做 Core 检测；失败时 `location.href = "/?redirect=..."` 回根入口升级。
- **`app-config.js`**
  - 如果该入口对应的页面**确信 Core 已就绪**（比如紧跟入口 HTML 的校验），允许顶层 `await init("mazmot")`，参考 [apps/main/app-config.js](apps/main/app-config.js)。
  - 如果该入口的页面模块会自己装 Core（如 [apps/run-app/app-config.js](apps/run-app/app-config.js)），**禁止**在 `app-config.js` 顶层调用 `init()` 或 import `/nos/*`。
- **页面模块 / 普通模块 / 组件**
  - 顶层**禁止** `import "/nos/*"`；必须用 `const load = lm(import.meta); await load("/nos/xxx/main.js")` 在 `attached` 或运行时按需加载。
  - 参考实现：[apps/run-app/run-app.html](apps/run-app/run-app.html) 的 Core 就绪 Promise + `load(...)` 并行加载模式。

> 违反这条规则最典型的现象：首次访问或 Core 升级后白屏，因为模块加载早于 Core 注册 SW。

## 本地数据存储规范

统一使用 NoneOS Core 提供的 `/nos/storage/main.js`（异步键值存储，底层 IndexedDB，支持复杂类型与跨标签页同步），**禁止**引入第三方存储库，也**禁止**裸用 `localStorage`。

```javascript
import { storage, getStorage } from "/nos/storage/main.js"; // 仅入口 HTML / Core 已就绪的 app-config.js
// 页面模块 / 组件：const { getStorage } = await load("/nos/storage/main.js");

await storage.setItem("key", value);       // 默认空间，等价 getStorage("public")
const store = getStorage("mazmot");        // 独立空间，同 id 复用实例
```

- **空间划分**：不同业务用 `getStorage(<id>)` 隔离，禁止全部塞进默认空间。主系统应用列表用 `mazmot` 空间的 `apps` 键。
- **加载时机**：`/nos/storage/main.js` 属于 `/nos/*`，受上一节「NoneOS Core 依赖加载」约束——页面模块 / 组件顶层**禁止** import，必须 `load(...)` 按需加载。
- **API 优先级**：用 `setItem` / `getItem` / `has` / `removeItem` 方法调用；代理语法（`storage.key = v`）会静默吞错且写入时序不确定，仅用于无关紧要的场景。
- **文件句柄**：可直接存 `nos/fs` 句柄（读回仍是可用句柄），但 `open()` 得到的本地目录必须先 `mount()`，且句柄不能放在 `Map` / `Set` / 类实例里。
- **例外**：`sessionStorage`（标签页级、关页即失效，如云盘客户端会话）与 [apps/main/home/app-status.js](apps/main/home/app-status.js) 中需要同步读写的 `mazmot-opened-apps` 保留原生 API，不要迁移。
- 详细 API 见 `noneos-core-docs` 知识库的 storage 章节。

## UI 与视觉规范

- **组件库**：统一使用 `senti-ui` 组件库（`st-*` 组件，基于 ofa.js + Material Design 3），不强制全用组件，可按需自写 UI。
- **视觉系统（强制）**：无论是否使用 senti-ui 组件，颜色体系必须严格遵循 `senti-ui` 的颜色方案与设计语言（Material Design 3）。
- **快捷指令**：`prompt` / `alert` / `confirm` 这类单行 JS 直接调用的浏览器原生对话框，也应尽量使用 `senti-ui` 提供的对应 API，保持视觉统一。
- **开发参考**：在实现 UI 相关功能前，请查阅 `senti-ui` 知识库以保持风格一致性。
- **Punch-UI 退出中（强制）**：`punch-ui` 将逐步退出，**新页面 / 新组件 / 新应用一律禁止使用 punch-ui**（包括 `punch-ui-v2.pages.dev` 的任何资源），UI 需求统一由 `senti-ui` 承担；存量 punch-ui 代码在迁移前保持现状，改动到对应文件时应顺手迁移为 `st-*` 组件，不要再新增任何 punch-ui 依赖。
- **图标**：业务代码统一使用 `<n-icon icon="mdi:xxx">`（由 NoneOS Core 提供，底层基于 `iconify-icon` 实现）。
  - **禁止**业务代码直接调用 `iconify-icon` 的 API 或将其作为依赖加载（`n-icon` 会按需加载底层运行时）。
  - CSS 子选择器统一引用 `n-icon` 标签名（如 `.step-circle n-icon { ... }`），保持与业务代码一致的封装层级，避免直接触碰底层渲染节点。
  - 新增页面 / 组件应通过 `<l-m src="/nos/n-icon/n-icon.html"></l-m>` 显式声明依赖。

## 开发指令

1. **先读 Skill**：在编写代码或提供建议前，必须先检索并阅读上述对应的 Skill 文档。
2. **页面 / 组件开发强制读 ofa.js Skill**：**只要涉及新增或修改 `.html` 页面模块 / 组件模块（`<template page>` / `<template component>`）**，动手前**必须**先调用 `Skill` 工具加载 `ofajs-docs` 知识库，确认模板语法（如属性值内 `{{...}}` 不解析、`attr:` / `:prop` / `class:` / `:style.` 的正确用法等）。**禁止**凭记忆直接编写或修改模板；违反本规则的常见后果是把 `{{expr}}` 塞进 `title` / `placeholder` / `href` 等属性值里被浏览器当字面字符串渲染。
3. **遵循模式**：优先采用框架推荐的最佳实践，确保与现有代码库的风格一致。
4. **架构对齐**：所有改动需符合 `noneos-core` 与 `ofa.js` 的设计哲学。更多项目细节请参考 [CONTEXT.md](CONTEXT.md)。
5. **同步更新 Context（强制）**：发生以下任一变更时，**必须同步更新** [CONTEXT.md](CONTEXT.md) 对应章节，不得事后补：
   - 新增 / 删除 / 重命名任何文件或目录（→ 同步目录树与"关键代码文件速查"表）
   - 修改公开 API / 模块导出 / 页面 proto 方法签名（→ 同步"关键代码文件速查"或新增小节）
   - 修改数据结构字段（`apps[]` 持久化字段、payload 结构、manifest 字段等）（→ 同步"数据模型"）
   - 修改关键流程（应用生命周期、分享接收流程、Core 加载顺序等）（→ 同步对应流程图/步骤描述）
   - 新增 / 删除一个应用（apps/<name>/）或组件（mz/comps/<name>/）
6. **禁止历史冗余**：[CONTEXT.md](CONTEXT.md) 只记录当前架构与活跃流程，禁止写入改造前/已废弃/一次性迁移/未来幻想等历史冗余信息。如需保留历史决策，写入 git 提交信息或独立历史文档，不要污染上下文。
7. **禁止使用 file 协议路径**：文档、注释、配置中的文件引用统一使用相对路径或仓库内可解析的路径（如 `AGENTS.md`、`apps/main/home.html`），禁止使用 `file://` 等本地绝对路径，避免在不同机器上失效。
8. **补充上下文**：若发现 [CONTEXT.md](CONTEXT.md) 中存在信息缺失，应及时补充完善。
9. **沉淀经验**：开发过程中若遇到频繁复现的错误（踩坑点）或总结出使用技巧，应主动询问用户，由用户决定后再落档，不要擅自处置：
   - **可复用的通用知识**（框架用法、组件模式、API 坑点等）→ 沉淀到 `.agents/skills/` 中（项目级 Skill，参考 [.agents/skills/mazmot-api/](.agents/skills/mazmot-api/SKILL.md) 的结构），供后续任务复用。
   - **Mazmot API 知识同步（强制）**：项目自身的 API 发生变更（`app.json` 结构、应用运行 / 分享 / 安装 / 状态追踪等 Mazmot 专属 API、payload / manifest 字段等）时，必须同步更新 [.agents/skills/mazmot-api/](.agents/skills/mazmot-api/SKILL.md) 下的对应文档，保持知识库与代码一致，不得只改代码不更新 Skill。
   - **项目专属的架构事实、流程、约定**→ 记录到 [CONTEXT.md](CONTEXT.md) 对应章节。
   - **针对 AI 代理的长期开发规范**→ 补充到本文件（AGENTS.md）。
   - **历史决策、一次性迁移记录**→ 写入 git 提交信息，不要污染文档（见第 6 条）。

## 目录与文件放置规则

不同类型的文件有约定位置，新增内容前请对号入座：

- **新应用**：放在 [apps/](apps/) 下，目录名即 URL 路径（`apps/<name>/` = `/apps/<name>/`）；同时更新 [CONTEXT.md](CONTEXT.md) 目录树。
- **新系统级组件**：放在 [mz/comps/](mz/comps/) 下（URL = /mz/comps/<name>/），独立子目录 + `<tag>.html` + `README.md`（推荐带 `demo.html`）；**必须同步更新 [mz/comps/CONTEXT.md](mz/comps/CONTEXT.md)** 的目录树与组件说明，若被主系统使用也需更新根 [CONTEXT.md](CONTEXT.md)。
- **新应用模板**：在 [apps/main/home/templates/](apps/main/home/templates/) 下建 `<id>/` 子目录，含 `__template.json`（模板元数据 name/desc + 文件清单）+ 源文件；**必须在 [templates/manifest.json](apps/main/home/templates/manifest.json) 里登记** id。
- **模板路径约束（重要）**：[apps/main/home/templates/](apps/main/home/templates/) 下是创建应用的模板，每个模板最终会以**独立应用项目**的形式落地（模板目录即应用根目录）。因此模板内部的资源引用（HTML / CSS / JS 等）使用 `../` 相对路径时，**不得超出模板自身目录**；模板内部的 CONTEXT.md / AGENTS.md 同样受此约束，禁止出现指向模板目录之外的相对路径。需要使用 Mazmot / NoneOS Core 的能力（`/nos/*`、`/mz/*`（含 `/mz/comps/*` 组件）等宿主资源）时，一律以 `/xxx` 根路径（站内绝对路径）引用，底层 Service Worker 会保证这些路径在应用运行时可用。
- **新官方应用（应用市场）**：在 [official-apps/](official-apps/) 下建 `<id>/` 子目录，含 `__app.json`（元数据 name/icon/desc + 文件清单）+ 完整应用源文件；**必须在 [official-apps/manifest.json](official-apps/manifest.json) 里登记** id。
- **测试**：`<被测模块所在目录>/test/<被测模块同名>.sb.html`，详见上方"测试规范"。
- **Mazmot 平台 API（`mz/`）**：与 NoneOS Core 的 `/nos/*` 对称的宿主命名空间（参考 [mz/app-runner.js](mz/app-runner.js)、[mz/share-mgr.js](mz/share-mgr.js)、[mz/ai/](mz/ai/)），被多个应用（含模板）共享；引用一律用绝对路径 `/mz/xxx.js`。
- **业务工具库**：`apps/<app>/lib/`（参考 [apps/main/lib/official-app-state.js](apps/main/lib/official-app-state.js)、[apps/run-app/lib/](apps/run-app/lib/)），仅被单个应用使用的工具，与 UI 页面模块分离，便于单测。
- **不参与新逻辑的目录**：[old/](old/)（v1-v4 历史版本）、[others/](others/)（实验性测试页）。修改这些目录前请先与开发者确认，AI 默认应忽略。


## 测试规范

- **客户端测试框架**：项目使用 `sibyl-test` 作为客户端测试框架，测试用例以 `.sb.html` 文件形式编写。
- **测试义务**：开发完功能或组件后，应在其所在目录补充编写对应的 `.sb.html` 测试文件。
- **测试位置**：测试文件应跟随被测组件或页面模块存放，推荐在被测模块同级建 `test/` 子目录，文件名与被测模块同名（如 `run-app-utils.sb.html` 测试 `run-app-utils.js`）。
- **执行前确认**：写完测试文件后，不要急于自动执行测试，应先询问开发者是否让 AI 执行自动化测试并根据反馈自动修复模块。
- **快速反馈**：开发者同意后，优先使用 `npx sb-test -f <目标测试文件>.sb.html --browsers chrome` 在 Chrome 中快速测试，根据结果动态修复代码。
- **完整测试**：执行 `npm test`（即 `sb-test`）启动默认多浏览器测试流程。
- **CI**：[.github/workflows/test.yml](.github/workflows/test.yml) 会在 `push` / `pull_request` 到 main/master 时，通过 `ofajs/sibyl-test@v1` action 跑 **Chrome（Ubuntu）/ Firefox（Ubuntu）/ WebKit（macOS）** 三浏览器矩阵。修改测试或被测代码前请意识到：在一种浏览器下通过不等于全绿。
- **查阅 Skill**：在编写、修改或调试 `.sb.html` 测试前，必须先查阅 `sibyl-test` Skill 文档。
- **测试基建 URL 例外**：`.sb.html` 中加载 sibyl-test 运行时（`sb-test.mjs`）等**测试基建**允许使用 jsdelivr 完整 URL——测试由 sb-test 本地服务器承载，环境内没有 NoneOS Core SW，`/gh/` 不可用；被测的业务模块引用仍遵守 `/gh/` 规则。


## P2P 分享关键约束

应用分享基于 NoneOS Core `DataPublisher`（点对点，无后端）。修改分享相关代码必须遵守：

- **只支持 UTF-8 文本文件**：[share-mgr.js](mz/share-mgr.js) 的 `readAppFiles` 把每个文件按文本读取后塞进 JSON。二进制资源（图片、字体、音视频等）目前**不可分享**，扩展方向是给 `app.json` 文件清单加 `encoding: "base64"` 字段，不要绕过这个约定私自塞 base64 进 payload。
- **发布者必须在线**：接收端通过 `?u=<userId>&h=<payloadHash>` 短链接从发布者 IndexedDB 拉取 chunk。发布者标签页（`apps/main/`）一旦关闭，未拉完的 chunk 无法继续。设计分享相关 UI（如关闭提醒、断网重试）时以此为前提。
- **URL 字段固定**：分享链接有两种格式，互斥使用：
  - P2P 分享：`?u=<userId>&h=<payloadHash>`（用户自建应用，发布者必须在线）
  - 官方应用：`?app=<officialId>`（同源 HTTP 拉取 `/official-apps/<id>/`，不依赖发布者在线）
  
  其他历史格式（`?p=`、`?data=` 等）已废弃。修改 [share-mgr.js](mz/share-mgr.js) 的 `buildRunUrl` / `buildOfficialRunUrl` / `parseShareUrl` 前请先评估向后兼容。
- **签名链不可省**：接收端验证顺序为 `connectUser` → `requestManifest`（内部 `verifyData`）→ `requestChunk`（内部 SHA-256）→ 显式 `isPublicKeyOfUser`。任何一步失败即进错误页，**不要**用 try/catch 吞错。


## 技能资源与导入 (Skill Resources)

若本地环境中缺少相关知识库，请通过以下链接获取最新版本：

- **ofa.js-docs**
  - [GitHub 在线源码](https://github.com/ofajs/ofa.js/tree/main/skills/ofajs-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/ofa.js/refs/heads/main/skills/ofajs-docs.zip)
- **punch-ui-docs（仅维护存量 punch-ui 代码时查阅，新代码用 senti-ui 知识库）**
  - [GitHub 在线源码](https://github.com/ofajs/Punch-UI/tree/v2/skills/punch-ui)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/ofajs/Punch-UI/refs/heads/v2/skills/punch-ui.zip)
- **noneos-core-docs**
  - [GitHub 在线源码](https://github.com/kirakiray/noneos-core/tree/main/skills/noneos-core-docs)
  - [ZIP 离线包下载](https://raw.githubusercontent.com/kirakiray/noneos-core/refs/heads/main/skills/noneos-core-docs.zip)
- **sibyl-test**
  - 该项目使用 `sibyl-test` 作为测试模块。
  - 使用前请检查本地是否有 sibyl-test Skill，若无则需导入。
  - [Skill 在线文件](https://raw.githubusercontent.com/ofajs/sibyl-test/refs/heads/main/skills/sibyl-test/SKILL.md)

### ⚠️ 导入注意事项

导入技能包时，若压缩包内包含 `references` 与 `assets` 目录，**必须完整导入这两个目录下的全部文件**。前者存储核心技术细节文档，后者包含示例资源、素材等补充材料，任何遗漏都会导致技能知识库残缺，直接影响开发流程的准确性与效率。
