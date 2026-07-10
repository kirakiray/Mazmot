# 应用分享功能实现计划（基于 DataPublisher）

## Context

Mazmot 目前只支持本地创建应用，缺少把应用分享给别人的能力。要实现"点击分享 → 生成链接 → 别人打开链接就能安装"的闭环。

底层已有能力：
- **noneos-core DataPublisher**：将 File 分块签名发布到 P2P 网络（本地 DB + 信令服务器中转），提供 `publish / requestManifest / requestChunk / assembleFile` 完整接口。
- **LocalUser.sign** 和 **`verifyData`**：ECDSA 签名 / 无实例验签（`/nos/crypto/crypto-verify.js` 导出 `verifyData`，接收端无需构造 user 实例即可校验分享 payload），用于给 URL 元数据加签防篡改。
- **现有容器推送流程**：`readAppFiles` / `findTrulyAvailableUrl` / `pushFilesToContainer` / `getRunUrl` 一整套。

设计目标：不引入 zip、不搭后端，用 DataPublisher 做传输层，只发一条 URL 就能完成分享。

---

## 分享包 JSON 格式

发布的文件是 UTF-8 JSON：

```json
{
  "mazmotPackage": "1.0.0",
  "meta": {
    "appId": "app_1720600000000_abc123",
    "recordName": "my-app",
    "displayName": "My App",
    "version": "0.1.0",
    "description": "应用描述",
    "icon": "🚀",
    "sharedAt": 1720600000000
  },
  "files": [
    { "path": "app.json", "content": "..." },
    { "path": "index.html", "content": "..." }
  ]
}
```

- `appId`：分享侧生成的稳定 ID（`app_{timestamp}_{rand}`），持久化到 `ever-cache.apps[i].appId`，同一应用多次分享保持同一个 ID。已存在的老应用首次分享时补写。
- `files`：直接沿用 `readAppFiles` 返回的 `{ path, content }` 数组（现有 `pushFilesToContainer` 也是这个格式，接收端不用再转换）。
- 目前只支持文本文件（沿用现状），二进制文件先不做，未来加 `encoding: "base64"` 扩展。

---

## URL 参数（带签名，防篡改）

分享链接格式：

```
{origin}/share.html?p={base64url(payload)}
```

其中 `payload` 是一个由**发布者签名**过的 JSON（**发布者用 `user.sign()` 生成**）：

```json
{
  "appId": "app_1720600000000_abc123",
  "recordName": "my-app",
  "displayName": "My App",
  "version": "0.1.0",
  "description": "应用描述",
  "icon": "🚀",
  "publisherUserId": "user_xxx",
  "fileHash": "sha256_...",
  "sharedAt": 1720600000000,
  "signTime": 1720600000000,
  "publicKey": "...",
  "signature": "..."
}
```

- `user.sign(data)` 会返回把业务字段和 `signTime` / `publicKey` / `signature` 合并成的**单层对象**（noneos-core `_sign` 会按字段字母序排序后序列化再签名）。所以业务字段全部纳入签名范围，扁平放在一层即可，**不要再包一层 `data`**。
- 接收端直接：
  ```javascript
  import { verifyData } from "/nos/crypto/crypto-verify.js";
  const payload = JSON.parse(base64UrlDecode(query.p)); // 保留原字段顺序
  const isValid = await verifyData(payload); // 无需构造 user 实例
  ```
- 额外身份校验：`payload.publicKey` 的 hash 必须等于 `payload.publisherUserId`（防止用别人的 userId 冒名），可用 noneos-core 已有的 `getUserIdFromPublicKey` / 或对比 `payload.publicKey` 与 remoteUser.publicKey 匹配。
- Base64URL 编码 JSON 字符串放到 `?p=` 单参数上，链接短且防中间人肉眼修改。
- ⚠️ **接收端务必用 `JSON.parse` 直接解析后不要重建对象**，因为 `verifyData` 依赖字段原始顺序。展开合并、扩展运算符都会打乱顺序导致验签失败。

