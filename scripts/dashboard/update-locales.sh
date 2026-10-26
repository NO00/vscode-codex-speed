#!/usr/bin/env bash
TASK_NAME=dashboard-locales
source "$(dirname "$0")/../common.sh"
node scripts/dashboard/update-locales.cjs "$@"
