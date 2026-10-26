#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p logs
# 所有构建、测试及安装输出同时写入文件，便于复现问题。
exec > >(tee -a "logs/${TASK_NAME:-task}.log") 2>&1
