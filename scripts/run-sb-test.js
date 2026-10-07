#!/usr/bin/env node
// 本地测试包装：sb-test 从仓库根递归收集所有 .sb.html 且无忽略配置，而 client/（Tauri
// 桌面壳）的构建产物（dist/、src-tauri/target/）里含整套站点测试副本，必须排除。
// CI 不经此脚本（ofajs/sibyl-test@v1 action 在干净 checkout 上自扫，产物不入库），不受影响。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SKIP_DIRS = new Set(["node_modules", ".git", "client"]);

function collectSbHtml(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSbHtml(path.join(dir, entry.name), root, out);
    } else if (entry.name.endsWith(".sb.html")) {
      out.push(path.relative(root, path.join(dir, entry.name)));
    }
  }
  return out;
}

const root = process.cwd();
const extraArgs = process.argv.slice(2);
const hasExplicitFiles = extraArgs.some((a) => a === "-f" || a === "--file");
const args = [...extraArgs];
if (!hasExplicitFiles) {
  const files = collectSbHtml(root, root);
  if (files.length === 0) {
    console.error("No .sb.html files found (client/ excluded).");
    process.exit(1);
  }
  // collectFiles 按 空格/逗号 拆分，仓库名单无空格逗号，单参数传入
  args.push("-f", files.join(","));
}

const bin = path.join(root, "node_modules", "sibyl-test", "bin", "sb-test.js");
const res = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit" });
process.exit(res.status ?? 1);
