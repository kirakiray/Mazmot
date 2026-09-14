// 统一虚拟空间 —— conjure 全部测试共用的内存版文件系统 / 存储 / 目录句柄
//
// 所有需要「虚拟空间」的测试（工具包内置测试 self-test.js、包测试 test/*.sb.html、
// 应用级 test/*.sb.html）一律从这里拿 fake，禁止在测试文件内再造内联 fake：
// 此前 fake fs 在多个测试文件里各写一份且行为有出入（create 只作用末段、
// keys()/remove() 缺失等），断言语义随之漂移。
//
// 形状对齐 NoneOS Core 常用子集（以 lib/builder.js 的真实用法为准）：
//   fs 模块：init(namespace) → 根目录句柄；get(namespace) → 根目录或 null
//   目录：get(path, opts) 多段路径一次取；缺失且无 create 返回 null；
//         { create: "file" } 只作用于最后一段，中间目录隐式创建；
//         { create: "dir" } 作用于最后一段
//         keys() 子名异步迭代器；values() 子句柄异步迭代器；
//         flat() 全量后代文件句柄（Core 新版能力，builder 优先用它列举）；
//         remove() 递归删除自己（根目录则清空子项）
//   文件：kind "file"、path、text() → Promise<string>、write(content) → Promise
//   句柄 path 一律从所属根目录算起（如 "todo-app/client/index.html"，
//   与 Core「flat()/path 可能带命名空间前缀」的行为一致）
//
// 另提供 createVirtualStorage()（/nos/storage 键值形状）与 createVirtualDir()
// （独立目录句柄，可当本地渠道的 rootHandle 或 fs.open() 的返回值用）。

const makeFileHandle = (dirNode, name, text) => ({
  kind: "file",
  name,
  path: pathOf(dirNode) ? `${pathOf(dirNode)}/${name}` : name,
  async text() {
    return text;
  },
  async write(content) {
    text = String(content ?? "");
  },
});

// 从根目录（parent 为 null）算起的完整路径
const pathOf = (node) => {
  const segs = [];
  for (let c = node; c && c.name; c = c.parent) segs.unshift(c.name);
  return segs.join("/");
};

export function createVirtualDir(parent = null, name = "") {
  const node = {
    kind: "dir",
    parent,
    name,
    children: new Map(), // 子名 → 目录节点 | 文件句柄
  };
  node.path = pathOf(node);
  node.get = async (p, opts = {}) => {
    const segs = String(p).split("/").filter(Boolean);
    let cur = node;
    for (let i = 0; i < segs.length; i++) {
      const last = i === segs.length - 1;
      const child = cur.children.get(segs[i]);
      if (!child) {
        if (last && opts.create === "file") {
          const f = makeFileHandle(cur, segs[i], "");
          cur.children.set(segs[i], f);
          return f;
        }
        if (last && opts.create === "dir") {
          const d = createVirtualDir(cur, segs[i]);
          cur.children.set(segs[i], d);
          return d;
        }
        if (!opts.create) return null;
        // 中间目录缺失且带 create：隐式创建（writeAppFile 依赖此行为）
        const d = createVirtualDir(cur, segs[i]);
        cur.children.set(segs[i], d);
        cur = d;
        continue;
      }
      if (last) return child;
      if (child.kind !== "dir") return null; // 文件挡在路径中间
      cur = child;
    }
    return cur; // get("") / 以 "/" 结尾 → 目录自身
  };
  node.keys = async function* () {
    for (const name of node.children.keys()) yield name;
  };
  node.values = async function* () {
    for (const child of node.children.values()) yield child;
  };
  node.flat = async () => {
    const out = [];
    const walk = (d, prefix) => {
      for (const [name, child] of d.children) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (child.kind === "dir") walk(child, rel);
        else out.push({ ...child, path: rel });
      }
    };
    walk(node, "");
    return out;
  };
  node.remove = async () => {
    if (node.parent) {
      node.parent.children.delete(node.name);
    } else {
      node.children.clear(); // 根目录不可删，清空子项
    }
  };
  return node;
}

/** 内存版 /nos/fs 模块：init/get 按命名空间隔离 */
export function createVirtualFs() {
  const spaces = new Map();
  return {
    init: async (ns) => {
      if (!spaces.has(ns)) spaces.set(ns, createVirtualDir(null, ""));
      return spaces.get(ns);
    },
    get: async (ns) => spaces.get(ns) ?? null,
  };
}

/** 内存版键值存储（/nos/storage 形状；entries 为初始键值） */
export function createVirtualStorage(entries = {}) {
  const kv = new Map(Object.entries(entries));
  return {
    async getItem(k) {
      return kv.has(k) ? kv.get(k) : null;
    },
    async setItem(k, v) {
      kv.set(k, v);
    },
    async removeItem(k) {
      kv.delete(k);
    },
    async has(k) {
      return kv.has(k);
    },
  };
}

/** 向目录批量写入种子文件：{ "path": "content" } */
export async function seedVirtualFiles(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    const f = await dir.get(p, { create: "file" });
    await f.write(content);
  }
}

/** 读取目录内文件内容；文件不存在（或路径是目录）返回 null */
export async function readVirtualFile(dir, p) {
  const f = await dir.get(p);
  return f && f.kind === "file" ? await f.text() : null;
}

/** 列出目录下全部文件路径（相对该目录，已排序）——断言落盘结果用 */
export async function listVirtualPaths(dir, prefix = "") {
  const out = [];
  const walk = (d, acc) => {
    for (const [name, child] of d.children) {
      const rel = acc ? `${acc}/${name}` : name;
      if (child.kind === "dir") walk(child, rel);
      else out.push(rel);
    }
  };
  walk(dir, prefix);
  return out.sort();
}
