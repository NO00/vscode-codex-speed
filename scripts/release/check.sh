#!/usr/bin/env bash
TASK_NAME=release-check
source "$(dirname "$0")/../common.sh"
node scripts/release/metadata.cjs
