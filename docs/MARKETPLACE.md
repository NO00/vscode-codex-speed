# VSCode Codex Speed

**在状态栏查看 Codex 输出速度，包括 Remote SSH 服务器上的会话。**

**See Codex output speed in your VS Code status bar, including sessions on a Remote SSH server.**

[简体中文](#简体中文) · [English](#english) · [GitHub](https://github.com/NO00/vscode-codex-speed) · [反馈问题 / Report an issue](https://github.com/NO00/vscode-codex-speed/issues)

```text
Codex 85.0 tok/s          输出速度 / Measured rate
Codex ~85.0 tok/s         生成中估算 / Generation estimate
Codex 85.0 tok/s · 上次   最近一次调用 / Last completed call
```

## 简体中文

### 能帮你做什么

- 直接在状态栏查看 Codex 的输出 token/s，悬停查看最近调用的模型、输出数量和耗时。
- 在 Remote SSH 窗口读取服务器上的 Codex 日志，不用手动同步日志或再次配置 SSH 连接。
- 汇总多个会话和子 agent，也可以只查看当前工作区中的会话。
- 点击状态栏打开仪表盘：速度仪表、1／2／5 分钟曲线、会话列表及可切换范围的用量。

这是独立的社区扩展，不属于 OpenAI 官方产品。界面默认跟随 VS Code 显示语言，支持英文、简体中文和繁体中文；其他语言使用英文。

设置 `codexSpeed.language` 可选 `auto`（默认）、`en`、`zh-cn` 或 `zh-tw`。手动切换立即更新状态栏、悬浮提示、仪表盘及诊断提示，无需重载。Remote SSH 跟随客户端语言，手动选择请写入远程设置。命令面板标题和设置说明始终跟随 VS Code 显示语言。

### 仪表盘

悬停显示简洁摘要，点击状态栏打开完整仪表盘。曲线从本次监控启动后开始积累，实线为实测，虚线包含估算。用量支持近 30 分钟、今天、近 7 天和近 30 天，默认“今天”，按 VS Code 客户端时区划分。近 7／30 天为滚动小时窗口。输入可能含缓存 token，平均速度使用耗时已知的已完成调用；五分钟峰值仍来自实时采样，可能包含估算。

首次使用会分批索引历史，显示进度及不完整提示。缓存保存计数与读取断点，重启后继续增量读取；只支持 `sessions` 目录下近 30 天内更新的未压缩 JSONL。缓存文件保存在扩展存储目录，Codex 日志保持只读。

可直接在面板底部选择语言，顶部重新扫描或打开设置。关闭面板后仍按已有监控周期采样，未增加额外扫描计时器；没有费用或网络流量统计。

### 安装后怎么用

1. 在扩展市场搜索 **VSCode Codex Speed**，或使用 `@id:NO00.vscode-codex-speed` 安装。
2. 使用 Remote SSH 时，确认它安装在 **SSH: 服务器名** 一侧。
3. 在同一台主机上，以同一用户运行 Codex。状态栏会自动出现速度读数。

默认读取 `CODEX_HOME`，未设置时使用 `~/.codex`。新会话通常在约五秒内被发现，之后默认每秒刷新。

如果使用独立的 Codex 数据目录，请在 VS Code 的**用户或远程设置**中填写包含 `sessions` 子目录的路径：

```json
{
  "codexSpeed.codexHome": "/home/your-user/.codex"
}
```

### 数字代表什么

| 状态栏显示 | 含义 |
| --- | --- |
| `85.0 tok/s` | 已完成响应的日志计数在最近三秒窗口内折算的速度 |
| `~85.0 tok/s` | 生成中，依据该会话近期调用速度估算 |
| `等待计数` | 尚无可靠速度参考，或已关闭估算 |
| `上次` | 最近完成的一次调用速度，最多保留约 15 秒 |
| `工具中` / `0.0 tok/s` | 等待工具结果，或当前空闲 |

**生成中的 `~` 是估算，不是逐 token 的实时计数。** Codex 写入完成记录后，插件再用实际 token 数和日志时间更新。速度包含首 token 等待时间，输出计数包含 reasoning，不能直接与模型服务器的纯解码速度比较。

默认统计此主机的全部近期会话，所以当前聊天停下来时，其他会话仍可能贡献速度。如果缺少结束事件，生成估算可能持续到最近一条日志后的五分钟。

### 常用设置

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `codexSpeed.usageRange` | `today` | 用量范围，可选 `30m`、`today`、`7d`、`30d` |
| `codexSpeed.language` | `auto` | 跟随 VS Code，或手动选择 `en`、`zh-cn`、`zh-tw`，立即生效 |
| `codexSpeed.scope` | `all` | 改为 `workspace`，仅查看当前工作区中的会话 |
| `codexSpeed.showEstimates` | `true` | 改为 `false`，生成中等待完成记录再显示实测结果 |
| `codexSpeed.pollIntervalMs` | `1000` | 刷新间隔（毫秒）；可调为 `3000`，降低轮询频率 |
| `codexSpeed.enabled` | `true` | 开启或停止监控 |

### 看不到速度时

先悬停状态栏查看提示，或在命令面板执行 **Codex Speed: 查看诊断日志**。确认扩展和 Codex 位于同一主机，运行用户有权读取日志；`codexHome` 应指向 `.codex` 数据目录，而非 `sessions` 本身。此版本仅读取未压缩的会话 JSONL。

从旧的 `local-codex-tools` 版本迁移时，请先卸载旧扩展，避免重复状态栏。已有 `codexSpeed.*` 设置可继续使用。

### 隐私与资源占用

扩展只读会话日志，不修改 Codex 设置，不读取登录凭证，不上传对话内容，也不发起模型请求或额外消耗 token。监控会产生文件读取和计算开销。更多设置、资源限制和开发步骤请看[完整中文说明](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.md)。

## English

### What you get

- Codex output tokens per second in the status bar. Hover for the latest measured call's model, output count, and duration.
- Direct log monitoring on your Remote SSH host, with no manual log synchronization or extra SSH connection setup.
- Combined readings for multiple sessions and subagents, or a view limited to your workspace folders.
- A dashboard with a speed gauge, 1/2/5-minute charts, session summaries and selectable usage periods.

This is an independent community extension, not an official OpenAI product. The UI follows the VS Code display language by default. English, Simplified Chinese and Traditional Chinese are supported; other languages fall back to English.

Set `codexSpeed.language` to `auto` (default), `en`, `zh-cn` or `zh-tw` in User or Remote settings. Manual changes immediately update the status bar, hover details, dashboard and diagnostic messages without reloading. Remote SSH follows the client's display language, not the server's system locale. Command Palette titles and Settings descriptions always follow VS Code's display language.

### Dashboard

Hover for a compact summary, or click the status item to open the full dashboard. Speed history accumulates while monitoring; solid segments are measured and dashed segments include estimates. Usage supports the last 30 minutes, today, the last 7 days and the last 30 days. Today is the default and uses the VS Code client’s time zone; 7/30-day periods use rolling hours. Input may include cached tokens; average speed uses completed calls with known duration. The peak can include estimates.

Select a language at the bottom, rescan or open Settings from the toolbar. Closing the dashboard keeps the existing status-bar sampling active, without another scanning timer. Cost and network traffic tracking are not included.

### Get started

1. Install **VSCode Codex Speed** from the Marketplace, or search for `@id:NO00.vscode-codex-speed`.
2. In a Remote SSH window, confirm installation on **SSH: your-server**.
3. Run Codex on that host as the same user. The status item appears automatically.

The extension uses `CODEX_HOME`, falling back to `~/.codex`. New sessions are normally discovered within about five seconds, followed by one-second polling by default.

For a custom data directory, set `codexSpeed.codexHome` in VS Code **User or Remote settings** to the directory containing `sessions`, for example `/home/your-user/.codex`.

### Read the numbers

| Display | Meaning |
| --- | --- |
| `85.0 tok/s` | Rate derived from completed response records over the trailing three-second window |
| `~85.0 tok/s` | Generation estimate based on this session's recent measured calls |
| `Waiting for counts` | Waiting for usage counts; no reference is available or estimates are disabled |
| `Last` | Last completed call's rate, retained for up to about 15 seconds |
| `Tools` / `0.0 tok/s` | Waiting for tool results, or idle |

**A rate marked with `~` is an estimate, not token-by-token telemetry.** Completed Codex records update it using actual counts and log timestamps. Duration includes time to first token; output includes reasoning. This differs from a model server's internal decoding rate.

The default host-wide scope includes other sessions, even when the chat you are viewing has stopped. Missing completion events can leave generation estimates active until five minutes after the latest log event.

Historical usage is indexed in batches from uncompressed JSONL files under `sessions` modified within the last 30 days. Initial indexing and incomplete results are clearly marked. Counters and read cursors are cached in extension storage so indexing can resume after a restart; Codex logs remain read-only.

### Useful settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `codexSpeed.usageRange` | `today` | Usage period: `30m`, `today`, `7d` or `30d` |
| `codexSpeed.language` | `auto` | Follow VS Code or manually select `en`, `zh-cn` or `zh-tw`; applies immediately |
| `codexSpeed.scope` | `all` | Use `workspace` to include only sessions inside the current workspace folders |
| `codexSpeed.showEstimates` | `true` | Set to `false` to wait for completed usage records rather than show generation estimates |
| `codexSpeed.pollIntervalMs` | `1000` | Poll interval in milliseconds; use `3000` for less frequent polling |
| `codexSpeed.enabled` | `true` | Start or stop monitoring |

### Troubleshooting

Hover over the status item for a diagnostic message, or run **Codex Speed: Show Diagnostic Logs** from the Command Palette. Check that the extension and Codex run on the same host and that the extension user can read the logs. Point `codexHome` to the data directory, not the `sessions` folder. This version reads uncompressed session JSONL only.

If upgrading from an old `local-codex-tools` build, uninstall that extension first to avoid duplicate status items. Existing `codexSpeed.*` settings remain compatible.

### Privacy and resource use

The extension reads logs without modifying Codex settings, reading login credentials, or uploading conversation text. It makes no model requests and consumes no extra model tokens. File reads and calculations have some resource overhead. See the [full English documentation](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.en.md) for additional settings, limits, and development instructions.
