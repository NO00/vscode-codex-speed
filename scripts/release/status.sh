#!/usr/bin/env bash
TASK_NAME=release-status
source "$(dirname "$0")/../common.sh"
task_notice='Release 安装包已自动构建；Marketplace OIDC 授权尚未启用，因此本次没有向插件市场发布。完成策略绑定与 OIDC 验证后，将仓库变量 MARKETPLACE_OIDC_ENABLED 设为 true。'
echo "$task_notice"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$task_notice" >> "$GITHUB_STEP_SUMMARY"
fi
