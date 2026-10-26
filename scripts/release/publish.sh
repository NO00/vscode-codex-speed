#!/usr/bin/env bash
TASK_NAME=release-publish
source "$(dirname "$0")/../common.sh"
node scripts/release/metadata.cjs
task_vsix="$(node scripts/release/metadata.cjs --field vsix_path)"
node scripts/release/metadata.cjs --verify-checksum
node scripts/tools/check-package.cjs "$task_vsix"
if [[ "${PUBLISH_DRY_RUN:-false}" == "true" ]]; then
  echo "发布预检通过：$task_vsix；Publisher=NO00；认证方式=GitHub OIDC。未调用在线发布接口。"
  exit 0
fi
node -e "if (!require('./scripts/release/metadata.cjs').publishAllowed()) { console.error('在线发布仅允许正式 Release 事件'); process.exit(1); }"
# 固定使用 OIDC；失败时不回退到个人访问令牌或本机保存的凭证。
unset VSCE_PAT
node node_modules/@vscode/vsce/vsce publish --packagePath "$task_vsix" --oidc --skip-duplicate
