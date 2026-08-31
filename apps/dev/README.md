# dev — 开发者工具

Mazmot 的开发者模式配置入口，本质上是一个**方便开发快速调试的容器域名空间**：把调试用的注入脚本（bridge / 自动化控制脚本等）一键写入 NoneOS Core 的 systemConfig，让本站**所有页面**都自动携带该脚本，无需逐页手改 HTML。

访问地址：`/apps/dev/`

## 用途

配合 NoneOS Core 的 [dev-bridge 开发模式脚本注入](https://github.com/kirakiray/noneos-core)（`nos-config/system.json` 的 `devBridge` 字段）使用：

- 配合 web-bridge-mcp 等 bridge 工具做自动化调试 / AI 代操作时，希望每个打开的静态页面都自动带上 `client.js`，避免真实跳转到未手动加 script 的页面时丢失控制。dev 应用就是给这个脚本做统一配置的界面。
- 配置写入后对全站 `text/html` 顶层导航统一生效，修改配置只需访问一次 `/__config` 触发 SW 重载，无需重启 Service Worker。

## 生效前提（双重开关，缺一不可）

1. **宿主总开关**：[sw.js](../../sw.js) 中声明 `globalThis.DEV_BRIDGE_ENABLED = true` —— 允许两种环境：**localhost 且端口 30033 - 30040**，或 **https 下的 dev1.mazmot.noneos.com ~ dev6.mazmot.noneos.com**（与本应用内置校验一致）。其他域名 / 端口打开本应用会直接显示「不可用」，也不会启动 Core 安装与配置表单。
2. **注入脚本非空**：本应用保存的 `devBridge.script` 即此项；「清空」保存会删除 `devBridge` 字段，等于关闭注入。

## 页面流程

1. **环境校验**：先按上面的 host / 端口规则判断当前域名是否允许开发者模式，不允许则显示不可用提示并终止。
2. **安装 NoneOS Core**：与 [run-app](../run-app/) 相同的首访模式 —— 页面内嵌 `<nos-version auto-install>` 自动检测 / 安装 Core，带进度条（Core 安装占 0-40%，配置加载占 40-100%）。因此本应用是可直接访问的首访入口，`index.html` / 资源引用走 jsdelivr 完整 URL（此时 `/gh/` 前缀尚不可用）。
3. **回填现有配置**：经 `/nos/fs` 读取 `nos-config/system.json`，若已有 `devBridge.script` 则填入输入框。
4. **保存**：合并写回 `system.json`（只改 `devBridge` 字段，不覆盖其他配置），然后 `fetch("/__config")` 触发 SW 重载配置即时生效；保存非空脚本后会自动 `location.reload()` 一次，让当前页面也带上注入脚本（`sessionStorage` 键 `__dev-app-script-saved-reloaded` 防止重复刷新；清空脚本时重置该标记，下次添加仍会刷新一次）。

## 清除本地数据

表单下方提供「清除本地数据」按钮，用于把容器重置回干净状态：

- 清空 `localStorage` / `sessionStorage`
- 删除全部 IndexedDB 数据库
- 删除 OPFS 根目录下**除 `nos` 前缀外**的所有条目（`nos-config` / ncomp 缓存等 Core 关键数据保留，避免破坏系统本体）

该功能**仅在开发者模式下可用**（复用与 sw.js 一致的 localhost + 30033-30040 校验），且采用二次点击确认（4 秒内再点一次才执行）。清除完成后建议刷新页面。

## URL 参数快捷配置

```
/apps/dev/?script=<encodeURIComponent(脚本URL)>
```

例：`/apps/dev/?script=http%3A%2F%2F127.0.0.1%3A8765%2Fclient.js`

带参访问时在 Core 就绪、配置回填完成后自动填入并确认保存，全程免手动操作；安全边界不变（仅限开发者模式允许的 host）。

## 安全提示

开发者模式会把脚本注入到本站**所有**页面（dev-bridge 自带防篡改警告横幅），请仅填写完全信任的脚本地址，开启期间勿在页面中输入敏感数据。

## 文件结构

| 文件 | 说明 |
|------|------|
| `index.html` | ofa.js 外壳（`<o-router>` + `<o-app>`），jsdelivr 完整 URL |
| `app-config.js` | `home = "./dev.html"`，不在顶层 `init()`（Core 由页面自己装） |
| `dev.html` | 页面模块：host 校验 → Core 安装进度 → 配置回填 / 保存 |
