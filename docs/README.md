# VSCode Codex Speed

简体中文 | [English](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.en.md)

在 VS Code 状态栏查看 **Remote SSH 服务器上的 Codex 输出 token/s**。也支持本机 VS Code、WSL 和开发容器。扩展声明为 `workspace` 类型，在远程窗口中直接运行于远程扩展宿主，读取该用户的 Codex 日志；不需要额外填写 SSH 密码或同步日志。

## 安装到 Remote SSH

1. 在本机 VS Code 使用 **Remote - SSH** 连接服务器，并打开一个远程目录。
2. 按 `Ctrl+Shift+P`，执行 **Extensions: Install from VSIX...（扩展：从 VSIX 安装）**，选择 `vscode-codex-speed-0.1.1.vsix`。
3. 在扩展面板确认 **VSCode Codex Speed** 位于 **SSH: 服务器名 — 已安装**。如果只安装在本地，点击扩展上的 **Install in SSH: 服务器名**。必要时执行 **Developer: Reload Window**。
4. 在服务器上以同一个用户运行 Codex。底部状态栏会出现 `Codex … tok/s`；新会话自动发现最多约需 5 秒，之后默认每秒读取新增日志。点击状态栏可以刷新、查看详情、打开设置。

扩展宿主必须能读取运行 Codex 的用户目录。如果 Codex 在另一个用户、Docker 容器或独立 `CODEX_HOME` 中运行，需要在相应远程环境安装扩展或显式配置可读目录。

从 0.1.1 开始，发布者标识使用实际 Marketplace Publisher `NO00`，完整插件 ID 为 `NO00.vscode-codex-speed`。如果之前安装过 **Codex SSH Speed**，或发布者为 `local-codex-tools` 的 **VSCode Codex Speed 0.1.0**，请先卸载旧扩展再安装本包，避免重复状态栏和命令注册。已有 `codexSpeed.*` 设置可以继续使用。

## 目录配置

默认顺序是远程扩展宿主的 `CODEX_HOME` 环境变量，然后是 `~/.codex`。VS Code Server 启动时继承的环境可能与交互终端不同；这时直接设置目录更可靠。

在 Remote SSH 窗口的 **远程设置 JSON** 中添加：

```json
{
  "codexSpeed.codexHome": "/home/你的用户名/.codex",
  "codexSpeed.scope": "all",
  "codexSpeed.pollIntervalMs": 1000,
  "codexSpeed.showEstimates": true
}
```

`codexHome` 填写包含 `sessions` 子目录的数据目录，不要填成 `.../.codex/sessions`。支持 `~/`。默认 `all` 汇总服务器近期会话，包括终端里启动的 Codex 和子 agent；改为 `workspace` 时，只统计日志 `cwd` 位于当前工作区目录下的会话。

这些设置均为机器级配置，应写入用户或远程设置，而非项目中的 `.vscode/settings.json`。

## 状态栏怎么看

| 示例 | 含义 |
| --- | --- |
| `Codex 85.0 tok/s` | 最近三秒窗口中，已完成调用的日志计数折算出的输出速度 |
| `Codex ~85.0 tok/s` | 生成中，包含该会话最近三次已完成调用的加权速率估算 |
| `Codex -- tok/s · 等待计数` | 正在生成，但没有历史速率参考，或已关闭估算 |
| `Codex 85.0 tok/s · 上次` | 最近一次已完成调用的平均速度，最多保留 15 秒，非当前实时速度 |
| `Codex 0.0 tok/s · 工具中` | 模型已结束，等待工具结果 |
| `Codex 0.0 tok/s` | 当前空闲 |
| `Codex -- tok/s` | 暂无匹配会话；悬停查看路径与提示 |
| `Codex 日志` 警告 | 目录不存在、无读取权限或其他读取错误；悬停查看原因 |

多个正在生成的会话会显示 `· N agents`。达到扫描上限时显示 `· 部分`，不把部分数据当作完整统计。

**日志不提供逐 token 的实时计数。** 这里的实时功能是持续监控和刷新，生成期间的 `~` 是历史速率估算，完成后用实际 token 计数与日志时间更新。不能把估算值视作这一秒内实际产生了多少 token。关闭 `showEstimates` 可只看完成后的实测结果。

输出使用 `output_tokens`，已包含 reasoning，不能再加一次 `reasoning_output_tokens`。速度包含首 token 等待时间，依据输入事件与用量记录时间推断模型请求区间，并排除此前等待工具结果的时间。它与推理服务内部报告的纯解码速度不是同一口径；网络等待及重试会影响数值。

