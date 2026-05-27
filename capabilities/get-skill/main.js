import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";
import { get } from "/nos/fs/main.js";

export default async function getSkill({ data = {}, content }) {
  const { all, name, file } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const skillDesc = [];

    try {
      const skillDir = await get("mazmot/skills");

      if (skillDir) {
        for await (const [skillName, handle] of skillDir.entries()) {
          if (handle.kind === "dir") {
            const skillFile = await get(`mazmot/skills/${skillName}/SKILL.md`, {
              create: false,
            });

            if (skillFile) {
              const skillMd = await skillFile.text();

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
          }
        }
      }
    } catch (error) {
      console.error("Error reading skills:", error);
    }

    return skillDesc;
  }

  if (name) {
    try {
      const filePath = file
        ? `mazmot/skills/${name}/${file}`
        : `mazmot/skills/${name}/SKILL.md`;

      const fileHandle = await get(filePath, { create: false });

      if (!fileHandle) {
        return {
          name: name,
          file: file || "SKILL.md",
          error: "Skill not found",
        };
      }

      const fileContent = await fileHandle.text();

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
