# Mazmot

> [English](README.md) | 中文

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.16-blue.svg)](package.json)
[![Browser Tests](https://github.com/kirakiray/Mazmot/actions/workflows/test.yml/badge.svg)](https://github.com/kirakiray/Mazmot/actions/workflows/test.yml)
[![Website](https://img.shields.io/badge/website-mazmot.noneos.com-blue.svg)](https://mazmot.noneos.com)
[![Repository](https://img.shields.io/badge/repo-github.com/kirakiray/Mazmot-blue.svg)](https://github.com/kirakiray/Mazmot)

**Mazmot** 是一个完全运行在浏览器里的应用启动器。用户可以在其中管理、运行、分享多个独立的 Web 应用，所有应用直接在主域运行，不需要额外的容器服务或打包步骤。底层基于 [NoneOS Core](https://github.com/kirakiray/noneos-core) 提供的微前端容器化能力，上层用 [ofa.js](https://github.com/ofajs/ofa.js) 框架与 [Senti-UI](https://github.com/ofajs/senti-ui) 组件库构建用户界面。

> **本质上**，Mazmot 是 NoneOS Core 微前端容器化技术的一个**用户态实现**：它把 NoneOS Core 的虚拟文件系统、去中心化用户身份、P2P 发布能力组装成一个面向终端用户的「应用市场 + 启动器 + 分享链路」，让普通用户也能像使用操作系统一样管理 Web 应用。

```js
// 应用运行 URL（虚拟目录）
/$mazmot-apps/{appName}/client/index.html

// 应用分享短链接（P2P，发布者在线即可被拉取）
/apps/run-app/?u={publisherUserId}&h={payloadHash}
```

---

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser (User)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Mazmot 应用层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │   │
│  │  │ apps/    │  │ apps/    │  │ apps/    │  │official-│  │   │
│  │  │ main     │  │ run-app  │  │ network  │  │apps/    │  │   │
│  │  │ (启动器) │  │ (分享接收)│  │ (网络监控)│  │ (应用市场)│  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────┴─────────────────────────────────┐   │
│  │              ofa.js Framework + Senti-UI                   │   │
│  │       (Web Components / 数据绑定 / 路由 / 组件库)           │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                     │
│  ┌──────────┐  ┌──────────┴─┐  ┌────────────┐  ┌────────────┐  │
│  │ /nos/fs  │  │ /nos/user  │  │/nos/publish│  │/nos/storage│  │
│  │ (虚拟    │  │ (去中心化  │  │ (DataPub-  │  │ (IndexedDB │  │
│  │  文件系统)│  │  身份/通信) │  │  lisher)   │  │   存储)  │  │
│  └──────────┘  └────────────┘  └────────────┘  └────────────┘  │
│                           │                                     │
├───────────────────────────┼─────────────────────────────────────┤
│              NoneOS Core Service Worker (sw.js)                  │
│        (fetch 拦截 / 虚拟 URL 前缀 / 离线缓存 / OPFS 挂载)        │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │   NoneOS Core Relay Servers  │
              │ (ECDSA 握手 / 消息中继 / RTC  │
              │  信令隧道 / 流量统计)         │
              └──────────────────────────────┘
```

应用通过 Service Worker 的虚拟 URL 前缀（`/$mazmot-apps/`、`/$mount-.../`、`/nos/`、`/gh/`、`/npm/`）直接在主域运行，浏览器看到的是同一个 origin，应用感知到的是一个独立的运行容器。

---

## 特性

### 应用管理（`apps/main/`）
- **三种应用来源**：本地目录（Chrome File System Access 挂载）、虚拟目录（OPFS 持久化）、官方应用市场
- **应用模板**：内置 base / share-link / ping-pong / tic-tac-toe 等模板，新建应用即开即用
- **应用市场**：浏览官方应用并安装，支持版本检测与一键更新
- **状态追踪**：通过 BroadcastChannel + localStorage 追踪应用窗口存活状态

### P2P 分享（`apps/run-app/` + `lib/share-mgr.js`）
- 基于 NoneOS Core `DataPublisher` 点对点分发，**无需后端、无需 zip、无需上传**
- 短链接仅 `u`（发布者 userId）+ `h`（payload 哈希）两个参数
- 三层安全锚点：E2E 密钥握手 + ECDSA 签名校验 + SHA-256 chunk 防篡改
- 接收端「无改动秒跳」：已安装且内容哈希一致时跳过下载直接进入应用
- 发布者在线即可被拉取，关闭标签页即断供

### 网络监控（`apps/network/`）
- 服务器连接状态、版本、延迟、连接/断开/测试
- 已连接 RemoteUser 的在线状态、SessionIds、RTT、Ping
- 实时带宽与流量统计（服务器/用户维度）

### 离线与缓存
- Service Worker 拦截 `/gh/`、`/npm/`、`/nos/*` 前缀请求，离线可用
- 宿主项目文件缓存清单（`host-cache.json`），Core 安装/升级后自动下载到 OPFS

---

## 项目结构

```
Mazmot/
├── index.html                # 根入口：初始化/升级 NoneOS Core
├── sw.js                     # NoneOS Core Service Worker
├── host-cache.json           # 宿主项目离线缓存清单
├── AGENTS.md                 # AI 代理开发规范（必读）
├── CONTEXT.md                # 项目架构上下文
├── apps/                     # 应用（URL = /apps/<name>/）
│   ├── main/                 #   主应用：应用列表 / 添加 / 市场 / 分享
│   ├── run-app/              #   分享接收应用（?u=...&h=...）
│   └── network/              #   网络监控应用
├── lib/                      # 跨应用公共工具库（app-runner / share-mgr）
├── comps/                    # 系统级公共组件（ercode / rdn-network / rnd-box）
├── official-apps/            # 官方应用资源（应用市场）
│   ├── ai-manager/           #   AI API Key 管理器
│   └── smart-assistant/      #   智能联络助手
├── ai/                       # 独立子项目：AI Provider 抽象层
└── .github/workflows/        # CI：多浏览器测试矩阵
```

---

## 快速开始

### 环境要求

- Node.js（用于启动静态服务器）
- 推荐 **Chrome**（本地目录挂载功能仅 Chrome 支持；其他浏览器可使用虚拟目录与官方应用）

### 1. 在线访问（最快）

直接访问 **[mazmot.noneos.com](https://mazmot.noneos.com)** —— 无需安装、无需配置。首次访问会自动安装 NoneOS Core，完成后进入主应用 `/apps/main/`。

### 2. 本地开发

如需本地开发调试：

```bash
git clone https://github.com/kirakiray/Mazmot.git
cd Mazmot
npm install
npm run static
# → http://localhost:30031/
```

> **提示**：若要进行完整功能的本地调试（P2P 握手、去中心化用户连接、应用分享等），还需运行由 [NoneOS Core](https://github.com/kirakiray/noneos-core) 提供的本地握手服务器：

```bash
git clone https://github.com/kirakiray/noneos-core.git
cd noneos-core
npm install
npm run ws
```

请在独立的终端窗口中保持握手服务器运行，否则依赖 P2P 的功能（应用分享、用户间消息等）将无法端到端运作。

### 3. 添加并运行第一个应用

1. 在主界面点击「添加应用」
2. 选择应用来源：本地目录（Chrome）或虚拟目录
3. 输入应用名（仅字母、数字、下划线、连字符，不含空格）
4. 应用列表出现新项，点击应用行或 `tab-plus` / `open-in-new` 按钮启动

### 4. 分享应用

在应用列表折叠子项中开启「自动分享」开关，系统会生成一个短链接：

```
https://your-host/apps/run-app/?u={publisherUserId}&h={payloadHash}
```

对方打开链接即可一键安装并运行该应用。**发布者标签页需保持在线**，以便对方通过 P2P 拉取数据。

---

## 脚本

| 脚本 | 说明 |
|---|---|
| `npm run static` | 启动静态服务器（端口 30031，无缓存） |
| `npm test` | 运行 sibyl-test 多浏览器测试套件 |
| `npm run update` | 重新生成宿主项目离线缓存清单（`host-cache.json`） |

---

## 文档

- [AGENTS.md](AGENTS.md) — AI 代理开发规范（技术栈、依赖 URL 规范、目录规则、测试规范、P2P 分享约束）
- [CONTEXT.md](CONTEXT.md) — 项目架构上下文（目录树、数据模型、应用生命周期、分享流程）
- [comps/CONTEXT.md](comps/CONTEXT.md) — 系统级公共组件说明
- [mz/ai/README.md](mz/ai/README.md) — AI Provider 抽象层完整 API 文档

### 相关 Skill 知识库

开发前请先阅读对应的 Skill 文档（详见 [AGENTS.md](AGENTS.md)）：

- **ofajs-docs** — 页面/组件模块开发
- **noneos-core-docs** — `/nos/storage`（IndexedDB 存储）、文件系统、用户管理、服务通信
- **senti-ui** — 组件库与视觉规范（Material Design 3）
- **sibyl-test** — 测试框架

---

## 测试

使用 [sibyl-test](https://github.com/ofajs/sibyl-test) 编写浏览器端单元测试，测试页为 `.sb.html` 文件。

```bash
# 完整测试（多浏览器矩阵）
npm test

# 快速调试单文件（Chrome）
npx sb-test -f <目标测试文件>.sb.html --browsers chrome
```

CI 通过 `ofajs/sibyl-test@v1` action 在 **Chrome（Ubuntu）/ Firefox（Ubuntu）/ WebKit（macOS）** 三浏览器矩阵上运行（见 [test.yml](.github/workflows/test.yml)）。

---

## 贡献

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/my-feature`
3. 提交改动：`git commit -am 'Add my feature'`
4. 推送：`git push origin feat/my-feature`
5. 发起 [Pull Request](https://github.com/kirakiray/Mazmot/pulls)

如发现 Bug 或有功能建议，请[提交 Issue](https://github.com/kirakiray/Mazmot/issues)。

> ⚠️ 提交前请务必阅读 [AGENTS.md](AGENTS.md) 中的开发规范，特别是 ofa.js 依赖 URL 前缀规则与 NoneOS Core 模块加载时机约束。

---

## License

[Apache-2.0](LICENSE) © Yao
