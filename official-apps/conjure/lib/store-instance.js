/* ---------- 会话仓库单例（home / trash 两个路由页面共享） ----------
 * 妙造拆出回收站路由页后，会话仓库必须跨页共享同一实例：home 常驻路由栈，
 * 正常路径由 home 先创建；刷新按 hash 直接落在 trash（o-router 会从
 * history.state 恢复整栈重建，此时两个页面工厂并发引导）时也能拿到同一份。
 * 模块级缓存 + Promise 去重保证只创建一次；init（含 ?p=<name> 初始项目
 * 解析）在引导内完成，参数固定从地址栏取——谁先到结果都一致。
 * Core 依赖在此运行时装载：本模块以真实 URL 加载，允许绝对路径动态
 * import（不用 ofa 的 lm 全局）；builder.sb 的用例直连 builder-store.js、
 * 不经过本模块，虚拟空间注入不受影响。
 */

import { createBuilderStore } from "./builder-store.js";

let instance = null;
let booting = null;
let selfStoreRef = null; // 用户空间存储（conjure）：home 页偏好读写直接用

async function bootstrap() {
  let fs = null;
  let mazmotStore = null;
  let selfStore = null;
  try {
    fs = await import("/nos/fs/main.js");
    const { getStorage } = await import("/nos/storage/main.js");
    mazmotStore = getStorage("mazmot");
    selfStore = getStorage("conjure");
  } catch (err) {
    console.warn("NoneOS Core 不可用，生成功能受限：", err);
  }
  selfStoreRef = selfStore;
  const store = createBuilderStore({
    fs,
    mazmotStore,
    selfStore,
    load: (u) => import(u),
  });
  const initialApp = new URLSearchParams(location.search).get("p") || "";
  await store.init({ initialApp });
  instance = store;
  return store;
}

/** 取共享仓库（首次调用完成 Core 装载 + init，后续调用直接返回） */
export function getBuilderStore() {
  if (instance) return Promise.resolve(instance);
  if (!booting) booting = bootstrap().finally(() => (booting = null));
  return booting;
}

/** 用户空间存储（conjure）引用：Core 不可用时为 null（调用方自行降级） */
export function getSelfStore() {
  return selfStoreRef;
}
