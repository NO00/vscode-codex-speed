#!/usr/bin/env bash
TASK_NAME=package
source "$(dirname "$0")/common.sh"
bash scripts/build.sh
mkdir -p artifacts
node node_modules/@vscode/vsce/vsce package --no-dependencies --no-rewrite-relative-links --readme-path docs/MARKETPLACE.md --out artifacts/vscode-codex-speed-0.1.2.vsix
node scripts/tools/check-package.cjs
