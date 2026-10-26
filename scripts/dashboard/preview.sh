#!/usr/bin/env bash
TASK_NAME=dashboard-preview
source "$(dirname "$0")/../common.sh"
bash scripts/build.sh
node scripts/dashboard/preview.cjs
