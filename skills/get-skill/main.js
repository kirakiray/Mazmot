export default async function getSkill(options) {
  const { all, name } = options;

  if (all) {
    const skills = await fetch(import.meta.resolve("../used.json")).then((e) =>
      e.json(),
    );

    // 获取顶部技能描述
    const skillDesc = [];

    for (const skillName of skills) {
      const skillMd = await fetch(`/skills/${skillName}/SKILL.md`).then((e) =>
        e.text(),
      );

      if (!skillMd.trim()) {
        continue;
      }

      // 解析 YAML front matter 获取描述
      const frontMatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
      let description = "";

      if (frontMatterMatch) {
        const frontMatter = frontMatterMatch[1];
        const descMatch = frontMatter.match(/^description:\s*(.+)$/m);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      skillDesc.push({
        name: skillName,
        desc: description,
      });
    }

    return skillDesc;
  }

  if (name) {
    // 返回特定技能的详细描述
    debugger;
  }
}
