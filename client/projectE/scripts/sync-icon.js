#!/usr/bin/env node
// 图标同步：图标唯一源在 client/projectR/scripts/gen_icon.py（纯 Python SDF
// 复刻吉祥物），它产出 client/projectR/assets/icon.png。Electron 壳从这里
// 复制一份到 assets/（运行时图标）与 build/（electron-builder 打包图标），
// 并在 macOS 上生成 build/icon.icns——直接给 icns 可以跳过 electron-builder
// 的图标转换工具下载（受限网络环境下那步会失败）。
// 改图标请改 gen_icon.py 后重新生成，再跑 `npm run icon`。
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const source = path.resolve(__dirname, "../../projectR/assets/icon.png");
if (!fs.existsSync(source)) {
  console.error(`[sync-icon] 找不到图标源：${source}`);
  process.exit(1);
}

const assetsDir = path.resolve(__dirname, "../assets");
const buildDir = path.resolve(__dirname, "../build");
for (const dir of [assetsDir, buildDir]) fs.mkdirSync(dir, { recursive: true });
for (const target of [path.join(assetsDir, "icon.png"), path.join(buildDir, "icon.png")]) {
  fs.copyFileSync(source, target);
  console.log(`[sync-icon] ${path.relative(process.cwd(), target)}`);
}

if (process.platform === "darwin") {
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "mazmot-iconset-")) + ".iconset";
  fs.mkdirSync(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
        const px = size * scale;
        const out = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
        execFileSync("sips", ["-z", String(px), String(px), source, "--out", out], {
          stdio: "ignore",
        });
      }
    }
    const icns = path.join(buildDir, "icon.icns");
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns], { stdio: "ignore" });
    console.log(`[sync-icon] ${path.relative(process.cwd(), icns)}`);
  } finally {
    fs.rmSync(iconset, { recursive: true, force: true });
  }
}
