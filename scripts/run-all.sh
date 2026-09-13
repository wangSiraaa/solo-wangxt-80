#!/usr/bin/env bash
# 纯几何/存储逻辑的回归测试（无需浏览器）。
set -e
cd "$(dirname "$0")/.."
mkdir -p .test-build
run() {
  echo "▶ $1"
  npx --no-install esbuild "scripts/$1.ts" --bundle --platform=node --format=esm --outfile=".test-build/$1.mjs" >/dev/null
  node ".test-build/$1.mjs"
}
run test-engine
run test-collision
run test-continuation
run test-branch-select
run test-page-states
run test-path-persist
run test-roundtrip
run test-store
run test-idb
run random-si
rm -rf .test-build
echo "全部回归脚本通过。"
