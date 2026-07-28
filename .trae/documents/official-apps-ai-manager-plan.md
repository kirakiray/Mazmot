# AI 密钥管理器官方应用实现计划

## 背景

Mazmot 已有一个独立的 AI Provider 抽象层 `/ai/main.js`，提供 `saveKey / removeKey / getApiKeys / onApiKeysChange / testApiKey / getAssistant` 等 API，但缺少一个官方、美观的 UI 入口。本计划将在 `official-apps/ai-manager/` 下新建一个 ofa.js 官方应用，作为该能力的标准管理界面，并上架到 Mazmot 应用市场。

## 方案概述

复用现有 `/ai/main.js` 做数据持久化与 API 调用，应用本身只负责 UI 编排。界面采用 Punch-UI v2 组件（input、select、button、dialog、list）和 `n-icon` 图标，整体为居中卡片式布局，支持添加/验证/保存 Key、查看模型列表与余额、删除 Key 等操作。

## 新建文件

| 文件 | 说明 |
|------|------|
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/ai-manager/__app.json` | 官方应用元数据与文件清单，供 `official-app-writer.js` 读取 |
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/ai-manager/app.json` | 应用元数据（name/displayName/version/icon/description/permissions/createdAt） |
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/ai-manager/index.html` | 入口 HTML，加载 ofa.js、router、Punch-UI 全局 CSS |
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/ai-manager/app-config.js` | ofa.js 应用配置，声明 `home = "./pages/home.html"` 和页面过渡动画 |
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/ai-manager/pages/home.html` | 主页面模块，包含 API Key 管理全部 UI 与交互 |

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `/Users/yao/Documents/GitHub/Mazmot/official-apps/manifest.json` | 在 `apps` 数组中追加 `"ai-manager"` |
| `/Users/yao/Documents/GitHub/Mazmot/CONTEXT.md` | 更新目录树与「关键代码文件速查」表，登记 ai-manager |

## 关键实现细节

### 1. `__app.json`

```json
{
  "name": "AI 密钥管理器",
  "icon": "🔑",
  "desc": "集中管理 DeepSeek / Kimi 的 API Key，支持验证、查看模型列表与余额。",
  "files": [
    {
      "path": "app.json",
      "replacements": [
        { "from": "CREATED_AT_PLACEHOLDER", "to": "CREATED_AT" }
      ]
    },
    "index.html",
    "app-config.js",
    "pages/home.html"
  ]
}
```

### 2. `index.html` 与 `app-config.js`

- `index.html` 完全复用 `hello-world/index.html` 骨架，仅修改 `<title>`。
- `app-config.js` 复用 `hello-world/app-config.js` 骨架，仅修改 `home` 指向 `./pages/home.html`。
- 入口 HTML 使用 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug` 和 `/gh/ofajs/ofa.js/libs/router/dist/router.min.mjs`。
- Punch-UI 全局 CSS 使用 `https://punch-ui-v2.pages.dev/packages/css/pui-global.css`。

### 3. `pages/home.html`

#### 依赖声明

模板顶部通过 `<l-m>` 声明：

- `https://punch-ui-v2.pages.dev/packages/input/input.html`
- `https://punch-ui-v2.pages.dev/packages/select/select.html`
- `https://punch-ui-v2.pages.dev/packages/button/button.html`
- `https://punch-ui-v2.pages.dev/packages/dialog/dialog.html`
- `https://punch-ui-v2.pages.dev/packages/list/list.html`
- `/nos/n-icon/n-icon.html`

脚本内通过 `lm(import.meta)` 加载：

```js
const { saveKey, removeKey, getApiKeys, onApiKeysChange, testApiKey, getAssistant } = await load("/ai/main.js");
const { toast, confirm } = await load("https://punch-ui-v2.pages.dev/packages/util.js");
```

