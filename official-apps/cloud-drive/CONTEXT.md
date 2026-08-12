# Cloud Drive 应用上下文

## 概述

P2P 云盘应用。单个应用可切换"服务端"和"用户端"两种模式。基于 noneos-core 的 P2P 通信能力实现设备间直连文件传输，不依赖中心服务器存储文件数据。

## 目录结构

```
cloud-drive/
├── app.json              # 应用元数据（name, icon, entry, appConfig）
├── __app.json            # 安装清单（文件列表 + 模板替换规则）
├── app-config.js         # ofa.js 路由配置，首页指向 ./pages/home.html
├── index.html            # 入口 HTML，加载 ofa.js + router + o-app
├── CONTEXT.md            # 本文件
└── pages/
    ├── home.html         # 角色选择页（服务端 / 用户端）
    ├── server.html       # 服务端页面（存储管理 + 凭证管理 + P2P 服务）
    ├── client.html       # 用户端父页面（布局容器：连接认证 + 文件浏览 + 上传下载）
    └── browse.html       # 用户端子路由页（不可见，仅承载 ?path= 用于文件夹导航历史）
```

## 页面架构

三个页面均为 `<template page>` 模块（ofa.js 页面模块），通过 `this.goto()` 进行应用路由跳转。

### home.html — 角色选择
- 检测 URL 是否有 `?host=<userId>` 参数，有则直接跳转 `browse.html?host=xxx&path=/`（分享链接场景，browse.html 是 client.html 的子路由）
- 无 host 参数时显示两张卡片供用户选择模式
- `selectServer()` → `goto("./server.html")`
- `selectClient()` → `goto("./browse.html?path=/")`

### server.html — 服务端
负责：存储空间管理、用户凭证管理、分享链接生成、P2P 文件服务。

### client.html — 用户端（父布局页面）+ browse.html（子路由）

用户端采用 ofa.js **嵌套路由**（nested routes）架构，使文件夹导航通过应用路由产生历史记录，浏览器后退键可在文件夹层级间回退：

- **client.html（父页面 / Layout）**：建立并持有 P2P 连接，渲染全部 UI（连接表单 + 文件浏览器 + 传输面板）。包含 `<slot></slot>` 供子页面挂载。文件夹导航期间父页面**不卸载**，连接持续保持。
- **browse.html（子路由页）**：`export const parent = "./client.html"`，自身 `display:none` 不渲染可见内容。唯一职责是承载 URL 中的 `?path=` 参数，通过 `goto("./browse.html?path=xxx")` 创建历史记录。

**路径同步机制（双保险）**：
1. 子页面 `attached()` 主动调用 `parent.applyRoute(path, host)` 同步路径
2. 父页面 `routerChange()` 读取 `this.app.current.routePath` 同步路径

`applyRoute(path, host)` 更新 `currentPath`、`serverUserId`（分享链接场景），若已连接则触发 `refreshList()`。

文件夹导航流程：点击文件夹 → `navigateTo(path)` → `goto("./browse.html?path=" + encodeURIComponent(path))` → 子路由切换 → 父页面 `routerChange` / 子页面 `attached` → `applyRoute` → 刷新列表。

## 核心技术依赖

| 依赖 | 用途 |
|---|---|
| **ofa.js** | UI 框架（页面模块、响应式 data、`sync:value`、`o-fill`、`o-if`、`this.goto()`） |
| **ofa.js router** | `<o-router>` + `<o-app>` 路由系统 |
| **noneos-core** (`/nos/user/main.js`) | P2P 通信（`getUser`, `connectUser`, `sendToService`, `send`, `registerService`） |
| **noneos-core FS** (`/nos/fs/main.js`) | 虚拟文件系统（`init`, `open`, `mount`, `DirHandle`, `FileHandle`） |
| **noneos-core storage** (`/nos/storage/main.js`) | 持久化存储（IndexedDB），存挂载点列表和用户凭证 |
| **Punch-UI CSS** | 全局样式变量（`--md-sys-color-*`） |

## P2P 通信协议

