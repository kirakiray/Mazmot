# 联络助手（Contact Assistant）MVP 实现计划

## Context

在 `official-apps/` 下新增一个官方应用「联络助手」。用户（Host）创建一个助手空间、上传初始化文本后，可生成分享链接/二维码；外部访问者（Visitor）打开链接后，可与 Host 的 AI 助手聊天；Host 则在应用内查看联系人列表、完整对话记录，并让 AI 生成联系总结。

本计划按「最小可用版本」设计：使用 Mazmot 现有 AI 能力（`/ai/main.js`）、ever-cache 本地存储、NoneOS Core P2P 服务做消息收发，分享链接复用 `lib/share-mgr.js` 的 `publishApp`。

## 关键决策

| 项 | 决策 |
|---|---|
| 应用 ID | `contact-assistant` |
| 目录 | `official-apps/contact-assistant/` |
| 入口模式 | 官方应用市场安装 → 虚拟目录运行（与其他官方应用一致） |
| AI 调用 | `getAssistant()` from `/ai/main.js`，由 Host 的 API Key 驱动 |
| 消息通道 | NoneOS Core `registerService("contact-assistant")` / `sendToService` |
| 存储 | `new EverCache("contact-assistant")`，Host 与 Visitor 各存本地 |
| 分享链接 | 复用 `share-mgr.js` 的 `publishApp`，附加 `spaceId` 与 `hostUserId` 业务参数 |
| 访问控制 | MVP 阶段链接公开，任何人可聊 |
| 离线消息 | MVP 阶段不保证：Host 需保持应用打开以接收消息 |

## 数据模型

所有数据存于自定义 `EverCache("contact-assistant")` 实例。

### Host 侧

- `spaces`：`[{ id, name, initText, createdAt }]`
- `space:{id}`：单个空间详情（与 `spaces` 数组冗余一份，便于单读）
- `contacts:{spaceId}`：`[{ visitorId, visitorName, lastMessageAt, summary }]`
- `messages:{spaceId}:{visitorId}`：`[{ id, role, content, timestamp, sender }]`，其中 `role` 为 `visitor` / `assistant` / `system`

### Visitor 侧

- `visitor-space:{spaceId}`：`{ spaceId, hostUserId, initText }`（从分享链接业务参数或首次通信获得）
- `visitor-messages:{spaceId}`：`[{ id, role, content, timestamp }]`
- `visitor-id`：自身 `LocalUser.userId` 缓存（可选，每次可取）

## 文件结构

```
official-apps/contact-assistant/
├── __app.json              # 官方应用元数据与文件清单
├── app.json                # 应用元数据（含 CREATED_AT 替换）
├── index.html              # 入口 HTML
├── app-config.js           # ofa.js 应用配置（home / pageAnime）
├── pages/
│   ├── home.html           # 空间列表 / 创建空间 / 生成分享链接
│   ├── host.html           # Host 工作台：左侧联系人、右侧对话、顶部 AI 总结
│   └── visitor.html        # 访客端：与助手聊天
└── lib/
    ├── storage.js          # EverCache 封装与数据读写
    ├── p2p.js              # NoneOS Core 服务注册、发消息、连接 Host
    └── ai-service.js       # 调用 AI 生成回复 / 总结
```

## 关键实现细节

### 1. 入口与路由（`index.html` / `app-config.js`）

- `index.html` 遵循官方应用模板：引入 `/gh/ofajs/ofa.js@latest/dist/ofa.mjs#debug`、router、`pui-global.css`。
- `app-config.js` 默认 `home = "./pages/home.html"`；通过 `location.search` 判断：若带 `spaceId` 与 `hostUserId` 参数，则导向 `visitor.html`，否则导向 `home.html`。
- 页面切换使用与其他官方应用一致的 `pageAnime`。

### 2. 空间创建（`pages/home.html`）

- 顶部展示应用介绍：「我是你的联络助手，AI 会帮你生成联系用 URL……」
- 表单：空间名称（text）、初始化文本文件（`<input type="file" accept=".txt,.md,text/plain,text/markdown">`）
- 读取文件后写入 ever-cache，生成 `spaceId = Date.now().toString(36) + random(6)`。
- 空间列表用 `<o-fill>` 渲染，每项显示名称、创建时间、进入工作台按钮、生成分享链接按钮。

### 3. 分享链接生成

- 参考 `apps/main/home/templates/share-link/pages/home.html` 的 `parseSelfIdentity` + `publishApp` 模式。
- 通过 `lm(import.meta)` 按需加载 `/nos/fs/main.js`、ever-cache、`/lib/share-mgr.js`。
- 组装 `app` 对象（`_handle`、`_recordName`、name、version、desc、icon、appId）。
- 调用 `publishApp(app, { appId, appParams: { spaceId, hostUserId } })`。
- 生成后显示只读链接输入框 + 复制按钮（二维码功能后续扩展）。

### 4. Host 工作台（`pages/host.html`）

- 通过 URL `?spaceId=xxx` 进入。
- 在 `attached()` 中：
  1. 加载空间信息；
  2. 调用 `p2p.registerHostService()` 注册 `contact-assistant` 服务；
  3. 监听来访消息，写入 ever-cache 并触发 AI 回复。
