import { storage } from "https://cdn.jsdelivr.net/gh/kirakiray/ever-cache/src/main.min.js";

// 共享的 stanz 状态对象，存储已安装的官方应用 id 列表
// 所有需要感知官方应用安装状态的页面都应 watch 此对象
export const officialAppState = $.stanz({
  installedIds: [],
});

// 从持久化数据源 storage.apps 同步已安装的官方应用 id
// 删除/安装应用后调用，确保状态与持久化数据一致
export async function syncOfficialAppState() {
  try {
    const storedApps = (await storage.apps) || [];
    officialAppState.installedIds = storedApps
      .filter((app) => app.source === "official" && app.officialId)
      .map((app) => app.officialId);
  } catch (e) {
    console.warn("同步官方应用状态失败：", e);
  }
}
