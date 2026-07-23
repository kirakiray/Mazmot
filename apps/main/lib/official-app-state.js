import { storage } from "https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js";

// 共享的 stanz 状态对象，直接持有从官方市场已安装的应用列表
// 数据来源：已安装的应用列表（storage.apps）中 source === "official" 的记录
export const officialAppState = $.stanz({
  installedApps: [],
});

// 从已安装的应用列表（storage.apps）同步官方应用记录
// 删除/安装应用后调用，确保状态与持久化数据一致
export async function syncOfficialAppState() {
  try {
    const storedApps = (await storage.apps) || [];
    officialAppState.installedApps = storedApps.filter(
      (app) => app.source === "official" && app.officialId,
    );
  } catch (e) {
    console.warn("同步官方应用状态失败：", e);
  }
}
