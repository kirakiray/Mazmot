export const toVLQ = (n) => {
  const charMap =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let result = "";
  do {
    let digit = v & 31;
    v >>= 5;
    if (v > 0) digit |= 32;
    result += charMap[digit];
  } while (v > 0);
  return result;
};

export const generateSourceMap = (scriptText, targetLine, sourceFile, sourceContent) => {
  const lineCount = scriptText.split("\n").length;
  let mappings = toVLQ(0) + toVLQ(0) + toVLQ(targetLine) + toVLQ(0);
  for (let i = 1; i < lineCount; i++) {
    mappings += ";AACA";
  }

  let displaySourceFile = sourceFile;
  if (!displaySourceFile.split("/").pop().includes(".")) {
    displaySourceFile += displaySourceFile.endsWith("/")
      ? "index.html"
      : "/index.html";
  }

  return {
    version: 3,
    sources: [displaySourceFile],
    sourcesContent: [sourceContent],
    names: [],
    mappings: mappings,
  };
};

export const createScriptWithSourceMap = (scriptText, targetLine, sourceFile, sourceContent) => {
  const sourceMap = generateSourceMap(scriptText, targetLine, sourceFile, sourceContent);
  
  const sourceMapBase64 = btoa(
    unescape(encodeURIComponent(JSON.stringify(sourceMap))),
  );
  
  const scriptWithMap =
    scriptText +
    `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${sourceMapBase64}`;

  const base64Script = btoa(
    unescape(encodeURIComponent(scriptWithMap)),
  );

  return `data:application/javascript;base64,${base64Script}`;
};
