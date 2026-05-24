import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";

export default async function getSkill({ data = {}, content }) {
  const { all, name, file } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const skills = await fetch(
      import.meta.resolve("../../skills/used.json"),
    ).then((e) => e.json());

    const skillDesc = [];

    for (const skillName of skills) {
      const skillMd = await fetch(`/skills/${skillName}/SKILL.md`).then((e) =>
        e.text(),
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
      const filePath = file
        ? `/skills/${name}/${file}`
        : `/skills/${name}/SKILL.md`;

      const fileContent = await fetch(filePath).then((e) => {
        if (!e.ok) {
          throw new Error(`File not found: ${file || "SKILL.md"}`);
        }
        return e.text();
      });

      if (!fileContent.trim()) {
        return {
          name: name,
          file: file || "SKILL.md",
          error: "File is empty",
        };
      }

      return {
        name: name,
        file: file || "SKILL.md",
        content: fileContent,
      };
    } catch (error) {
      return {
        name: name,
        file: file || "SKILL.md",
        error: "Skill not found",
      };
    }
  }
}
