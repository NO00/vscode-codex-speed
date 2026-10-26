#!/usr/bin/env bash
TASK_NAME=build
source "$(dirname "$0")/common.sh"
node node_modules/typescript/bin/tsc -p tsconfig.json
