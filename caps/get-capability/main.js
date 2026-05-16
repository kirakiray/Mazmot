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
    const capabilityDesc = [];

    for (const capabilityName of name) {
      try {
        const capabilityMd = await fetch(
          `/caps/${capabilityName}/SKILL.md`,
        ).then((e) => e.text());

        if (!capabilityMd.trim()) {
          capabilityDesc.push({
            name: capabilityName,
            error: "Capability not found",
          });
          continue;
        }

        capabilityDesc.push({
          name: capabilityName,
          content: capabilityMd,
        });
      } catch (error) {
        capabilityDesc.push({
          name: capabilityName,
          error: error.message || "Failed to fetch capability",
        });
      }
    }

    return capabilityDesc;
  }
}
