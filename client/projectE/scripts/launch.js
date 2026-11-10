#!/usr/bin/env node
// 启动 Electron（dev / start）。
//
// 为什么不直接在 package.json 里写 `electron .`：某些终端 / AI 会话会把
// ELECTRON_RUN_AS_NODE=1 注入环境，此时 electron 二进制退化成普通 Node，
// 主进程代码拿不到 app/BrowserWindow，表现为「启动后什么都不发生」。
// 这里显式剔除该变量，保证始终以 GUI 运行时启动。
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname, ".."), ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 0 : code);
});
