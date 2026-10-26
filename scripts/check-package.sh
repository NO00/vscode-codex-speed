#!/usr/bin/env bash
TASK_NAME=check-package
source "$(dirname "$0")/common.sh"
node scripts/tools/check-package.cjs "$@"
