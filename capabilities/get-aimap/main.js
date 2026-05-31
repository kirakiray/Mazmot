import { get } from "/nos/fs/main.js";

export default async ({ data = {}, content }) => {
  const { projectPath } = data;

  if (!projectPath) {
    throw new Error("projectPath is required");
  }

  const projectDir = await get(projectPath);

  const aimapList = await collectAimapFiles(projectDir, projectPath);

  debugger;

  return {
    data: {
      aimaps: aimapList,
    },
  };
};

async function collectAimapFiles(dir, basePath, currentPath = "") {
  const aimapList = [];
  
  try {
    const aimapDirPath = currentPath ? `${currentPath}/.aimap` : ".aimap";

    try {
      const aimapDir = await dir.get(aimapDirPath);

      if (aimapDir && aimapDir.kind === "dir") {
        const aimaps = await collectAimapFromDir(aimapDir, basePath, currentPath);
        aimapList.push(...aimaps);
      }
    } catch (e) {
      // .aimap 目录不存在，继续处理子目录
    }

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "dir" && name !== ".aimap" && !name.startsWith(".")) {
        const subPath = currentPath ? `${currentPath}/${name}` : name;
        const subAimaps = await collectAimapFiles(handle, basePath, subPath);
        aimapList.push(...subAimaps);
      }
    }
  } catch (error) {
    console.error(`Error collecting aimap files from ${currentPath}:`, error);
  }
  
  return aimapList;
}

async function collectAimapFromDir(aimapDir, basePath, currentPath) {
  const aimapList = [];
  
  for await (const [name, handle] of aimapDir.entries()) {
    if (handle.kind === "file" && name.endsWith(".md")) {
      try {
        const content = await handle.text();

        const originalFileName = name.slice(0, -3);
        const originalFilePath = currentPath
          ? `${currentPath}/${originalFileName}`
          : originalFileName;

        const aimapPath = currentPath
          ? `${currentPath}/.aimap/${name}`
          : `.aimap/${name}`;

        aimapList.push({
          path: originalFilePath,
          aimapPath: aimapPath,
          content: content.trim(),
        });
      } catch (error) {
        console.error(`Error reading aimap file ${name}:`, error);
      }
    }
  }
  
  return aimapList;
}
