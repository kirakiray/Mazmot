# Share Link 模板 Context

> 演示如何生成带参数的分享链接，让他人通过链接自动安装应用并接收参数。

## 文件结构

```
./
├── AGENTS.md         # AI 开发规范（必读）
├── CONTEXT.md        # 本文档
├── app.json          # 应用元数据：icon="🔗"，其余同 base
├── index.html        # 入口 HTML：加载 ofa.js + Material 主题 + <o-router>/<o-app>
├── app-config.js     # 导出 home = ./pages/home.html
└── pages/
    └── home.html     # 首页模块：展示已收到参数 + 生成带参数分享链接
```

## 关键流程

### 接收方（打开分享链接）

1. 主应用 `apps/run-app` 拿到 `?u=<userId>&h=<hash>`，验签 → 安装 → 跳转到虚拟目录 `client/index.html?<appParams...>`。
2. 本页 `pages/home.html` 在 `export default` 顶部用 `new URLSearchParams(location.search)` 读所有业务参数，转成 `receivedList: [{ key, value }, ...]` 展示。
3. `u` / `h` 已被 run-app 剥离，本页读到的都是发布者通过 `appParams` 显式传入的参数。

### 发送方（生成分享链接）

`pages/home.html` 中的 `generateLink()`：

1. `parseSelfIdentity()` 从 `location.pathname` 匹配 `/$<namespace>/<dirName>/client/index.html`，拿到自己的目录身份。
2. 并行 `load(...)`：
   - `/nos/fs/main.js`（拿 `init(namespace)` 获取目录句柄）
   - `ever-cache`（拿 `storage.apps` 里的记录 / 持久化 `appId`）
   - `/apps/main/lib/share-mgr.js`（拿 `publishApp` / `generateAppId`）
3. 补全 `appId`（旧记录没有则用 `generateAppId(dirName)` 生成并回写 `storage.apps`）。
4. 调用 `publishApp(app, { appId, appParams, onProgress })` 得到 `{ shareUrl, payloadHash }`；`payloadHash` 回写记录用于 run-app 秒跳。
5. UI 层：`shareUrl` 显示 + 一键复制，`copyText` 状态 1.8s 后复位。

## 数据结构

- **paramList**（UI 表单）：`[{ key: string, value: string }, ...]`，至少保留 1 行。
- **receivedList**（展示）：由 `URLSearchParams` 遍历得到，字段同上。
- **appParams**（传给 `publishApp`）：`collectParams()` 过滤 key/value 都非空的项后组装的对象。

## 扩展指引

- **修改分享参数**：只需调整 `paramList` 初始项与 `collectParams()` 校验；`publishApp` 内部会把 `appParams` 展开为 URL query。
- **给参数加类型校验**：在 `collectParams()` 里追加校验逻辑，把错误写入 `genError`。
- **多语言 / 主题**：文案统一读取 `data`，样式用 `--md-sys-color-*` 变量。
- **禁止**：直接拼接 `?p=` / `?data=` 等历史 URL 参数；把二进制资源塞进应用文件。