- 布局：
  - 顶部摘要区：显示当前空间名称、AI 总结按钮/自动总结开关；点击后调用 `ai-service.summarize(spaceId, visitorId)`。
  - 左侧联系人列表：`<o-fill :value="contacts">`，显示名称/最后消息时间；点击切换当前联系人。
  - 右侧聊天区：消息气泡（访客右/助手左）、底部输入框（Host 可手动介入回复）。
- AI 回复逻辑：收到访客消息后，将历史消息 + 系统提示词（含 `initText`）传给 `getAssistant().chat()`，拿到回复后 P2P 发回并本地存储。

### 5. 访客端（`pages/visitor.html`）

- 从 URL query 读取 `spaceId` 与 `hostUserId`。
- 在 `attached()` 中：
  1. 调用 `p2p.connectHost(hostUserId)`；
  2. 注册 `contact-assistant` 服务以接收 Host/AI 回复；
  3. 加载或初始化本地 `visitor-messages:{spaceId}`。
- 界面：欢迎语 + 聊天列表 + 输入框。
- 发送消息时：本地先追加一条 `role=visitor`，然后 P2P 发送 `{ type: "chat", spaceId, visitorId, message }`。
- 收到回复时：本地追加 `role=assistant`。

### 6. P2P 消息协议（`lib/p2p.js`）

```js
// Visitor → Host
{
  type: "chat",
  spaceId: "<space-id>",
  visitorId: "<visitor-user-id>",
  message: "...",
  timestamp: 1234567890
}

// Visitor → Host（可选，留联系方式）
{
  type: "profile",
  spaceId: "<space-id>",
  visitorId: "<visitor-user-id>",
  name: "...",
  contact: "..."
}

// Host → Visitor
{
  type: "reply",
  spaceId: "<space-id>",
  visitorId: "<visitor-user-id>",
  message: "...",
  timestamp: 1234567890
}
```

- Host 收到 `chat`：写入 `messages:{spaceId}:{visitorId}`，更新 `contacts:{spaceId}`，调用 AI 生成回复。
- Host 收到 `profile`：更新对应 contact 的 `visitorName` / contact 字段。
- Visitor 收到 `reply`：写入 `visitor-messages:{spaceId}`。

### 7. AI 服务（`lib/ai-service.js`）

- `buildSystemPrompt(initText)`：
  ```
  你是主人的联络助手。请基于主人提供的资料回答来访者的问题，语气礼貌、简洁，并在合适的时候询问对方的称呼和联系方式，以便主人后续跟进。

  主人资料：
  {initText}
  ```
- `reply(spaceId, visitorId)`：读取空间 `initText` 与完整对话历史，调用 `getAssistant().chat({ messages })`，返回内容写入消息并 P2P 发送。
- `summarize(spaceId, visitorId)`：读取对话历史，调用 AI：「请总结以下对话，提取来访者身份、来意、关键问题与后续跟进事项：
{conversation}」，结果写入 `contacts:{spaceId}[i].summary`。

### 8. 存储封装（`lib/storage.js`）

- 导出 `cache = new EverCache("contact-assistant")`。
- 导出 helpers：`getSpaces()`、`saveSpace(space)`、`getMessages(spaceId, visitorId)`、`addMessage(...)`、`getContacts(spaceId)`、`updateContact(...)` 等。
- 使用 `try/catch` 包裹，避免代理语法静默失败。

## UI 与视觉

- 不强制使用 Punch-UI 组件，但颜色体系必须遵循 Punch-UI：`--md-sys-color-primary`、`--md-sys-color-surface`、`--md-sys-color-surface-variant`、`--md-sys-color-on-surface` 等。
- 可少量使用 `p-button`、`p-input`、`p-list` 加速布局；其余聊天气泡、分栏布局用原生 CSS。
- 图标统一使用 `<n-icon icon="mdi:xxx">`，并通过 `<l-m src="/nos/n-icon/n-icon.html"></l-m>` 声明依赖。

## 需要修改的现有文件

- `official-apps/manifest.json`：在 `apps` 数组追加 `"contact-assistant"`。
- `CONTEXT.md`：新增「联络助手」小节，更新目录树与关键代码文件速查表（按 AGENTS.md 规则同步）。

## 验证计划

1. 启动 `npm run static`，访问 `http://localhost:30031/`，完成 NoneOS Core 安装。
2. 进入主应用 → 应用市场 → 安装「联络助手」。
3. 打开应用：创建空间，上传 `.txt` 初始化文本，生成分享链接。
4. 复制链接，在另一个浏览器/隐私窗口打开，进入访客聊天页。
5. 访客发送消息 → 确认 Host 端收到消息、AI 自动生成回复、访客端收到回复。
6. Host 切换联系人，点击「AI 总结」，确认摘要生成。
7. 刷新双方页面，确认历史消息从 ever-cache 恢复。
8. （可选）编写 `lib/test/storage.sb.html` 测试存储 helpers 的纯逻辑。

## 风险与后续迭代

- **Host 需在线**：NoneOS Core P2P 要求 Host 应用保持打开才能实时收发；离线消息会丢失。后续可考虑消息队列 + 上线同步。
- **AI 配额**：所有回复消耗 Host 的 API Key 配额；后续可增加「手动回复/AI 辅助开关」。
- **链接公开**：MVP 无访问限制；后续可加密码、有效期、访问次数。
- **二维码**：用户明确说二维码后续再做，本次只做生成链接与复制。
