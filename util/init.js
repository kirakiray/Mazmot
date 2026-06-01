import { get, init } from "/nos/fs/main.js";

export async function writeJsonToNos(jsonData, rootDir) {
  for (const [capName, files] of Object.entries(jsonData)) {
    for (const [filePath, fileData] of Object.entries(files)) {
      const fullPath = `${rootDir}/${capName}/${filePath}`;
      const file = await get(fullPath, { create: "file" });
      const existingContent = await file.text();
      if (!existingContent.trim()) {
        await file.write(fileData.text);
      }
    }
  }
}

export default async function initNos() {
  await init("mazmot");

  const capabilitiesRes = await fetch("/dist/capabilities.json");
  const capabilitiesData = await capabilitiesRes.json();
  await writeJsonToNos(capabilitiesData, "mazmot/capabilities");

  const skillsRes = await fetch("/dist/skills.json");
  const skillsData = await skillsRes.json();
  await writeJsonToNos(skillsData, "mazmot/skills");

  console.log("Capabilities and skills initialized");
}
