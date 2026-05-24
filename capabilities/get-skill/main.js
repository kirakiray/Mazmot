import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";

export default async function getSkill({ data = {}, content }) {
  const { all, name } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const skills = await fetch(import.meta.resolve("../../skills/used.json")).then(
      (e) => e.json(),
    );

    const skillDesc = [];

    for (const skillName of skills) {
      const skillMd = await fetch(`/skills/${skillName}/SKILL.md`).then(
        (e) => e.text(),
      );

      if (!skillMd.trim()) {
        continue;
      }

      const frontMatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
      const yamlConfig = yaml.load(frontMatterMatch[1]);

      const desc = yamlConfig.description;
      delete yamlConfig.description;

      skillDesc.push({
        ...yamlConfig,
        name: skillName,
        desc,
      });
    }

    return skillDesc;
  }

  if (name) {
    try {
      const skillMd = await fetch(`/skills/${name}/SKILL.md`).then((e) =>
        e.text(),
      );

      if (!skillMd.trim()) {
        return {
          name: name,
          error: "Skill not found",
        };
      }

      return {
        name: name,
        content: skillMd,
      };
    } catch (error) {
      return {
        name: name,
        error: error.message || "Failed to fetch skill",
      };
    }
  }
}
