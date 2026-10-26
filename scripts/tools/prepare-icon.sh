#!/usr/bin/env bash
TASK_NAME=prepare-icon
source "$(dirname "$0")/../common.sh"
powershell.exe -NoProfile -File scripts/tools/prepare-icon.ps1 -Source "$1" -Destination assets/icon.png -Size 256
