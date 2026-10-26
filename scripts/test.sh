#!/usr/bin/env bash
TASK_NAME=test
source "$(dirname "$0")/common.sh"
bash scripts/build.sh
node --test dist/tests/*.test.js
