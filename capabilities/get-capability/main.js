import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";

export default async function getCapability({ data = {}, content }) {
  const { all, name } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const capabilities = await fetch(import.meta.resolve("../used.json")).then(
      (e) => e.json(),
    );

    const capabilityDesc = [];

    for (const capabilityName of capabilities) {
      const capabilityMd = await fetch(
        `/capabilities/${capabilityName}/SKILL.md`,
      ).then((e) => e.text());

      if (!capabilityMd.trim()) {
        continue;
      }

      const frontMatterMatch = capabilityMd.match(/^---\n([\s\S]*?)\n---/);
      const yamlConfig = yaml.load(frontMatterMatch[1]);

      const desc = yamlConfig.description;
      delete yamlConfig.description;

      capabilityDesc.push({
        ...yamlConfig,
        name: capabilityName,
        desc,
      });
    }

    return capabilityDesc;
  }

  if (name) {
    try {
      const capabilityMd = await fetch(`/capabilities/${name}/SKILL.md`).then(
        (e) => e.text(),
      );

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
