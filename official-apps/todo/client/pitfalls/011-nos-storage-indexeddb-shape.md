# 011 · 用 `preview eval` 裸读 IndexedDB 核对持久化会「超时无返回」：NoneOS 存储的库名/表名与 `getStorage` 的 id 不一致

## 症状

自测「数据是否真的落盘」时，想绕开页面直接读存储，于是写了这样一段 `preview action=eval` 代码：

```js
const rq = indexedDB.open("keyval-store");           // 以为存在一个通用 keyval 库
rq.onsuccess = () => {
  const db = rq.result;
  const tx = db.transaction("keyval", "readonly");   // ← 这里抛 NotFoundError
  const g = tx.objectStore("keyval").get("conjure-todo-app.todos");
  g.onsuccess = () => res(g.result);
};
```

结果 **eval 直接等待 30s 超时失败**（报「调试指令 eval 等待结果超时」），没有报错、没有返回值——看起来像预览通道/页面卡死，很容易误判成应用出问题。改用 `indexedDB.open("conjure-todo-app")`（`getStorage` 的 id）也没用：库能打开但 `objectStoreNames` 是空的，因为那次 `open` **新建了一个同名空库**。

## 根因

- NoneOS 存储的 IndexedDB 布局与 `getStorage(id)` 的参数**不是一套命名**：`getStorage("conjure-todo-app")` 实际落在库 **`nos-storage-conjure-todo-app`**（前缀 `nos-storage-`），对象仓库名是 **`main`**，每条记录形如 `{ key: "todos", value: [...] }`（即一个 store 里按 key 存所有业务键，而不是「库名 = 应用 id、表名 = keyval」）。`keyval-store` 是别的东西（`handles-db` 之类同理），里面没有应用数据。
- `indexedDB.open(name)` 对不存在的库是**建库**而不是报错，于是「打开成功但没有任何 store」；随后 `db.transaction("keyval", ...)` 抛 `NotFoundError`。抛出发生在 `onsuccess` 回调里、又包在自己的 Promise 里，**Promise 永远不会 resolve**，eval 只能等到超时——现象是「静默超时」而不是「报错」。

## 正确姿势

- **核对持久化别裸读 IndexedDB**，两条更省事的路：
  1. `location.reload()` 硬刷新，读控制台里的埋点日志（本项目是 `[storage] 已读取待办，共 N 项` / `[group] 已读取分组，共 N 个`）——数据在不在、条数对不对一目了然；
  2. 真要看原始记录（键是否写入、字段长什么样），再按下面的写法直读。
- 真需要直读时，**库名/表名都要对号**：

```js
const rq = indexedDB.open("nos-storage-conjure-todo-app");   // 库名 = "nos-storage-" + getStorage(id)
rq.onsuccess = () => {
  const db = rq.result;
  const all = db.transaction("main", "readonly").objectStore("main").getAll(); // 仓库固定是 main
  all.onsuccess = () => all.result; // [{ key: "todos", value: [...] }, { key: "groups", value: [...] }]
};
```

- **在 eval 里给所有异步都加超时兜底**（`setTimeout(..., 1500)` 里 `res("TIMEOUT")`）并把 `try/catch` 包住 `transaction`：宁可拿到 `TIMEOUT` 字样的返回值，也不要让整条调试指令挂到 30s 超时（超时后连前面已取到的证据都拿不回来）。
