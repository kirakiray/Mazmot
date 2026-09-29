// 生成 /cache-manifest.json：index.html + mz/ + main/（不含 test 目录）的
// SHA-256 清单。version 由 hashes 内容派生（SHA-256 前 8 位），与
// sw/host-cache.js 运行时的 deriveVersion 算法保持一致，无需手工 bump。
//
// 用法：
//   node scripts/update-cache-manifest.js          重新生成（内容无变化则不写盘）
//   node scripts/update-cache-manifest.js --check  校验清单是否最新，过期则 exit 1

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const rootDir = join(import.meta.dirname, '..');
const manifestPath = join(rootDir, 'cache-manifest.json');

// 1. Read package.json
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

// 2. Load .gitignore ignore rules from repo root
function compileGitignorePattern(raw) {
  let negate = false;
  let pattern = raw;
  if (pattern.startsWith('!')) {
    negate = true;
    pattern = pattern.slice(1);
  }
  let dirOnly = false;
  if (pattern.endsWith('/')) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  if (!pattern) return null;

  // Anchored (relative to .gitignore root) when the pattern contains a slash.
  const anchored = pattern.includes('/');
  pattern = pattern.replace(/^\//, '');

  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches across path separators
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        // * matches within a single path segment
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '[') {
      let j = i + 1;
      let cls = '[';
      if (pattern[j] === '!') { cls += '^'; j++; }
      while (j < pattern.length && pattern[j] !== ']') { cls += pattern[j]; j++; }
      if (j < pattern.length && pattern[j] === ']') {
        cls += ']'; j++;
        re += cls; i = j;
      } else {
        re += '\\['; i += 1;
      }
    } else if ('.+^${}()|\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '(?:/.*)?$' : '$';
  return { regex: new RegExp(prefix + re + suffix), negate };
}

function loadGitignore(rootDir) {
  const gitignorePath = join(rootDir, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  const content = readFileSync(gitignorePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(compileGitignorePattern)
    .filter(Boolean);
}

function isIgnored(path, patterns) {
  let ignored = false;
  for (const p of patterns) {
    // Last matching pattern wins (gitignore semantics).
    if (p.regex.test(path)) ignored = !p.negate;
  }
  return ignored;
}

const ignorePatterns = loadGitignore(rootDir);

// 3. Recursively read mz/ directory and collect file paths
function walkDir(dir, baseDir = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'test') continue;
    const relativePath = baseDir ? `${baseDir}/${entry.name}` : entry.name;
    if (isIgnored(relativePath, ignorePatterns)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

const mzFiles = walkDir(join(rootDir, 'mz'), 'mz');
const mainFiles = walkDir(join(rootDir, 'main'), 'main');

// 4. Compute per-file SHA-256 + size
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const hashes = ['index.html', ...mzFiles, ...mainFiles].map((path) => {
  const bytes = readFileSync(join(rootDir, path));
  return { path, hash: sha256(bytes), size: bytes.length };
});

// 5. Derive version from content（与 host-cache.js deriveVersion 一致）
const version = createHash('sha256')
  .update(JSON.stringify(hashes), 'utf-8')
  .digest('hex')
  .slice(0, 8);

const manifest = { name: pkg.name, version, hashes };

// 6. Compare / write / check
const expected = JSON.stringify(manifest, null, 2) + '\n';
const isCheck = process.argv.includes('--check');

if (isCheck) {
  const current = existsSync(manifestPath)
    ? readFileSync(manifestPath, 'utf-8')
    : '';
  if (current !== expected) {
    console.error('cache-manifest.json is stale. Run: npm run update');
    process.exit(1);
  }
  console.log(`cache-manifest.json is up to date (version ${version}, ${hashes.length} files)`);
  process.exit(0);
}

const current = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : '';
if (current === expected) {
  console.log(`cache-manifest.json unchanged (version ${version}, ${hashes.length} files)`);
  process.exit(0);
}

writeFileSync(manifestPath, expected, 'utf-8');
console.log('cache-manifest.json updated successfully');
console.log(`  name: ${pkg.name}`);
console.log(`  version: ${version}`);
console.log(`  mz files: ${mzFiles.length}`);
console.log(`  main files: ${mainFiles.length}`);
console.log(`  total files: ${hashes.length}`);
