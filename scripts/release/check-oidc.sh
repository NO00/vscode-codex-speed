#!/usr/bin/env bash
TASK_NAME=oidc-check
source "$(dirname "$0")/../common.sh"
unset VSCE_PAT
node scripts/release/oidc-check.cjs
