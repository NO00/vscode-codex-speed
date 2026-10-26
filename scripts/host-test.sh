#!/usr/bin/env bash
TASK_NAME=host-test
source "$(dirname "$0")/common.sh"
bash scripts/build.sh
node scripts/tools/run-host.cjs "$@"
