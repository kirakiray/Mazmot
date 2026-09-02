#!/usr/bin/env node
/**
 * 把 .agents/skills/mazmot-api 打成 zip 包，输出到 .agents/skills/ 下。
 * 产物：.agents/skills/mazmot-api.zip
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsDir = join(root, ".agents/skills");
const outPath = join(skillsDir, "mazmot-api.zip");

rmSync(outPath, { force: true });
execFileSync("zip", ["-r", "mazmot-api.zip", "mazmot-api", "-x", "mazmot-api.zip"], {
  cwd: skillsDir,
  stdio: "inherit",
});
console.log(`已生成 ${outPath}`);
