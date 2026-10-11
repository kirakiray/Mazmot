# 020 · `preview action=app` 返回 ACK timeout，但推送其实已经生效

## 症状

`preview action=app` 报错：

```
操作失败：ACK timeout after 4 retries: m-1791623681673-3
```

看起来像推送失败、预览里还是旧代码。但**同一时刻** `action=status` / `action=eval` 都正常（代理在线、页面能执行 JS），`action=windows` 反而报「宿主未注入预览通道」。

## 真相

推送动作已经落到了预览域，只是**回执（ACK）没回来**：`eval` 查页面 shadowRoot，新模板里的节点（`全部归档` / `agroup-head`）**已经在里面了**。也就是说 ACK timeout 只说明「消息回执丢了」，不等于「推送没执行」。

## 正确姿势

1. **不要因为 ACK timeout 就反复重推**（我连推了两次都是同样的 timeout，纯浪费回合）。
2. 用一条 `eval` **判定推送是否生效**，看新写入的内容是否出现：

```js
const r = document.querySelector('o-page').shadowRoot;
return { hasTabs: r.innerHTML.indexOf('全部归档') !== -1 };
```

3. 生效 → 直接继续调试（后续 `eval` / `console` / `dom` 都正常）；没生效 → 再考虑重推或查别的原因。

## 附带结论（本会话环境）

- 本会话 `action=run-tests` 与 `action=windows` 都报「宿主未注入预览通道」，但 `status` / `eval` / `console` / `dom` 可用 → 测试仍走 `test/_driver.js` 本地分片回放（见踩坑 018）。
- 判定「新模板是否已生效」不要靠 `innerHTML.indexOf('xxx')` 去找 **`<script>` 里的代码**：ofa 不把 script 内容留在 shadowRoot 的 innerHTML 里（实测搜 `archiveGroupMode` 为 false、搜模板里的中文文案为 true），要搜**模板 DOM 里的文案 / 类名**。
