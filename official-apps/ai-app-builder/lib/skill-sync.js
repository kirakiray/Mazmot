// 技能知识库：下载同步 + VFS 读取
// 技能源是一个 URL 列表（zip 包或直接的 SKILL.md 文件），首次运行用
// DEFAULT_SKILL_SOURCES 播种到自存储空间，之后以存储为准（可扩展管理 UI）。
// 下载的技能安装到 VFS 根命名空间 skills/<id>/ 下（init("skills")），
// read_skill 工具读取的也是这份虚拟目录内的副本（离线可用）。
//
// zip 解析零依赖：手读中央目录 + DecompressionStream("deflate-raw") 解压。

// 技能源清单（zip 或裸 SKILL.md 的完整 URL）
export const DEFAULT_SKILL_SOURCES = [
  "https://raw.githubusercontent.com/ofajs/ofa.js/main/skills/ofajs-docs.zip",
  "https://raw.githubusercontent.com/kirakiray/noneos-core/refs/heads/main/.agents/skills/noneos-core-docs.zip",
];

// 安装时只落文本文件（知识库内容均为文本；二进制杂项跳过）
const TEXT_EXT = /\.(md|markdown|html?|js|mjs|css|json|txt|csv|xml|svg)$/i;

export const SKILLS_NAMESPACE = "skills";
const SOURCES_KEY = "skill-sources";
const META_FILE = "__meta.json";

const SKILL_ID_RE = /^[a-z0-9_-]+$/i;

/* ---------- 基础工具 ---------- */

function parseFrontmatter(md) {
  const out = {};
  const m = String(md).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[kv[1].toLowerCase()] = v;
  }
  return out;
}

function validDocPath(path) {
  const p = String(path || "").trim();
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  return p.toLowerCase().endsWith(".md");
}

const idFromUrl = (url) =>
  decodeURIComponent(String(url).split("?")[0].split("#")[0].split("/").pop() || "")
    .replace(/\.(zip|md|markdown)$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- zip 解析（仅文本条目） ---------- */

/**
 * 解析 zip 字节数据，返回 [{ name, dir, text }]。
 * 支持存储（method 0）与 deflate（method 8，经 DecompressionStream）。
 */
export async function unzipText(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);

  // 定位 EOCD（End of Central Directory）
  let eocd = -1;
  const scanFloor = Math.max(0, u8.length - 22 - 65536);
  for (let i = u8.length - 22; i >= scanFloor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip 解析失败：未找到目录结尾记录");

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const out = [];

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error("zip 解析失败：中央目录损坏");
    }
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = td.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name.endsWith("/")) {
      out.push({ name, dir: true, text: "" });
    } else {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);
      let text;
      if (method === 0) {
        text = td.decode(comp);
      } else if (method === 8) {
        const stream = new Blob([comp])
          .stream()
          .pipeThrough(new DecompressionStream("deflate-raw"));
        text = await new Response(stream).text();
      } else {
        throw new Error(`zip 解析失败：不支持的压缩方法 ${method}（${name}）`);
      }
      out.push({ name, dir: false, text });
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 条目统一去掉单一根目录（zip 常见的外层包裹），返回相对路径列表 */
function stripCommonRoot(entries) {
  const files = entries.filter((e) => !e.dir);
  let list = files.map((e) => ({ ...e }));
  // 只要有唯一的「目录型」首段就剥一层（最多剥三层，防异常包）
  for (let round = 0; round < 3; round++) {
    const roots = new Set(list.map((e) => e.name.split("/")[0]));
    if (roots.size !== 1) break;
    const root = [...roots][0];
    const isDir = list.some((e) => e.name.startsWith(root + "/"));
    if (!isDir) break;
    list = list
      .map((e) => ({ ...e, name: e.name.slice(root.length + 1) }))
      .filter((e) => e.name);
  }
  return list;
}

/* ---------- 安装与同步 ---------- */

async function skillsRoot(fs) {
  return await fs.init(SKILLS_NAMESPACE);
}

async function readMeta(fs, id) {
  try {
    const root = await skillsRoot(fs);
    const f = await root.get(`${id}/${META_FILE}`);
    if (!f || f.kind !== "file") return null;
    return await f.json();
  } catch {
    return null;
  }
}

async function writeEntries(fs, id, entries, meta) {
  const root = await skillsRoot(fs);
  const dir = await root.get(id, { create: "dir" });
  for (const e of entries) {
    if (e.dir || !TEXT_EXT.test(e.name)) continue;
    const file = await dir.get(e.name, { create: "file" });
    await file.write(e.text);
  }
  const metaFile = await dir.get(META_FILE, { create: "file" });
  await metaFile.write(JSON.stringify(meta, null, 2));
}

/**
 * 获取技能源清单（存储覆盖 > 默认播种）。
 * @param {Object} storage getStorage("ai-app-builder") 实例
 */
