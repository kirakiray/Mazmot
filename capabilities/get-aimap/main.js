import { get } from "/nos/fs/main.js";

export default async ({ data = {}, content }) => {
  const { projectPath } = data;

  if (!projectPath) {
    throw new Error("projectPath is required");
  }

  const projectDir = await get(projectPath);

  const aimapList = await collectAimapFiles(projectDir, projectPath);

  return {
    aimaps: aimapList,
  };
};

async function collectAimapFiles(dir, basePath, currentPath = "") {
  const aimapList = [];

  try {
    const aimapDir = await dir.get(".aimap");
    if (aimapDir?.kind === "dir") {
      for await (const [name, handle] of aimapDir.entries()) {
        if (handle.kind === "file" && name.endsWith(".md")) {
          try {
            const content = await handle.text();
            const originalFileName = name.slice(0, -3);
            aimapList.push({
              path: currentPath
                ? `${currentPath}/${originalFileName}`
                : originalFileName,
              aimapPath: currentPath
                ? `${currentPath}/.aimap/${name}`
                : `.aimap/${name}`,
              content: content.trim(),
            });
          } catch (error) {
            console.error(`Error reading aimap file ${name}:`, error);
          }
        }
      }
    }
  } catch (e) {}

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "dir" && name !== ".aimap" && !name.startsWith(".")) {
      const subPath = currentPath ? `${currentPath}/${name}` : name;
      aimapList.push(...(await collectAimapFiles(handle, basePath, subPath)));
    }
  }

  return aimapList;
}
