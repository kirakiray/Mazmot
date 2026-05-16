export default async function getCapability({ data = {}, content }) {
  const { all, name } = data;

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (all) {
    const capabilities = await fetch(import.meta.resolve("../used.json")).then(
      (e) => e.json(),
    );

    const capabilityDesc = [];

    for (const capabilityName of capabilities) {
      const capabilityMd = await fetch(`/caps/${capabilityName}/SKILL.md`).then(
        (e) => e.text(),
      );

      if (!capabilityMd.trim()) {
        continue;
      }

      const frontMatterMatch = capabilityMd.match(/^---\n([\s\S]*?)\n---/);
      let description = "";

      if (frontMatterMatch) {
        const frontMatter = frontMatterMatch[1];
        const descMatch = frontMatter.match(/^description:\s*(.+)$/m);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      capabilityDesc.push({
        name: capabilityName,
        desc: description,
      });
    }

    return capabilityDesc;
  }

  if (name) {
    try {
      const capabilityMd = await fetch(`/caps/${name}/SKILL.md`).then((e) =>
        e.text(),
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
        error: error.message || "Failed to fetch capability",
      };
    }
  }
}
