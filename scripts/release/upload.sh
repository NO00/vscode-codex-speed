#!/usr/bin/env bash
TASK_NAME=release-upload
source "$(dirname "$0")/../common.sh"
node scripts/release/metadata.cjs --assert-tag-push
node scripts/release/metadata.cjs --verify-checksum
# 创建草稿、校验附件后再正式发布；仅调用 GitHub，不调用 Marketplace。
node scripts/release/github.cjs
