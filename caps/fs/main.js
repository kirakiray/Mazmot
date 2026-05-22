import { get } from "/nos/fs/main.js";

export default async function fs({ data = {}, content }) {
  const { mode, path } = data;

  if (!mode) {
    throw new Error("mode is required");
  }
  if (!path) {
    throw new Error("path is required");
  }

  const handle = await get(path, {
    create: "file",
  });

  if (mode === "write") {
    await handle.write(content);
    return true;
  }

  if (mode === "read") {
    const content = await handle.text();
    return content;
  }

  // 删除文件
  if (mode === "delete") {
    await handle.remove();
    return true;
  }

  // 其他不明模式
  debugger;
  return false;
}
