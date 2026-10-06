# web_fetch —— 联网抓取工具

妙造（conjure）的联网能力入口：让 AI Agent 能抓取公开网页 / HTTP 接口的文本内容。

## 工作方式

```
web_fetch 工具（本包）
   → ctx.netFetch（builder-store 注入 = /mz/net 的 fetchText）
      → provider 解析：自定义端点 > relay 邀请码 > 官方 web-hub > Jina Reader 兜底
         → 服务端中转抓取（浏览器 CORS 无法直抓跨域站点）
```

协议契约、provider 鉴权与安全约束见 [/mz/net/README.md](../../../../mz/net/README.md)（单一事实来源，本文件不重复）。

## 工具契约

- `schema`：`{ url: string, raw?: boolean }`
- 返回：首行元信息头（provider / HTTP 状态 / 最终 URL / Content-Type / 是否截断）+ 正文文本
- 正文处理链：mz/net 层去 HTML 标签提取正文 + 2 万字符截断 → 工具层再截到 1.2 万字符（省上下文）

## 文件

- `index.js` —— 插件本体（key/name/description/schema/exec + selfTest 地址）
- `self-test.js` —— 内置测试模组（mock netFetch，不出网；工具详情对话框「内置测试」Tab 加载）
- `test/web-fetch.sb.html` —— sibyl-test 用例（不出网，同 mock 思路）
