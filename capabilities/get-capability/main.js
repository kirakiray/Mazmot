import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";
import { get } from "/nos/fs/main.js";

export default async function getCapability({ data = {}, content }) {
  const { all, name, file } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const capabilityDesc = [];

    try {
      const capDir = await get("mazmot/capabilities");

      if (capDir) {
        for await (const [capabilityName, handle] of capDir.entries()) {
          if (handle.kind === "dir") {
            const skillFile = await get(
              `mazmot/capabilities/${capabilityName}/SKILL.md`,
              { create: false },
            );

            if (skillFile) {
              const capabilityMd = await skillFile.text();

              if (!capabilityMd.trim()) {
                continue;
              }

              const frontMatterMatch = capabilityMd.match(
                /^---\n([\s\S]*?)\n---/,
              );
              const yamlConfig = yaml.load(frontMatterMatch[1]);

              const desc = yamlConfig.description;
              delete yamlConfig.description;

              capabilityDesc.push({
                ...yamlConfig,
                name: capabilityName,
                desc,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error("Error reading capabilities:", error);
    }

    return capabilityDesc;
  }

  if (name) {
    try {
      const filePath = file
        ? `mazmot/capabilities/${name}/${file}`
        : `mazmot/capabilities/${name}/SKILL.md`;

      const fileHandle = await get(filePath, { create: false });

      if (!fileHandle) {
        return {
          name: name,
          file: file || "SKILL.md",
          error: "Capability not found",
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
        error: "Capability not found",
      };
    }
  }
}
