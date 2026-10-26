#!/usr/bin/env bash
TASK_NAME=package
source "$(dirname "$0")/common.sh"
bash scripts/build.sh
mkdir -p artifacts
node scripts/release/metadata.cjs
task_vsix="$(node scripts/release/metadata.cjs --field vsix_path)"
node node_modules/@vscode/vsce/vsce package --no-dependencies --no-rewrite-relative-links --readme-path docs/MARKETPLACE.md --out "$task_vsix"
node scripts/tools/check-package.cjs "$task_vsix"
