/* ---------- 技能知识库 ----------
 * 技能索引的装载 / 后台增量同步 / 用户主动安装。索引真值在共享资源包
 * res.skillIndex（ensureAgent 组装系统提示词时读取），镜像经 state.skills
 * 同步给页面。
 */

import {
  syncSkills,
  loadSkillIndex,
  installSkillFromUrl,
  idFromUrl,
  getSkillSources,
  setSkillSources,
} from "../skill-sync.js";

export function createSkillsPart(api) {
  const { set, fs, selfStore, res } = api;

  // 后台任务：按技能源清单下载安装到 VFS skills 空间（zip / 裸 SKILL.md），
  // 同内容（sha256 一致）跳过写入；离线或单个失败保留已有副本不影响使用
  async function backgroundSyncSkills() {
    try {
      const { changed } = await syncSkills({ fs, storage: selfStore });
      if (changed) {
        res.skillIndex = await loadSkillIndex(fs);
        set("skills", [...res.skillIndex]);
        api.invalidateAgent(); // 提示词中的技能清单随之更新
      }
    } catch (err) {
      console.warn("技能后台同步失败：", err);
    }
  }

  async function reloadSkillIndex() {
    res.skillIndex = await loadSkillIndex(fs);
    set("skills", [...res.skillIndex]);
  }

  // 用户主动安装 / 更新技能：先把 loading 占位放到列表，下载完成后刷新索引。
  // 同 id 已存在则原地置为 loading（即更新）；来源登记进 skill-sources，
  // 之后后台同步也会持续检查这个地址。失败抛错由 UI 提示并回滚占位。
  async function installSkillFromSource(url) {
    const trimmed = String(url || "").trim();
    if (!/^(https?:\/\/|\/)/.test(trimmed)) {
      throw new Error("请输入 http(s) 或站内 / 开头的技能地址");
    }
    const id = idFromUrl(trimmed);

    const existing = res.skillIndex.find((s) => s.id === id);
    if (existing) {
      set(
        "skills",
        res.skillIndex.map((s) => (s.id === id ? { ...s, loading: true } : s)),
      );
    } else {
      set("skills", [
        ...res.skillIndex,
        { id, name: id, version: "", description: "正在下载…", source: trimmed, loading: true },
      ]);
    }

    try {
      await installSkillFromUrl(fs, trimmed);
      await reloadSkillIndex();
      api.invalidateAgent(); // 提示词中的技能清单随之更新
      if (selfStore) {
        const urls = await getSkillSources(selfStore);
        if (!urls.includes(trimmed)) {
          await setSkillSources(selfStore, [...urls, trimmed]);
        }
      }
    } catch (err) {
      await reloadSkillIndex(); // 回滚 loading 占位
      throw err;
    }
  }

  return { backgroundSyncSkills, reloadSkillIndex, installSkillFromSource };
}