### 消息类型（JSON，通过 `sendToService` 发送）

#### 客户端 → 服务端
| kind | 字段 | 说明 |
|---|---|---|
| `auth` | username, password | 认证（无需预先认证） |
| `list` | path | 列出目录 |
| `mkdir` | path, name | 创建文件夹 |
| `delete` | path | 删除文件/文件夹 |
| `rename` | path, newName | 重命名 |
| `upload_start` | transferId, path, fileName, fileSize, chunkCount, chunkHashes | 开始上传 |
| `upload_complete` | transferId | 所有分块已发送完毕 |
| `download_request` | path | 请求下载文件 |

#### 服务端 → 客户端
| kind | 字段 | 说明 |
|---|---|---|
| `auth_result` | success, error? | 认证结果 |
| `list_result` | path, items[] \| error | 目录列表 |
| `mkdir_result` | success, error? | 创建结果 |
| `delete_result` | success, error? | 删除结果 |
| `rename_result` | success, error? | 重命名结果 |
| `upload_ready` | transferId, accepted, error? | 准备好接收分块 |
| `upload_done` | transferId, success, error? | 上传完成 |
| `download_start` | transferId, fileName, fileSize, chunkCount, chunkHashes \| error | 下载开始 |
| `download_complete` | transferId | 所有分块已发送完毕 |

### 二进制分块协议

文件数据通过 `remoteUser.send(sessionId, ArrayBuffer)` 发送，不走 `sendToService`。

**帧格式**：`[4字节头长度 BE][JSON头][二进制payload]`

**JSON 头**：`{ transferId, chunkIndex, totalChunks }`

**分块大小**：240KB（`CHUNK_SIZE = 245760`），因为 noneos-core WebSocket 中转有 256KB 上限。

### 消息路由关键点

noneos-core 有两条传输路径，二进制监听必须绑定在 **remoteUser** 上：

| 路径 | JSON 消息 | 二进制消息 |
|---|---|---|
| WebSocket 中转 | `user.bind("message")` 或 service handler | `remoteUser.bind("message")` |
| RTC DataChannel | service handler (`#dispatchToServiceApp`) | `remoteUser.bind("message")` |

- JSON 控制消息始终通过 `registerService` 的 `onMessage` handler 接收
- 二进制分块必须在 `remoteUser.bind("message")` 上接收
- **客户端**：在 `connect()` 中 `connectUser` 后绑定
- **服务端**：在 `remote_user_connected` 事件中对每个 remoteUser 绑定

## 服务端详细设计

### 存储管理

- **默认虚拟目录**（"主目录"）：通过 `init(STORAGE_NAMESPACE)` 创建，不可删除
- **本地目录挂载**：通过 `open()` 选择 Chrome 本地目录，`nativeHandle` 持久化到 nos/storage
- 挂载点恢复时需要重新请求权限（`needsAuth` 标记）
- 每个挂载点作为客户端文件浏览器的顶层文件夹

**路径解析**：`parsePath("/主目录/sub/file")` → 找到名为"主目录"的 mount → `subPath = ["sub", "file"]`

### 凭证管理

- 用户凭证 `{ username, password }` 存于 nos/storage（key: `cd-users`）
- 认证成功的客户端 userId 加入 `_authClients` Set
- 客户端断开时从 `_authClients` 移除

### 会话缓存修复

`handleIncoming` 中用 Proxy 包装 `ctx.remoteUser.sendToService`，自动注入 `sessionId: ctx.fromSessionId`，确保回复定向到消息来源 session，绕过 `serviceSessionCache` 可能缓存旧 session 的问题。

### 分享链接

通过 `/lib/share-mgr.js` 的 `buildOfficialRunUrl` 生成官方应用 HTTP 渠道分享 URL（`?app=cloud-drive&host=<serverUserId>`），客户从 `/official-apps/cloud-drive/` 同源拉取安装，无需发布者保持在线；`host` 参数由 run-app 透传给应用，用于 P2P 客户端通信。

## 用户端详细设计

### 会话恢复

