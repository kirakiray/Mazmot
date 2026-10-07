#!/usr/bin/env bash
# 把各平台打包产物统一收集到 client/dist/（一层目录，找得到不迷路）。
# 产物不入库（client/.gitignore 已忽略 dist/），重新打包后跑 `npm run collect` 归拢。
#
# 前置：先跑过打包
#   macOS:  npm run build            （或 npx tauri build --bundles app）+ DMG hdiutil 兜底
#   Windows: cargo xwin build（见 CONTEXT.md「打包产物」）

set -euo pipefail

CLIENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$CLIENT_DIR/src-tauri/target/release/bundle"
DIST="$CLIENT_DIR/dist"

mkdir -p "$DIST"

# macOS .app（覆盖旧副本）
if [ -d "$BUNDLE/macos/Mazmot.app" ]; then
  rm -rf "$DIST/Mazmot.app"
  cp -R "$BUNDLE/macos/Mazmot.app" "$DIST/Mazmot.app"
fi

# macOS DMG
if compgen -G "$BUNDLE/dmg/*.dmg" > /dev/null; then
  cp -f "$BUNDLE/dmg/"*.dmg "$DIST/"
fi

# Windows 便携 zip
if compgen -G "$BUNDLE/windows-portable/*.zip" > /dev/null; then
  cp -f "$BUNDLE/windows-portable/"*.zip "$DIST/"
fi

echo "── client/dist/ ──"
ls -lh "$DIST" | awk 'NR > 1 {print $5 "\t" $9}'
