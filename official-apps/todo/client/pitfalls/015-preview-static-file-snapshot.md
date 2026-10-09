# 015 · 预览域里的静态文件（CONTEXT.md 等）是「推送时快照」：改完文档立刻 fetch 会读到旧内容

## 症状

改完 `CONTEXT.md`（edit_file 返回「已编辑，应用 N 处修改」），想省 token、于是用 `preview eval` 里 `await (await fetch("./CONTEXT.md")).text()` 复核是否还有残留的旧词——结果查出来全是**旧文本**（比如刚删掉的「清除已完成」还在、刚写的新段落找不到）。

此时极易误判为「edit_file 没生效」「文档被回滚了」，进而重复改一遍或推翻自己刚写的文档。

## 根因

`preview action=app` 把 `client/` **复制**到预览域（`/$conjure-apps/<app>/client/` 或 `/$ai-apps/<app>/client/`）里运行；该副本是**推送那一刻的快照**。此后对源文件的 edit_file/write_file 只改虚拟目录（或本地目录）里的源文件，**不会同步到预览域**，直到下一次 `action=app`。

所以「应用代码」的验证必须靠重新推送（这也是 `action=app` 的意义），而**文档类文件**（`CONTEXT.md` / `MEMORY.md` / `AGENTS.md` / `pitfalls/*`）根本不在运行时被加载，用 fetch 复核它们没有意义。

## 正确姿势

- 想用 fetch 复核文档内容时：**先 `preview action=app` 重推一次**，再 fetch——此时读到的是最新副本（本坑实测：重推后立刻读到新内容，全部关键词命中新文案）。
- 更省的做法：复核当前源文件用 `read_file`（读的是真实源文件，不受快照影响），只在需要「按行号定位旧词残留」时才走 fetch 这条（fetch + 行号过滤比整文件 read_file 省很多 token，但要记得先重推）。
- 记住这条边界：**预览域 = 最近一次推送的快照**，与源文件在推送后即可分叉；不要把它当成磁盘的镜像。
