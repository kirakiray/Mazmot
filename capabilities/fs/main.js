import { get } from "/nos/fs/main.js";

export default async function fs({ data = {}, content }) {
  const { mode, path, targetPath, targetName } = data;

  if (!mode) {
    throw new Error("mode is required");
  }
  if (!path) {
    throw new Error("path is required");
  }

  if (mode === "exists") {
    try {
      const testHandle = await get(path);
      return testHandle ? true : false;
    } catch (e) {
      return false;
    }
  }

  const handle = await get(path, {
    create:
      mode === "write" || mode === "mkdir"
        ? mode === "mkdir"
          ? "dir"
          : "file"
        : undefined,
  });

  if (mode === "write") {
    const temp = $(`<template>${content}</template>`);

    debugger;

    let textToWrite = temp.$("script[type='text/plain']").html.trim();

    debugger;

    // const scriptMatch = content.match(
    //   /<script\s+type=["']text\/plain["'][^>]*>([\s\S]*)<\/script>/i,
    // );
    // if (scriptMatch) {
    //   textToWrite = scriptMatch[1];
    // }

    await handle.write(textToWrite);
    return true;
  }

  if (mode === "read") {
    const content = await handle.text();
    return content;
  }

  if (mode === "delete") {
    await handle.remove();
    return true;
  }

  if (mode === "info") {
    const file = await handle.file();
    const lastModified = await handle.lastModified();
    return {
      kind: handle.kind,
      name: handle.name,
      path: handle.path,
      size: file.size,
      lastModified,
    };
  }

  if (mode === "list") {
    if (handle.kind !== "dir") {
      throw new Error("Path is not a directory");
    }

    const items = [];
    await handle.forEach((name, item) => {
      items.push({
        name,
        kind: item.kind,
        path: item.path,
      });
    });
    return items;
  }

  if (mode === "mkdir") {
    return true;
  }

  if (mode === "move") {
    if (!targetPath) {
      throw new Error("targetPath is required for move operation");
    }
    const targetDir = await get(targetPath, { create: "dir" });
    const movedHandle = await handle.moveTo(targetDir, targetName);
    return {
      kind: movedHandle.kind,
      name: movedHandle.name,
      path: movedHandle.path,
    };
  }

  if (mode === "copy") {
    if (!targetPath) {
      throw new Error("targetPath is required for copy operation");
    }
    const targetDir = await get(targetPath, { create: "dir" });
    const copiedHandle = await handle.copyTo(targetDir, targetName);
    return {
      kind: copiedHandle.kind,
      name: copiedHandle.name,
      path: copiedHandle.path,
    };
  }

  throw new Error(`Unknown mode: ${mode}`);
}
