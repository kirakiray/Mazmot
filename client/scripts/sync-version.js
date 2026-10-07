#!/usr/bin/env node
// 把根 package.json 的 version 同步进桌面壳：
//   - client/src-tauri/tauri.conf.json（产物命名与 app 元数据来源）
//   - client/src-tauri/Cargo.toml（runtime_probe / X-Mazmot-Runtime 头的版本来源）
// 由 predev / prebuild 钩子自动执行；交叉编译前手动跑一次（npm run sync:version）。
"use strict";

const fs = require("fs");
const path = require("path");

const rootVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
).version;

const confPath = path.join(__dirname, "../src-tauri/tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
if (conf.version !== rootVersion) {
  conf.version = rootVersion;
  fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
  console.log(`[sync-version] tauri.conf.json -> ${rootVersion}`);
}

const cargoPath = path.join(__dirname, "../src-tauri/Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
const updated = cargo.replace(
  /(^name = "mazmot-client"\nversion = ")[^"]+(")/m,
  `$1${rootVersion}$2`,
);
if (updated !== cargo) {
  fs.writeFileSync(cargoPath, updated);
  console.log(`[sync-version] Cargo.toml -> ${rootVersion}`);
}

if (conf.version === rootVersion && updated === cargo) {
  console.log(`[sync-version] already ${rootVersion}`);
}
