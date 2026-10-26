#!/usr/bin/env bash
TASK_NAME=setup
source "$(dirname "$0")/common.sh"
if [[ "${1:-}" == "--release-tools" ]]; then
  npm install --save-dev --save-exact @vscode/vsce@3.9.2 --no-audit --no-fund
  exit 0
fi
if [[ "${1:-}" == "--host-tools" ]]; then
  npm install --save-dev --save-exact @vscode/test-electron@2.5.2 --no-audit --no-fund
  exit 0
fi
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --save-dev --save-exact typescript@5.7.3 @types/node@20 @types/vscode@1.90.0 @vscode/vsce@3.9.2 --no-audit --no-fund
fi
