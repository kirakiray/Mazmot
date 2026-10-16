/* ---------- locale-text 多语种翻译（开发工具） ----------
 * 供「工具」面板的翻译工具调用：扫描当前应用的 client/ 源码提取文案条目
 * （<locale-text> 组件与 getLocaleText 调用），与已有 client/locale-text.json
 * 增量合并；编辑后的翻译表经 localeSave 写回应用根目录。提取与合并的纯函数
 * 在 lib/locale-tool.js，本领域只做应用文件 IO（虚拟 / 本地渠道统一走
 * builder.js 的 listAppFiles / readAppFile / writeAppFile 抽象）。
 * appName 由调用方显式传入（对话框打开时快照），防止扫描与保存之间用户
 * 切换项目导致读写串到别的应用。
 */

import { listAppFiles, readAppFile, writeAppFile } from "../builder.js";
import { buildLocaleIndex, mergeLocaleMap } from "../locale-tool.js";

export function createLocalePart(api) {
  const { state, fs, res } = api;

  // 应用对应的写入渠道：本地项目走挂载的根目录句柄，虚拟项目走 VFS
  const rootHandleFor = (appName) =>
    (state.apps.find((a) => a.name === appName)?.mode || "vfs") === "local"
      ? res.localRootHandle
      : undefined;

  /**
   * 扫描应用源码并合并翻译表（只读不写）。返回：
   * { appName, filesScanned, hitFiles, finalMap, records, orphaned,
   *   added, updated, kept }；没有选中的应用返回 null。
   */
  async function localeScan(appName) {
    const clean = String(appName || "").trim();
    if (!clean) return null;
    const rootHandle = rootHandleFor(clean);

    const sourcePaths = (await listAppFiles(fs, clean, rootHandle)).filter((p) =>
      /\.(html|js|mjs)$/.test(p),
    );
    const files = [];
    for (const p of sourcePaths) {
      const text = await readAppFile(fs, clean, p, rootHandle);
      if (typeof text === "string") files.push({ path: p, text });
    }
    const { entries, hitFiles } = await buildLocaleIndex(files);

    let existing = {};
    const raw = await readAppFile(fs, clean, "locale-text.json", rootHandle);
    if (raw) {
      try {
        existing = JSON.parse(raw) || {};
      } catch {
        existing = {}; // 已有 JSON 损坏时按空表处理，扫描结果仍可生成
      }
    }
    const merged = await mergeLocaleMap(existing, entries);
    return { appName: clean, filesScanned: files.length, hitFiles, ...merged };
  }

  /** 把编辑后的翻译表写回 client/locale-text.json（JSON 两空格缩进） */
  async function localeSave(appName, map) {
    const clean = String(appName || "").trim();
    if (!clean) throw new Error("没有选中的应用");
    if (!map || typeof map !== "object") throw new Error("翻译表格式错误");
    await writeAppFile(
      fs,
      clean,
      "locale-text.json",
      JSON.stringify(map, null, 2) + "\n",
      rootHandleFor(clean),
    );
    return { appName: clean, entries: Object.keys(map).length };
  }

  return { localeScan, localeSave };
}
