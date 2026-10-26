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
- 点击状态栏即可查看详情、重新扫描或调整设置。

这是独立的社区扩展。当前界面为简体中文，不属于 OpenAI 官方产品。

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
- One-click access to details, rescanning, and settings.

This is an independent community extension. The current UI uses Simplified Chinese; it is not an official OpenAI product.

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
| `等待计数` | Waiting for usage counts; no reference is available or estimates are disabled |
| `上次` | Last completed call's rate, retained for up to about 15 seconds |
| `工具中` / `0.0 tok/s` | Waiting for tool results, or idle |

**A rate marked with `~` is an estimate, not token-by-token telemetry.** Completed Codex records update it using actual counts and log timestamps. Duration includes time to first token; output includes reasoning. This differs from a model server's internal decoding rate.

The default host-wide scope includes other sessions, even when the chat you are viewing has stopped. Missing completion events can leave generation estimates active until five minutes after the latest log event.

### Useful settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `codexSpeed.scope` | `all` | Use `workspace` to include only sessions inside the current workspace folders |
| `codexSpeed.showEstimates` | `true` | Set to `false` to wait for completed usage records rather than show generation estimates |
| `codexSpeed.pollIntervalMs` | `1000` | Poll interval in milliseconds; use `3000` for less frequent polling |
| `codexSpeed.enabled` | `true` | Start or stop monitoring |

### Troubleshooting

Hover over the status item for a diagnostic message, or run **Codex Speed: 查看诊断日志** from the Command Palette. Check that the extension and Codex run on the same host and that the extension user can read the logs. Point `codexHome` to the data directory, not the `sessions` folder. This version reads uncompressed session JSONL only.

If upgrading from an old `local-codex-tools` build, uninstall that extension first to avoid duplicate status items. Existing `codexSpeed.*` settings remain compatible.

### Privacy and resource use

The extension reads logs without modifying Codex settings, reading login credentials, or uploading conversation text. It makes no model requests and consumes no extra model tokens. File reads and calculations have some resource overhead. See the [full English documentation](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.en.md) for additional settings, limits, and development instructions.
