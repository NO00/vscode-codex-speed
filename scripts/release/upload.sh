#!/usr/bin/env bash
TASK_NAME=release-upload
source "$(dirname "$0")/../common.sh"
node scripts/release/metadata.cjs
node scripts/release/metadata.cjs --verify-checksum
[[ "${GITHUB_EVENT_NAME:-}" == "release" ]] || { echo '仅正式 Release 事件可更新附件'; exit 1; }
task_vsix="$(node scripts/release/metadata.cjs --field vsix_path)"
task_checksum="$(node scripts/release/metadata.cjs --field checksum_path)"
[[ -f "$task_vsix" && -f "$task_checksum" ]] || { echo 'Release 构建产物缺失'; exit 1; }
# 以标签源码的本次构建结果更新 Release 附件，供用户下载或手动上传市场。
gh release upload "$RELEASE_TAG" "$task_vsix" "$task_checksum" --repo "$GITHUB_REPOSITORY" --clobber
