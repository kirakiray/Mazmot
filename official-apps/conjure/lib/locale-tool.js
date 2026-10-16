// locale-text 多语种翻译工具的纯函数库
// 职责：从应用源码提取 <locale-text> 组件与 getLocaleText({...}) 调用的文案
// 条目，按基准文本 SHA-256 合并进 client/locale-text.json 的数据结构。
// 提取与合并逻辑对齐 noneos-core 的 nos-tool/locale-text-tool 与 locale-text
// 运行时（hash = 基准文本 UTF-8 的 SHA-256 hex，key 即该 hash）。
// 本模块无文件 IO——读写由 lib/store/locale.js 经 builder.js 的应用文件抽象
// 完成；DOMParser 仅在 extractHtmlEntries 用到（Node 冒烟只测 JS 提取与合并）。

// 工具 UI「添加语种」的候选清单（cn / en 为源码内基准语种，不进候选）
export const LOCALE_LANGS = [
  { id: "ja", label: "日本語（ja）" },
  { id: "ko", label: "한국어（ko）" },
  { id: "fr", label: "Français（fr）" },
  { id: "de", label: "Deutsch（de）" },
  { id: "es", label: "Español（es）" },
  { id: "ru", label: "Русский（ru）" },
];

/** 基准文本的 SHA-256 hex（与 locale-text 运行时的 getHashCached 一致） */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 基准语种/文本：cn → en → 第一个声明项（与 locale-text 运行时回退一致） */
export function baseOf(langMap) {
  const keys = Object.keys(langMap);
  const baseLang = langMap.cn ? "cn" : langMap.en ? "en" : keys[0];
  return { baseText: langMap[baseLang], baseLang };
}

/**
 * 从 JS 源码提取所有 getLocaleText({...}) 调用的语言映射。
 * 括号平衡扫描正确处理字符串内的 { } 与跨行对象字面量。
 */
