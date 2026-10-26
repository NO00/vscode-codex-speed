#!/usr/bin/env bash
TASK_NAME=dashboard-browser
source "$(dirname "$0")/../common.sh"
command -v npx >/dev/null
bash "${USERPROFILE:-$HOME}/.codex/skills/playwright/scripts/playwright_cli.sh" --session codex-speed-dashboard "$@"
