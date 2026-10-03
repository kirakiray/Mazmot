// 行级 diff（变更卡与 edit_file 的共用底层）
// 轻量 LCS：生成 app 文件规模（几十~几百行）毫秒级；超大文件降级为
// 整体删+增，不算 LCS 防卡顿。

/** 文本 → 行数组（保留空行；结尾无换行符的末行也是一项） */
const splitLines = (text) => String(text ?? "").split("\n");

/** LCS 行级 diff：返回按新文件顺序排列的 hunk 序列 [{type, aLn, bLn, text}]，
 *  type：ctx 公共 / del 仅旧 / add 仅新；aLn/bLn 为 1 起行号（对侧为 null）。
 *  超过 maxLines 规模时降级：全 del + 全 add（统计仍准确）——回溯需保留
 *  整张 LCS 表（n×m×4B），1200 行 ≈ 5.8MB 是合理上限 */
export function diffLines(aText, bText, maxLines = 1200) {
  const a = splitLines(aText);
  const b = splitLines(bText);
  if (a.length + b.length > maxLines * 2) {
    return [
      ...a.map((text, i) => ({ type: "del", aLn: i + 1, bLn: null, text })),
      ...b.map((text, i) => ({ type: "add", aLn: null, bLn: i + 1, text })),
    ];
  }
  if (aText === bText) {
    return b.map((text, i) => ({ type: "ctx", aLn: i + 1, bLn: i + 1, text }));
  }

  // 行先 hash 成整数再比较；保留全表用于回溯编辑脚本
  const n = a.length;
  const m = b.length;
  const ha = a.map((s) => hashLine(s));
  const hb = b.map((s) => hashLine(s));
  const tables = [new Uint32Array(m + 1)];
  for (let i = 1; i <= n; i++) {
    const row = new Uint32Array(m + 1);
    for (let j = 1; j <= m; j++) {
      row[j] =
        ha[i - 1] === hb[j - 1]
          ? tables[i - 1][j - 1] + 1
          : Math.max(tables[i - 1][j], row[j - 1]);
    }
    tables.push(row);
  }

  const out = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ha[i - 1] === hb[j - 1]) {
      out.push({ type: "ctx", aLn: i, bLn: j, text: b[j - 1] });
      i--;
      j--;
    } else if (tables[i - 1][j] >= tables[i][j - 1]) {
      out.push({ type: "del", aLn: i, bLn: null, text: a[i - 1] });
      i--;
    } else {
      out.push({ type: "add", aLn: null, bLn: j, text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ type: "del", aLn: i, bLn: null, text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ type: "add", aLn: null, bLn: j, text: b[j - 1] });
    j--;
  }
  return out.reverse();
}

// FNV-1a 32 位行哈希（快、冲突率对本场景足够；碰撞只影响 diff 精度不影响正确性）
function hashLine(s) {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** hunk 序列 → 增删行统计 {adds, dels} */
export function diffStat(hunks) {
  let adds = 0;
  let dels = 0;
  for (const h of hunks || []) {
    if (h.type === "add") adds++;
    else if (h.type === "del") dels++;
  }
  return { adds, dels };
}

/** 收紧 hunk 序列：只保留变更行 ±N 行上下文（其余折叠为 gap 标记
 *  {type:"gap", count}），变更卡展开视图用；无变更返回 [] */
export function compactHunks(hunks, context = 2) {
  const keep = new Set();
  const list = hunks || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].type !== "ctx") {
      for (let k = Math.max(0, i - context); k <= Math.min(list.length - 1, i + context); k++) {
        keep.add(k);
      }
    }
  }
  if (!keep.size) return [];
  const out = [];
  let idx = 0;
  while (idx < list.length) {
    if (keep.has(idx)) {
      out.push(list[idx]);
      idx++;
      continue;
    }
    let end = idx;
    while (end < list.length && !keep.has(end)) end++;
    out.push({ type: "gap", count: end - idx, aLn: null, bLn: null, text: "" });
    idx = end;
  }
  return out;
}
