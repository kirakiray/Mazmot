import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";
import { get } from "/nos/fs/main.js";

export default async function getCapability({ data = {}, content }) {
  const { all, name } = data;

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
      const skillFile = await get(`mazmot/capabilities/${name}/SKILL.md`, {
        create: false,
      });

      if (!skillFile) {
        return {
          name: name,
          error: "Capability not found",
        };
      }

      const capabilityMd = await skillFile.text();

      if (!capabilityMd.trim()) {
        return {
          name: name,
          error: "Capability not found",
        };
      }

      return {
        name: name,
        content: capabilityMd,
      };
    } catch (error) {
      return {
        name: name,
        error: "Capability not found",
      };
    }
  }
}
