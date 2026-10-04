// 同步 official-apps/*/__app.json 的 files 清单与磁盘实际文件。
// files 数组此前纯手工维护，新增 lib 模块漏登时市场安装出来的应用就缺
// 文件（conjure 曾因漏登 lib/agents-template.js / lib/diff.js 装完即白屏）。
//
// 同步规则：
//   - 清单已有条目且文件仍在磁盘 → 原样保留（含 replacements 等对象配置，
//     也保留手工故意收录的例外文件，如 cloud-drive 的 lib/test/*.sb.html）
//   - 磁盘有、清单没有 → 按收录规则追加：排除 __app.json、dotfiles、
//     node_modules、test 目录、*.sb.html；app.json 自动带 CREATED_AT 替换
//   - 清单有、磁盘没有 → 移除并告警（文件已被删除）
//   - 发生文件增删时，自动把该应用 app.json 的 version 末段 +1
//     （安装端更新检查靠版本号比对；纯重排 / 格式归一不 bump）
// files 排序：app.json（replacements 对象）固定居首，其余按路径 ASCII 排序，
// 重复执行幂等、diff 稳定。首次对老清单会整体重排一次，属预期。
//
// 用法：
//   node scripts/update-app-manifests.js          同步全部官方应用清单
//   node scripts/update-app-manifests.js --check  仅校验是否最新，过期 exit 1

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';

const rootDir = join(import.meta.dirname, '..');
const appsDir = join(rootDir, 'official-apps');
const checkOnly = process.argv.includes('--check');

// app.json 里的占位创建时间在安装时被替换为真实值（见 official-app-writer.js）
const APP_JSON_REPLACEMENTS = [{ from: '1704067200000', to: 'CREATED_AT' }];

// 只约束「追加新文件」，已收录条目不受此限制
function shouldInclude(relPath) {
  const parts = relPath.split('/');
  if (relPath === '__app.json') return false;
  if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return false;
  if (parts.includes('test')) return false;
  if (relPath.endsWith('.sb.html')) return false;
  return true;
}

function listFiles(dir, base, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

const entryPath = (e) => (typeof e === 'string' ? e : e?.path);
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 取版本字符串最后一段数字 +1："0.4.1" → "0.4.2"；无数字返回 null
function bumpVersion(v) {
  if (typeof v !== 'string' || !/\d/.test(v)) return null;
  return v.replace(/(\d+)(?!.*\d)/, (m) => String(Number(m) + 1));
}

// 文件清单发生增删时同步 bump app.json 的 version，让已安装应用能收到更新
function bumpAppVersion(id, actions) {
  const appJsonPath = join(appsDir, id, 'app.json');
  if (!existsSync(appJsonPath)) {
    actions.push(`! 未找到 app.json，跳过 version bump`);
    return;
  }
  const appMeta = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
  const next = bumpVersion(appMeta.version);
  if (!next) {
    actions.push(`! app.json version 缺失或无数字（${JSON.stringify(appMeta.version) ?? 'undefined'}），跳过 bump`);
    return;
  }
  actions.push(`↑ version ${appMeta.version} → ${next}`);
  if (!checkOnly) {
    appMeta.version = next;
    writeFileSync(appJsonPath, JSON.stringify(appMeta, null, 2) + '\n');
  }
}

let hasDrift = false;

for (const id of readdirSync(appsDir).sort()) {
  const mfPath = join(appsDir, id, '__app.json');
  if (!existsSync(mfPath)) continue;

  const manifest = JSON.parse(readFileSync(mfPath, 'utf-8'));
  const disk = new Set(listFiles(join(appsDir, id), join(appsDir, id)));
  const actions = [];

  // 1. 保留磁盘上仍存在的已有条目
  const kept = [];
  const listed = new Set();
  for (const e of manifest.files ?? []) {
    const p = entryPath(e);
    if (!p || disk.has(p)) {
      if (p) listed.add(p);
      kept.push(e);
    } else {
      actions.push(`- ${p}（磁盘已删除）`);
    }
  }

  // 2. 追加磁盘上新增且符合收录规则的文件
  for (const p of [...disk].filter((x) => !listed.has(x) && shouldInclude(x)).sort(byPath)) {
    if (p === 'app.json') {
      kept.push({ path: p, replacements: APP_JSON_REPLACEMENTS });
    } else {
      kept.push(p);
    }
    actions.push(`+ ${p}`);
  }

  // 3. app.json 固定居首，其余按路径排序
  kept.sort((a, b) => {
    const pa = entryPath(a);
    const pb = entryPath(b);
    if (pa === 'app.json') return -1;
    if (pb === 'app.json') return 1;
    return byPath(pa, pb);
  });
  manifest.files = kept;

  const output = JSON.stringify(manifest, null, 2) + '\n';
  const changed = output !== readFileSync(mfPath, 'utf-8');

  // 4. 文件真的增删了才 bump 版本（重排 / 格式归一不动）
  if (actions.some((a) => a.startsWith('+') || a.startsWith('-'))) {
    bumpAppVersion(id, actions);
  }

  if (!actions.length && !changed) {
    console.log(`✔ ${id}: 清单与磁盘一致`);
    continue;
  }
  hasDrift = true;
  console.log(`${checkOnly ? '✘' : '✎'} ${id}:`);
  for (const a of actions) console.log(`  ${a}`);
  if (!actions.length) console.log('  （仅重排 / 格式归一）');
  if (!checkOnly) writeFileSync(mfPath, output);
}

if (checkOnly && hasDrift) {
  console.error('\n清单过期：请运行 npm run update:apps');
  process.exit(1);
}
