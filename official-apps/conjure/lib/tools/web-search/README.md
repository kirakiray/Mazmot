# web_search —— 联网搜索工具

妙造（conjure）的联网搜索入口：让 AI Agent 用关键词搜索，返回相关网页结果列表（标题 / 链接 / 摘要），配合 `web_fetch` 抓取具体页面读全文。

## 工作方式

```
web_search 工具（本包）
   → ctx.netSearch（builder-store 注入 = /mz/net 的 searchWeb）
      → searchWeb（mz 内实现）：fetch 抓搜索引擎结果页（通道同 web fetch）
        → DOMParser 解析出结果列表（引擎可插拔：默认引擎可在 Mazmot 设置切换，
          缺省 DuckDuckGo 无 JS 版）
```

服务端零搜索功能——任何能 fetch 的通道自动获得搜索。best-effort：引擎改版/反爬时解析失败抛可读错误。详见 [/mz/net/README.md](../../../../mz/net/README.md)「搜索」。

## 工具契约

- `schema`：`{ query: string, maxResults?: number }`
- 返回：元信息头（provider / 查询词 / 条数）+ 编号列表（标题 / URL / 摘要前 200 字符）；全文用 `web_fetch` 抓

## 文件

- `index.js` —— 插件本体
- `self-test.js` —— 内置测试模组（mock netSearch，不出网）
- `test/web-search.sb.html` —— sibyl-test 用例（同 mock 思路）
