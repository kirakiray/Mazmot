#!/usr/bin/env node
/**
 * 版本号提升脚本
 * 用法：
 *   npm run bump            # 默认 patch +0.0.1
 *   npm run bump minor      # 次版本 +0.1.0
 *   npm run bump major      # 主版本 +1.0.0
 *   npm run bump 2.0.0      # 直接指定版本号
 * 同时更新 package.json 与 package-lock.json。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = join(root, "package.json");
const lockPath = join(root, "package-lock.json");

const arg = process.argv[2] ?? "patch";

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else if (["patch", "minor", "major"].includes(arg)) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (arg === "major") next = `${major + 1}.0.0`;
  else if (arg === "minor") next = `${major}.${minor + 1}.0`;
  else next = `${major}.${minor}.${patch + 1}`;
} else {
  console.error(`无效参数: ${arg}（可选 patch / minor / major / x.y.z）`);
  process.exit(1);
}

if (next === current) {
  console.error(`版本号未变化: ${current}`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

try {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = next;
  if (lock.packages?.[""]) lock.packages[""].version = next;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

console.log(`${current} -> ${next}`);