## 配置与操作

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `codexSpeed.enabled` | `true` | 启用监控 |
| `codexSpeed.codexHome` | 空 | 自动识别数据目录 |
| `codexSpeed.scope` | `all` | `all` 或 `workspace` |
| `codexSpeed.pollIntervalMs` | `1000` | 增量读取和状态栏刷新间隔，500～10000 毫秒 |
| `codexSpeed.scanDays` | `3` | 最近修改过的日志范围，1～30 天；旧日期目录中恢复的会话也会被发现 |
| `codexSpeed.showEstimates` | `true` | 显示带 `~` 的生成中估算 |

命令面板提供 **Codex Speed: 查看测速详情 / 重新扫描日志 / 打开设置 / 查看诊断日志**。日志仅记录运行提示、路径及操作系统错误代码，位于 VS Code 扩展日志区域的 `logs/codex-speed.log`；单个文件超过约 1 MiB 时轮转。点击“查看测速详情”后也可以看到文件位置。

## 范围、性能和隐私

- 兼容现代 `token_usage_record` 与旧版 `event_msg/token_count`，优先现代格式，避免两种事件重复计数。
- 读取 `sessions` 下未压缩的 `.jsonl`；此版本不读取 `.jsonl.zst` 和归档目录，不提供历史报表。
- 目录每 5 秒重新发现；每轮最多访问 20000 个目录/文件项、跟踪最新 128 个会话、遍历至六层。工作区过滤基于日志中的 `cwd`。
- 大文件启动仅解析头部身份信息和末尾 8 MiB。普通轮询每文件读取最多 4 MiB；未完成 JSON 行留到下一次继续。超过 2 MiB 的单行跳过。缺少请求起点的用量可计入统计，但不编造耗时。
- 每会话最多保留 1000 条、近半小时的响应用量；进程重启后从日志重建。并行会话汇总，已完成响应按身份去重；超过五分钟无日志更新的会话不再继续估算。
- 不发起网络请求，不读取登录凭证，不修改 Codex 配置或会话文件，不持久化或输出对话正文。JSON 解析过程中会接触原始日志行，只保留时间、计数、模型、会话身份及工作目录。

## 开发、测试和打包

需要 Node.js 20+ 和 Bash；Windows 可以使用 Git Bash。运行与依赖安装入口统一在 `scripts/` 中，输出同时保存到 `logs/`。

```bash
bash scripts/setup.sh
bash scripts/test.sh
bash scripts/host-test.sh "/path/to/VS Code/executable"
bash scripts/package.sh
```

Windows 真实宿主测试示例：

```powershell
& 'D:\software\Git\bin\bash.exe' scripts/host-test.sh 'D:\software\Microsoft VS Code\Code.exe'
```

`host-test.sh` 使用独立临时用户数据、虚拟 Codex 日志和独立扩展目录启动 VS Code，不会改动现有 VS Code 配置。测试报告和宿主日志保留在脚本打印的临时目录。

不传入可执行文件路径时，脚本使用 `@vscode/test-electron` 从微软下载独立的 VS Code 1.90.2 测试副本，并验证最低支持版本。

若本机为使用版本子目录的 Windows 安装，且更新锁阻止启动，可使用 `bash scripts/host-test.sh --copy-installed "/path/to/VS Code"`。脚本把当前版本复制到 `.vscode-test/isolated-installed`，仅在副本的产品元数据中关闭 Windows 安装器更新协调，原安装保持只读。这适合验证当前已安装版本，不代表最低版本验证。

产物位于 `artifacts/vscode-codex-speed-0.1.1.vsix`。VSIX 包含已编译代码和中英文使用说明，不需要在服务器安装 Node.js 依赖。为兼容 Marketplace 上传端，包内文件路径只使用 ASCII 字符；中文文件名的设计和验证文档仅保留在源码仓库，见 `docs/设计说明.md` 与 `docs/验证记录.md`。

`bash scripts/check-package.sh` 可独立校验现有安装包；也可在命令末尾传入待检查的 VSIX 路径。检查包括路径编码退化后的重名、非 ASCII 路径、实际 Publisher、版本、入口和中英文使用说明。

## 参考

- [VS Code 远程扩展运行位置](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [Codex 项目](https://github.com/openai/codex)
- [Agent Speed 的日志及测速规格](https://github.com/zoefix/agent-speed/blob/main/spec/METRICS.md)

本扩展为独立实现，不属于 OpenAI 官方扩展或 Agent Speed 项目。
