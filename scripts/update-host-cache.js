import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const rootDir = join(import.meta.dirname, '..');

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

// 3. Recursively read mz/ai/ directory and collect file paths
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

const aiFiles = walkDir(join(rootDir, 'mz/ai'), 'mz/ai');

// 3. Read current host-cache.json and update
const hostCachePath = join(rootDir, 'host-cache.json');
const hostCache = JSON.parse(readFileSync(hostCachePath, 'utf-8'));

hostCache.name = pkg.name;
hostCache.version = pkg.version;
hostCache.files = ['index.html', ...aiFiles];

// 4. Write back
writeFileSync(hostCachePath, JSON.stringify(hostCache, null, 2) + '\n', 'utf-8');

console.log('host-cache.json updated successfully');
console.log(`  name: ${pkg.name}`);
console.log(`  version: ${pkg.version}`);
console.log(`  ai files: ${aiFiles.length}`);
console.log(`  total files: ${aiFiles.length + 1}`);