- 认证成功后保存到 sessionStorage（key: `cloud-drive-session`）：`{ serverUserId, username, password, currentPath }`
- 文件列表缓存到 sessionStorage（key: `cloud-drive-list-cache`）：`{ path, items }`，每次 `handleListResult` 成功时更新
- 页面刷新时 `attached()` 乐观恢复：先用缓存数据展示文件浏览器（`connected = true` + 缓存的 `fileList`），再后台自动重连
- 自动重连成功 → `refreshList()` 刷新最新列表；失败 → `connected = false` 回到登录界面（保留表单数据供用户重试）
- 导航目录时 `_updateSessionPath()` 实时更新路径
- 用户主动返回或服务端断线时清除会话 + 列表缓存

### 连接流程

1. `connectUser(serverUserId)` → 获取 remoteUser
2. 在 remoteUser 上绑定 `message` 事件（二进制接收）
3. `isRemoteUserOnline` 检查在线
4. `sendToService(SERVICE_ID, { kind: "auth", ... })` 发送凭证
5. 等待 `auth_result`（15秒超时）
6. 成功 → 进入文件浏览器，`refreshList()`

**连接保护**：`_connecting` 标志防止连接过程中的 `remote_user_disconnected` 事件干扰。

### 上传流程

1. 文件分块（240KB）+ 计算每块 SHA-256 哈希
2. `sendToService` 发送 `upload_start`（含元数据和哈希列表）
3. 等待 `upload_ready`（30秒超时）
4. 逐块 `remoteUser.send(sessionId, packBinary(...))` 发送二进制
5. `sendToService` 发送 `upload_complete`
6. 等待 `upload_done`（60秒超时）

### 下载流程

1. `sendToService` 发送 `download_request`
2. 收到 `download_start`（含元数据），初始化 `_downloads` Map
3. 二进制分块通过 `handleBinaryMessage` 接收
4. 所有分块到齐后自动组装 → 触发浏览器下载

## 竞态处理（核心设计）

noneos-core 的 `#handleBinaryRelay` 有 `await blob.arrayBuffer()` 异步操作，导致二进制帧处理可能晚于后发的文本帧。解决方案：

### 自动组装模式

不依赖 `download_complete` / `upload_complete` 消息触发组装，而是在分块到齐时自动组装：

- **`_storeDownloadChunk` / `handleBinaryMessage`（服务端）**：每收到一个分块检查 `chunks.size === chunkCount`，到齐则调用 `_assembleDownload` / `_assembleUpload`
- **`handleDownloadComplete` / `handleUploadComplete`**：分块已到齐→组装；未到齐→标记等待，不报错
- **`assembled` 标志**：防止重复组装

### 分块缓冲（客户端下载）

二进制分块可能比 `download_start` 先到达，此时 transfer 不存在。用 `_pendingChunks` Map 缓冲，`download_start` 到达后回放。

## 持久化

| 数据 | 存储方式 | Key |
|---|---|---|
| 挂载点列表 | nos/storage (IndexedDB) | `cd-mounts` |
| 用户凭证 | nos/storage (IndexedDB) | `cd-users` |
| 客户端会话 | sessionStorage | `cloud-drive-session` |
| 客户端文件列表缓存 | sessionStorage | `cloud-drive-list-cache` |
| 上传/下载 transfer 状态 | 内存 Map | — |

**注意**：nos/storage 不能直接存储 ofa.js Proxy 对象，必须用 `JSON.parse(JSON.stringify())` 去壳。

## 已知限制

- **无断点续传**：transfer 状态仅在内存中，刷新即丢失，无垃圾数据风险（分块未到齐不写文件）
- **无并发传输控制**：多个文件同时上传会串行处理
- **无传输进度持久化**：刷新后传输列表清空
- **本地挂载恢复需重新授权**：Chrome FileSystemDirectoryHandle 权限可能过期

## 调试

所有关键逻辑点都有 `console.log`，前缀：
- `[cloud-drive-server]` — 服务端日志
- `[cloud-drive-client]` — 用户端日志
- `[cloud-drive]` — 通用日志
