/* ---------- 写入目标（仅草稿阶段）与应用打开 ----------
 * 虚拟系统 / 本地目录两种写入渠道的偏好切换、本地句柄的授权与选择；
 * openApp / openLocalApp 负责把应用在独立标签页打开（本地渠道先恢复句柄）。
 */

import {
  sanitizeAppName,
  registerAppRecord,
  buildLocalAppRecord,
  buildRunUrl,
  detectLocalProject,
} from "../builder.js";

export function createStoragePart(api) {
  const { state, set, setMany, fs, mazmotStore, load, res } = api;

  async function selectMode(mode) {
    if (state.storageMode === mode) return;
    if (mode === "local" && !res.localRootHandle) {
      const ok = await chooseLocalDir();
      if (ok) {
        set("storageMode", mode);
        api.invalidateAgent(); // 工具根目录随目标变化
      }
      return;
    }
    set("storageMode", mode);
    api.invalidateAgent();
  }

  // 确认句柄的读写权限：已授权直接通过；仅剩 prompt 状态则借助用户手势
  // requestPermission 补授权（刷新后句柄仍在但权限重置的场景）；被拒/异常返回 false
  async function ensureLocalPermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return false;
    }
    const opts = { mode: "readwrite" };
    try {
      if ((await handle.queryPermission(opts)) === "granted") {
        return true;
      }
      if ((await handle.requestPermission(opts)) !== "granted") {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // 「授权目录」：主动补授权本地句柄（需在用户手势调用链内 requestPermission）
  async function grantLocalPermission() {
    if (!res.localRootHandle) {
      set("permGrantNeeded", false);
      return;
    }
    if (await ensureLocalPermission(res.localRootHandle)) {
      setMany({ keyError: "", permGrantNeeded: false });
    } else {
      set("keyError", "授权未完成，可再次点击授权，或重新选择目录。");
    }
  }

  // fs.open() 打开本地目录选择器（仅 Chrome 支持），成功返回 true；
  // 用户取消（AbortError）静默返回 false，不算失败
  async function chooseLocalDir() {
    if (!fs || typeof fs.open !== "function") {
      set(
        "keyError",
        "当前环境不支持本地目录选择（fs.open 仅 Chrome 可用），请使用「虚拟系统」渠道。",
      );
      return false;
    }
    try {
      let handle = await fs.open();
      if (!handle) return false; // 用户取消
      // nos-storage 按路径引用存句柄：open() 的本地目录必须先 mount()，
      // 否则登记记录写 mazmot apps[] 时 setItem 直接抛错（句柄存不进去）
      if (typeof fs.mount === "function") {
        try {
          handle = await fs.mount(handle);
        } catch (err) {
          set("keyError", `挂载本地目录失败：${err.message}`);
          return false;
        }
      }
      res.localRootHandle = handle;
      setMany({
        localDirLabel: handle.name || "本地目录",
        keyError: "",
        permGrantNeeded: false,
      });
      // 草稿阶段选中的目录已是既有项目（client/app.json 存在）：
      // 走导入流程恢复项目与对话数据，而不是当作新项目
      if (state.currentAppName === "") {
        try {
          const meta = await detectLocalProject(handle);
          if (meta && meta.name) {
            await api.importLocalProject(meta, handle);
            return true;
          }
        } catch (err) {
          console.warn("导入本地项目失败：", err);
          set("keyError", `导入本地项目失败：${err.message}`);
        }
      }
      // 旧应用补救：已登记的本地应用记录可能缺失句柄（mount 修复前
      // 入库失败），重选目录后把新挂载句柄写回登记记录
      if (
        mazmotStore &&
        state.currentAppName !== "" &&
        state.currentAppMode === "local"
      ) {
        try {
          await registerAppRecord(
            mazmotStore,
            buildLocalAppRecord({
              name: state.currentAppName,
              displayName: state.currentAppDisplay,
              icon: state.currentAppIcon,
              handle,
            }),
          );
        } catch (err) {
          console.warn("更新应用登记句柄失败：", err);
        }
      }
      return true;
    } catch (err) {
      if (err?.name === "AbortError") return false; // 用户关闭选择器
      set("keyError", `选择本地目录失败：${err.message}`);
      return false;
    }
  }

  /* ---------- 打开应用（独立标签页） ---------- */

  function openApp(appName, mode) {
    const name = sanitizeAppName(appName);
    if (!name) return;
    if (mode === "local") {
      openLocalApp(name);
      return;
    }
    window.open(buildRunUrl(name), `mazmot-app-${name}`);
  }

  // 本地目录应用：应用文件在所选目录的 client/ 子目录（与虚拟渠道布局一致）
  // （app-runner 的 getRunUrl 本地逻辑会挂载 client/，不存在时回退挂载根目录）
  async function openLocalApp(name) {
    if (!res.localRootHandle) {
      const fromRecord = await api.getLocalHandleFromRecord(name);
      if (fromRecord) {
        res.localRootHandle = fromRecord;
        set("localDirLabel", res.localRootHandle?.name || "");
      }
    }
    if (res.localRootHandle) {
      // 刷新后权限重置：requestPermission 补授权，失败回退重选
      const granted = await ensureLocalPermission(res.localRootHandle);
      if (!granted) {
        const ok = await chooseLocalDir();
        if (!ok) return;
      }
    } else {
      const ok = await chooseLocalDir();
      if (!ok) return;
    }
    try {
      const { getRunUrl } = await load("/mz/app-runner.js");
      const url = await getRunUrl({
        source: "local",
        _handle: res.localRootHandle,
      });
      window.open(url, `mazmot-app-${name}`);
    } catch (err) {
      set("keyError", `打开应用失败：${err.message}`);
    }
  }

  return {
    selectMode,
    ensureLocalPermission,
    grantLocalPermission,
    chooseLocalDir,
    openApp,
    openLocalApp,
  };
}
