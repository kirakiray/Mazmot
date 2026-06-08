import { get } from "/nos/fs/main.js";

async function shouldWriteFile(path) {
  try {
    const handle = await get(path);
    const content = await handle.text();
    return !content || content.trim() === "";
  } catch (e) {
    return true;
  }
}

async function writeFileIfEmpty(path, content) {
  if (await shouldWriteFile(path)) {
    const handle = await get(path, { create: "file" });
    await handle.write(content);
  }
}

export async function initCode(projectPath, onProgress) {
  const { files: fileList } = await fetch(
    import.meta.resolve("./temp-file/__files.json"),
  ).then((res) => res.json());

  const files = {};
  for (const filePath of fileList) {
    files[filePath] = await fetch(
      import.meta.resolve(`./temp-file/${filePath}`),
    ).then((res) => res.text());
  }

  const entries = Object.entries(files);
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    const [filePath, code] = entries[i];

    if (onProgress) {
      onProgress({
        current: i + 1,
        total,
        file: filePath,
        message: `正在创建 ${filePath}...`,
      });
    }

    const fullPath = `${projectPath}/${filePath}`;
    await writeFileIfEmpty(fullPath, code);
  }

  if (onProgress) {
    onProgress({
      current: total,
      total,
      file: null,
      message: "创建完成！",
    });
  }
}
