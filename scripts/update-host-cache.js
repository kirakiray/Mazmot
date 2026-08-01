import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const rootDir = '/Users/yao/Documents/GitHub/Mazmot';

// 1. Read package.json
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

// 2. Recursively read ai/ directory and collect file paths
function walkDir(dir, baseDir = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'test') continue;
    const fullPath = join(dir, entry.name);
    const relativePath = baseDir ? `${baseDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

const aiFiles = walkDir(join(rootDir, 'ai'));

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
console.log(`  files: ${aiFiles.length} files`);