#### 数据模型（`data`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | 当前表单选中的 provider，默认 `"deepseek"` |
| `apiKey` | string | 当前表单输入的 key |
| `showPassword` | boolean | 密码可见性切换 |
| `apiKeys` | array | 已保存 key 列表快照 |
| `submitting` | boolean | 表单提交/验证中 |
| `loadingIds` | object | 每个 key 的加载状态，key 为 id |
| `detailMap` | object | 每个 key 展开的详情文本，key 为 id |
| `expandedId` | string \| null | 当前展开详情的 key id |

#### Proto 方法

- `providerLabel(provider)` / `providerIcon(provider)` — 返回展示名称与图标。
- `togglePassword()` — 切换 `showPassword`。
- `async handleValidate()` — 调用 `testApiKey` 验证当前输入并 toast 反馈。
- `async handleSave()` — 先验证再保存；成功后清空输入并 toast 成功。
- `async handleTest(id)` — 对已保存 key 调 `getAssistant(id).getModels()` 验证连通性。
- `async handleModels(id)` — 获取模型列表并写入 `detailMap[id]`，设置 `expandedId`。
- `async handleBalance(id)` — 获取余额并写入 `detailMap[id]`，设置 `expandedId`。
- `async handleDelete(id)` — `confirm` 确认后调用 `removeKey(id)`。

#### 模板结构

整体为单页布局：

```
<main class="container">
  <header class="app-header">品牌标题与简介</header>
  <section class="form-card">添加 API Key 表单</section>
  <section class="list-section">已保存 Key 列表</section>
</main>
```

- 表单：provider 下拉 + API Key 输入框（带密码可见切换）+ 验证/保存按钮。
- 列表：使用 `<p-list>` + `<o-fill>` 渲染；空状态显示插画与提示。
- 每个列表项：provider 徽章 + maskedKey + 创建时间 + 操作按钮（验证/模型/余额/删除），可展开显示详情。

#### 视觉风格

- 遵循 Punch-UI Material Design 3 颜色系统。
- 卡片使用 `surface-container` 背景 + `border-radius: 16px`。
- DeepSeek 徽章使用 `primary-container`，Kimi 徽章使用 `tertiary-container`。
- 响应式：窄屏下表单自动换行，列表操作按钮保持 `size="s"`。

### 4. `CONTEXT.md` 更新

在「目录结构」的 `official-apps/` 小节补充：

```
├── official-apps/            # 官方应用资源目录（应用市场）
│   ├── manifest.json         # 官方应用清单
│   ├── hello-world/          # Hello World 示例
│   └── ai-manager/           # AI API Key 管理器（基于 ai/main.js）
│       ├── __app.json
│       ├── app.json
│       ├── index.html
│       ├── app-config.js
│       └── pages/home.html
```

在「关键代码文件速查」表新增一行：

| AI API Key 管理官方应用 | `official-apps/ai-manager/pages/home.html` |

## 验证步骤

1. 启动本地服务：`npm run static`
2. 访问 `http://localhost:30031/`，完成 Core 初始化后进入主应用。
3. 打开「添加应用」→「应用市场」，确认出现「AI 密钥管理器」。
4. 安装并打开应用：
   - 选择 provider，输入 API Key，点击「验证」应弹出 toast 结果。
   - 点击「保存」，列表新增一项并显示 provider、maskedKey、创建时间。
   - 点击「模型」/「余额」按钮，展开显示对应信息。
   - 点击「删除」，确认后列表移除该项。
   - 空列表时显示空状态。

## 风险与注意事项

- 必须严格遵循 ofa.js 语法：`on:click`、`proto`、`data`、`<o-if>`、`<o-fill>`、`sync:`、`attr:`、`:style.` 等。
- 页面模块内 ofa.js 资源使用 `/gh/` 前缀，禁止写死 `cdn.jsdelivr.net`。
- Punch-UI 组件使用完整 `https://punch-ui-v2.pages.dev/packages/...` URL。
- 图标统一使用 `<n-icon icon="mdi:xxx">` 并声明 `/nos/n-icon/n-icon.html` 依赖。
- `attached()` 中订阅 `onApiKeysChange`，`detached()` 中取消订阅，防止内存泄漏。
- UI 上仅展示 `maskedKey`，不直接暴露原始 `apiKey`。