export function extractJsLangMaps(source) {
  const results = [];
  const callRe = /getLocaleText\s*\(\s*/g;
  let m;
  while ((m = callRe.exec(source)) !== null) {
    const start = callRe.lastIndex;
    if (source[start] !== "{") continue; // 非对象字面量参数（如变量），跳过

    // 扫描大括号平衡，跳过字符串内的 { }
    let depth = 0;
    let i = start;
    let inStr = null;
    for (; i < source.length; i++) {
      const c = source[i];
      if (inStr) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const objStr = source.slice(start, i);

    // 从对象字面量里提取 lang: "..." / '...' / `...`
    const langMap = {};
    const propRe = /(\w+)\s*:\s*(['"`])([\s\S]*?)\2/g;
    let pm;
    while ((pm = propRe.exec(objStr)) !== null) {
      langMap[pm[1]] = pm[3];
    }
    if (Object.keys(langMap).length > 0) {
      results.push(langMap);
    }
  }
  return results;
}

/** 从 <locale-text> 节点提取 { langMap, baseText, baseLang }（直接子元素取 lang） */
function extractFromLocaleTextEl(ltEl) {
  const langMap = {};
  let firstLang = null;
  let firstText = null;

  Array.from(ltEl.children).forEach((child) => {
    const lang = child.getAttribute("lang");
    if (!lang) return;
    const text = child.innerHTML.trim();
    langMap[lang] = text;
    if (firstLang === null) {
      firstLang = lang;
      firstText = text;
    }
  });

  if (Object.keys(langMap).length === 0) return null;
  return { langMap, ...baseOf(langMap) };
}

/**
 * HTML 源码 → 条目数组：提取 <locale-text> 节点（含 <template> 内嵌） +
 * 内联 <script>（含 template 内嵌）里的 getLocaleText 调用。
 */
export function extractHtmlEntries(relPath, text) {
  const out = [];
  const doc = new DOMParser().parseFromString(text, "text/html");

  const ltNodes = [];
  const collectLt = (root) => {
    root.querySelectorAll("locale-text").forEach((n) => ltNodes.push(n));
    root.querySelectorAll("template").forEach((t) => {
      if (t.content) collectLt(t.content);
    });
  };
  collectLt(doc);
  ltNodes.forEach((el) => {
    const extracted = extractFromLocaleTextEl(el);
    if (extracted) out.push({ ...extracted, sourceFile: relPath });
  });

  const scriptTexts = [];
  const collectScripts = (root) => {
    root.querySelectorAll("script").forEach((s) => {
      if (s.textContent) scriptTexts.push(s.textContent);
    });
    root.querySelectorAll("template").forEach((t) => {
      if (t.content) collectScripts(t.content);
    });
  };
  collectScripts(doc);
  extractJsLangMaps(scriptTexts.join("\n;\n")).forEach((langMap) => {
    out.push({ langMap, ...baseOf(langMap), sourceFile: relPath });
  });

  return out;
}

/**
 * 汇总提取：files = [{ path, text }]（html / js / mjs）。
 * 返回 { entries: [{ langMap, baseText, baseLang, sourceFile }], hitFiles }。
 */
export async function buildLocaleIndex(files) {
  const entries = [];
  let hitFiles = 0;
  for (const { path: relPath, text } of files) {
    let fileEntries = [];
    if (/\.m?js$/.test(relPath)) {
      fileEntries = extractJsLangMaps(text).map((langMap) => ({
        langMap,
        ...baseOf(langMap),
        sourceFile: relPath,
      }));
    } else if (/\.html?$/.test(relPath)) {
      fileEntries = extractHtmlEntries(relPath, text);
    }
    if (fileEntries.length) hitFiles++;
    entries.push(...fileEntries);
  }
  return { entries, hitFiles };
}

/**
 * 扫描条目增量合并进已有翻译表（不改源码语种字段，只补缺失/更新差异）。
 * existing 为已有 locale-text.json 的 map（hash → {lang: text}）。
 * 返回：
 * - finalMap  合并后的完整翻译表（含未被扫描命中的冗余条目）
 * - records   本次扫描命中的条目 [{ hash, baseText, status: added|updated|kept, sourceFile, langs }]
 * - orphaned  冗余条目（已有 JSON 里存在但本次未命中）[{ hash, baseText, langs }]
 * - added / updated / kept 计数
 */
export async function mergeLocaleMap(existing, entries) {
  // 同 hash 的扫描条目先聚合（同文案散落多文件时补齐彼此缺失的语种）
  const mergedScanned = {};
  for (const item of entries) {
    const hash = await sha256Hex(item.baseText);
    const hit = mergedScanned[hash];
    if (!hit) {
      mergedScanned[hash] = {
        langMap: { ...item.langMap },
        baseText: item.baseText,
        sourceFile: item.sourceFile,
      };
    } else {
      for (const [lang, text] of Object.entries(item.langMap)) {
        if (hit.langMap[lang] === undefined) {
          hit.langMap[lang] = text;
        }
      }
    }
  }

  const finalMap = structuredClone(existing && typeof existing === "object" ? existing : {});
  const records = [];
  let added = 0;
  let updated = 0;
  let kept = 0;

  for (const [hash, m] of Object.entries(mergedScanned)) {
    const { langMap, baseText, sourceFile } = m;
    let status;
    if (!finalMap[hash]) {
      finalMap[hash] = { ...langMap };
      status = "added";
      added++;
    } else {
      // 已有条目：保留旧语种翻译，仅补充缺失 / 更新差异字段
      let changed = false;
      for (const [lang, text] of Object.entries(langMap)) {
        if (finalMap[hash][lang] !== text) {
          if (finalMap[hash][lang] !== undefined) changed = true;
          finalMap[hash][lang] = text;
        }
      }
      if (changed) {
        status = "updated";
        updated++;
      } else {
        status = "kept";
        kept++;
      }
    }
    records.push({
      hash,
      baseText,
      status,
      sourceFile: sourceFile || "",
      langs: Object.keys(langMap),
    });
  }

  // 冗余条目：已有 JSON 里存在但本次扫描未命中的（源码删改后遗留）
  const orphaned = [];
  for (const [hash, entry] of Object.entries(existing || {})) {
    if (!mergedScanned[hash] && entry && typeof entry === "object") {
      const baseText = entry.cn ?? entry.en ?? Object.values(entry)[0] ?? "";
      orphaned.push({ hash, baseText: String(baseText), langs: Object.keys(entry) });
    }
  }

  return { finalMap, records, orphaned, added, updated, kept };
}