export async function getSkillSources(storage) {
  if (storage) {
    const saved = await storage.getItem(SOURCES_KEY);
    if (Array.isArray(saved) && saved.length) return saved;
    await storage.setItem(SOURCES_KEY, DEFAULT_SKILL_SOURCES);
  }
  return DEFAULT_SKILL_SOURCES;
}

/** 覆盖技能源清单 */
export async function setSkillSources(storage, urls) {
  if (!storage) return;
  await storage.setItem(SOURCES_KEY, urls.filter((u) => /^https?:\/\//.test(u)));
}

/**
 * 从单个 URL 安装技能到 VFS skills 空间。
 * @returns {Promise<{ id: string, installed: boolean }>} installed=false 表示内容未变化跳过写入
 */
export async function installSkillFromUrl(fs, url) {
  const id = idFromUrl(url);
  if (!SKILL_ID_RE.test(id)) throw new Error(`无法从 URL 推导技能 id：${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败：${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  const hash = await sha256Hex(buf);

  const oldMeta = await readMeta(fs, id);
  if (oldMeta && oldMeta.source === url && oldMeta.hash === hash) {
    return { id, installed: false };
  }

  let entries;
  if (/\.zip(\?|#|$)/i.test(url)) {
    entries = stripCommonRoot(await unzipText(buf));
  } else {
    // 裸 SKILL.md
    entries = [{ name: "SKILL.md", dir: false, text: new TextDecoder().decode(buf) }];
  }
  if (!entries.some((e) => e.name === "SKILL.md")) {
    throw new Error(`技能包里没有 SKILL.md：${url}`);
  }

  await writeEntries(fs, id, entries, {
    source: url,
    hash,
    installedAt: Date.now(),
  });
  return { id, installed: true };
}

/**
 * 后台同步全部技能源：逐个下载安装（同内容跳过写入），单个失败不中断其余。
 * @param {Object} opts
 * @param {Object} opts.fs /nos/fs/main.js 模块
 * @param {Object} [opts.storage] 自存储空间（读技能源清单）
 * @param {(payload: { id: string, state: "ok"|"skip"|"fail", error?: string }) => void} [opts.onProgress]
 * @returns {Promise<{ changed: boolean, results: Array }>} changed = 本次有无实际写入
 */
export async function syncSkills({ fs, storage, onProgress }) {
  if (!fs) return { changed: false, results: [] };
  const urls = await getSkillSources(storage);
  let changed = false;
  const results = [];
  for (const url of urls) {
    const id = idFromUrl(url);
    try {
      const r = await installSkillFromUrl(fs, url);
      changed = changed || r.installed;
      results.push({ id, state: r.installed ? "ok" : "skip" });
      onProgress?.({ id, state: r.installed ? "ok" : "skip" });
    } catch (err) {
      console.warn(`技能 ${id} 同步失败：`, err);
      results.push({ id, state: "fail", error: err.message });
      onProgress?.({ id, state: "fail", error: err.message });
    }
  }
  return { changed, results };
}

/* ---------- 索引与读取（VFS 内副本） ---------- */

/**
 * 从 VFS skills 空间加载技能索引（各 <id>/SKILL.md 的 frontmatter）。
 * @returns {Promise<Array<{ id: string, name: string, description: string }>>}
 */
export async function loadSkillIndex(fs) {
  if (!fs) return [];
  const root = await skillsRoot(fs);
  const out = [];
  for await (const handle of root.values()) {
    if (handle.kind !== "dir" || !SKILL_ID_RE.test(handle.name)) continue;
    try {
      const f = await handle.get("SKILL.md");
      if (!f || f.kind !== "file") continue;
      const fm = parseFrontmatter(await f.text());
      out.push({
        id: handle.name,
        name: fm.name || handle.name,
        description: fm.description || "",
      });
    } catch {
      /* 单个技能损坏不阻塞索引 */
    }
  }
  return out;
}

/**
 * 读取 VFS skills 空间内一篇文档（read_skill 工具的底层）。
 * @returns {Promise<string>} 文档文本（缺失 / 非法路径返回可读提示）
 */
export async function readSkillFile(fs, id, path = "SKILL.md") {
  if (!fs) return "知识库不可用（文件系统未就绪）";
  if (!SKILL_ID_RE.test(String(id))) return `未知技能：${id}`;
  if (!validDocPath(path)) return `非法文档路径：${path}`;
  try {
    const root = await skillsRoot(fs);
    const f = await root.get(`${id}/${path}`);
    if (!f || f.kind !== "file") return `文档不存在：${id}/${path}`;
    const text = await f.text();
    const MAX = 60000;
    if (text.length > MAX) {
      return (
        text.slice(0, MAX) +
        `\n\n（文档过长已截断，共 ${text.length} 字符；可用 path 参数读取具体 references 文档）`
      );
    }
    return text;
  } catch (err) {
    return `读取失败：${err.message}`;
  }
}