---

## 需要修改/新增的文件

### 修改
1. [pages/home.html](file:///Users/yao/Documents/GitHub/Mazmot/pages/home.html)
   - 折叠子列表增加"分享应用"按钮（放在删除按钮旁边）。
   - 新增分享弹窗 `<p-dialog>`：显示进度、生成链接后展示只读输入框 + 复制按钮。
   - 组件 `data`：`shareDialogOpen`、`shareProgressText`、`shareUrl`、`shareError`；
     `_shareUser`、`_sharePublisher`（下划线前缀，避免响应式代理）。
   - `proto` 新增：`ensureShareUser()`、`handleShare(event, app)`、`copyShareLink()`、`closeShareDialog()`。

2. [pages/home/add-app.html](file:///Users/yao/Documents/GitHub/Mazmot/pages/home/add-app.html)
   - 新建应用时给 `apps[]` 记录写入 `appId`（`app_${Date.now()}_${rand}`）。
   - 老应用兼容：`home.html` 分享前若 `app.appId` 缺失，就补写并回写 `storage.apps`。

3. [CONTEXT.md](file:///Users/yao/Documents/GitHub/Mazmot/CONTEXT.md)
   - 新增"应用分享"章节：数据模型 `appId` 字段说明、URL payload 结构、`share.html` 流程。

### 新增
4. `pages/home/share-mgr.js`
   - 集中放分享相关工具，主页面和 `share.html` 共用。
   - 导出：
     - `PACKAGE_VERSION = "1.0.0"`
     - `ensurePublisher(namespace = "mazmot")` — 单例返回 `{ user, publisher }`（`getUser` + `user.server.connect(默认信令)` + `new DataPublisher(user).start()`），并 memoize。仅**发布端**需要。
     - `buildPackageBlob(files, meta)` — 生成 `File` 对象。
     - `signSharePayload(user, data)` — 调用 `user.sign(data)` 返回带签名的扁平对象。
     - `buildShareUrl(origin, signedPayload)` — Base64URL 编码到 `?p=`。
     - `parseShareUrl(search)` — 反向解析并**用 `JSON.parse` 直接返回**，保持字段顺序。
     - `verifySharePayload(payload)` — 内部调用 `verifyData(payload)`（来自 `/nos/crypto/crypto-verify.js`）；再校验 `getUserIdFromPublicKey(payload.publicKey) === payload.publisherUserId`。**不依赖本地 user 实例**。
     - `base64UrlEncode(str)` / `base64UrlDecode(str)`。
   - 不导出 UI，只做纯逻辑。

5. `share.html`（与 `index.html` 同级）
   - 结构参考 `index.html`：
     ```html
     <script type="module">
       await fetch("/__config").then(e=>e.json()).catch(()=>{
         location.href = "/_install.html";
       });
     </script>
     ```
   - 加载 ofa.js + router + Punch-UI，`<o-app src="./share-config.js">`。

6. `share-config.js`（与 `app-config.js` 同级）
   - `init("mazmot")` 保持和主系统同一命名空间（这样 `storage.apps`、user 身份都能共享，安装后立刻能被主页看到）。
   - `export const home = "./pages/share.html";`
   - 也 export `pageAnime`。

7. `pages/share.html`
   - ofa.js 页面模块。
   - `data`：`step`（`verifying|preview|installing|done|error`）、`meta`（展示用）、`progressText`、`errorText`、`_installedApp`、`_publisher`。
   - `attached()`：
     1. 解析 URL 参数，`parseShareUrl` → 拿到 `payload`（**保持原字段顺序**）。
     2. **先直接用 `verifySharePayload(payload)` 验签**，不需要初始化 user / publisher / 信令连接。验签失败立即进入 `error` 步骤，提示"分享链接被篡改或签名无效"。
     3. 验签通过后进入 `preview` 步骤，展示 icon / displayName / version / description / publisherUserId 缩略；按钮"安装应用"。（此时才懒加载 `ensurePublisher()`，避免访问篡改链接也浪费信令连接。）
   - `handleInstall`：
     1. `ensurePublisher()` 拿到本地 user + publisher。
     2. `progressText = "连接发布者..."`；`remoteUser = await user.connectUser(payload.publisherUserId)`。
     3. `progressText = "拉取应用清单..."`；`manifest = await publisher.requestManifest(remoteUser, payload.fileHash)`。
     4. `progressText = "下载文件块..."`；遍历 `manifest.chunkHashes`，`publisher.requestChunk(remoteUser, hash)`；带百分比。
     5. `result = await publisher.assembleFile(payload.fileHash)`；`pkg = JSON.parse(await result.blob.text())`。
     6. 校验 `pkg.mazmotPackage`、`pkg.meta.appId === payload.appId`、`pkg.meta.recordName === payload.recordName`。
     7. **安装到虚拟目录**（`recordName` 附加 `appId` 后 6 位保证唯一，见下方"同名应用处理"）：
        ```
        rootDir = await init("mazmot-apps")
        targetDir = await rootDir.get(uniqueRecordName, { create: "dir" })
        clientDir = await targetDir.get("client", { create: "dir" })
        for (file of pkg.files) {
          fh = await clientDir.get(file.path, { create: "file" })
          await fh.write(file.content)
        }
        ```
        > 注意 `readAppFiles` 是从 `client/` 子目录读的（相对路径已剥掉 `client/` 前缀），所以写回时要还原到 `client/` 下。
     8. 分配容器：`containerUrl = await findTrulyAvailableUrl(apps)`，没有则报错停止。
     9. **写入 storage.apps**：
        ```
        apps.push({
          name: uniqueRecordName,
          desc: pkg.meta.description,
          handle: null,
          dirName: `mazmot-apps/${uniqueRecordName}`,
          source: "virtual",
          namespace: "mazmot-apps",
          containerUrl,
          appId: pkg.meta.appId,
          createdAt: Date.now(),
        })
        ```
     10. 推送到容器：`pushFilesToContainer(containerUrl, pkg.files, uniqueRecordName)`。
     11. `step = done`，显示"打开应用"按钮 → `window.open(getRunUrl(containerUrl))`。
   - 错误处理：任一步失败进入 `error` 步骤，展示错误消息、"重试"、"返回主页"。

### 静态服务器
- [scripts/static.js](file:///Users/yao/Documents/GitHub/Mazmot/scripts/static.js) 已经服务根目录，`share.html` 会自动生效，**不需要改**。

---

## 关键实现细节

### 1. Publisher 单例
`share-mgr.js` 内用模块级 `let _cache = null` memoize `{ user, publisher }`，避免多次初始化。信令服务器连接使用 `user.server.connect(默认 URL)`，若失败提示"无法连接分享服务器"。

### 2. `add-app.html` / `home.html` 引用 `appId`
- 新建应用时生成并写入 `appId`。
- `pages/home.html` 的 `loadApps()` 里，若 `app.appId` 缺失，返回时补一个（并异步 `storage.setItem("apps", ...)` 持久化）。

### 3. 同名应用的接收端处理
`recordName = pkg.meta.recordName + "-" + pkg.meta.appId.slice(-6)`，`displayName` 仍用原名。这样：
- 目录 `mazmot-apps/{recordName}` 唯一。
- `storage.apps[].name = recordName` 唯一，`app-status` / 容器占用逻辑都能正常工作。
- 列表展示时 `home.html` 已经用 `manifest.displayName || manifest.name`，用户看到的仍是原名。

### 4. 签名内容规范化
`user.sign(data)` 内部会按字段字母序排序后 `JSON.stringify` 签名，而 `verifyData(signed)` 则**直接 `JSON.stringify(signed 去 signature)`**——依赖字段的原始顺序。所以：
- 发布端只调 `user.sign(data)`，返回值原样 base64URL 编码放进 URL。
- 接收端只调 `JSON.parse(base64UrlDecode(query.p))` 拿到 `payload`，然后**直接把 `payload` 传给 `verifyData(payload)`**，**不要用扩展运算符 / Object.assign 重建对象**，否则字段顺序变化会导致验签失败。

### 5. share.html 加载 NoneOS Core
和 `index.html` 一样，先 fetch `/__config`，未安装则跳 `/_install.html`。这样保证 share.html 打开时 NoneOS Core 一定就绪。

### 6. 分享进度 UI
主页 `home.html` 分享弹窗：
- 状态 1（发布中）：进度条 + "读取文件..." / "分块签名..." / "发布到网络..."。
- 状态 2（成功）：只读 `<p-input>` 显示 URL + 复制按钮。
- 状态 3（失败）：错误文本 + 关闭按钮。

`share.html` 顶部展示 icon + 名称 + 版本 + 描述 + publisher userId 缩略；下方进度条。

---

## 复用的现有函数

| 函数 | 位置 | 用途 |
|---|---|---|
| `readAppFiles(handle)` | [container-mgr.js#L50](file:///Users/yao/Documents/GitHub/Mazmot/pages/home/container-mgr.js#L50) | 发布端读取应用文件 |
| `findTrulyAvailableUrl(apps)` | [container-mgr.js#L18](file:///Users/yao/Documents/GitHub/Mazmot/pages/home/container-mgr.js#L18) | 接收端分配容器 |
| `pushFilesToContainer(url, files, name)` | [container-mgr.js#L112](file:///Users/yao/Documents/GitHub/Mazmot/pages/home/container-mgr.js#L112) | 接收端推送到容器 |
| `getRunUrl(url)` | container-mgr.js | 打开应用 |
| `storage.apps` | ever-cache | 应用列表持久化 |

---

## 验证步骤

1. `npm run static` 启动 6 个 http-server。
2. 确认 NoneOS Core 默认信令服务器可访问（浏览器 devtools 观察 `user.server.connect` 返回成功）。
3. **发布测试**：
   - 打开 http://localhost:30031/ ，创建虚拟目录应用 `hello`。
   - 展开列表，点"分享应用" → 弹窗进度走完 → 得到链接。
   - 复制链接检查格式 `http://localhost:30031/share.html?p=xxx`。
4. **接收测试（同一浏览器新标签）**：
   - 打开分享链接 → 展示应用信息 → 点"安装应用"。
   - 观察进度：连接发布者 → 拉清单 → 拉块 → 安装 → 推送容器 → 打开。
   - 回到主页 http://localhost:30031/ 应能看到 `hello`（记录名可能是 `hello-xxxxxx`，但显示名为 `hello`）。
5. **篡改测试**：手动改一下链接的 `?p=` 里 base64 解码后的 `displayName` → 重新编码 → 访问，应显示"签名无效"。
6. **本地应用发布测试**：本地目录应用也走同一流程能生成链接并被接收方安装到虚拟目录。
7. **跨浏览器/隐私窗测试（可选）**：换浏览器打开链接，验证 P2P 拉取（同一 NoneOS 信令服务器下）。

---

## 风险与已知限制

- **发布者必须在线**：DataPublisher 是 P2P，发布者关闭标签页则接收端拉不到块。UI 提示分享后请保持页面开启。
- **默认信令服务器可能未部署**：需要确认 noneos-core 默认 `wss://...` 服务器可用，否则要指定自建。**方案里先直接使用 core.noneos.com 默认服务器**，失败时报错提示。
- **只支持 UTF-8 文本文件**（与现有实现一致）。二进制资源后续加 base64 支持。
- **接收端也需要装 NoneOS Core**：share.html 首访会跳 `/_install.html`，与主系统一致。
