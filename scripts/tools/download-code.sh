#!/usr/bin/env bash
TASK_NAME=download-code
source "$(dirname "$0")/../common.sh"
mkdir -p .vscode-test/portable-1.90.2
# curl 断点续传用于应对大文件连接中断；仅下载微软官方测试版本。
curl.exe --fail --location --retry 3 --retry-all-errors --continue-at - --output .vscode-test/code-1.90.2.zip 'https://update.code.visualstudio.com/1.90.2/win32-x64-archive/stable'
powershell.exe -NoProfile -Command 'Expand-Archive -LiteralPath .vscode-test/code-1.90.2.zip -DestinationPath .vscode-test/portable-1.90.2 -Force'
