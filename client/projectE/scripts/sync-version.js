#!/usr/bin/env node
// 把根 package.json 的 version 同步进 Electron 壳的 package.json / package-lock.json。
// 产物版本、runtime_probe 返回值与 X-Mazmot-Runtime 头都取自这里。
// 由 predev / prebuild 钩子自动执行；手动同步：npm run sync:version。
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8"),
).version;

const pkgPath = path.join(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
let changed = false;
if (pkg.version !== rootVersion) {
  pkg.version = rootVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`[sync-version] package.json -> ${rootVersion}`);
  changed = true;
}

const lockPath = path.join(__dirname, "../package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  let lockChanged = false;
  if (lock.version !== rootVersion) {
    lock.version = rootVersion;
    lockChanged = true;
  }
  if (lock.packages && lock.packages[""] && lock.packages[""].version !== rootVersion) {
    lock.packages[""].version = rootVersion;
    lockChanged = true;
  }
  if (lockChanged) {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    console.log(`[sync-version] package-lock.json -> ${rootVersion}`);
    changed = true;
  }
}

if (!changed) console.log(`[sync-version] already ${rootVersion}`);
