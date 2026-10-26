# VSCode Codex Speed

English | [简体中文](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.md)

See the [bilingual Marketplace overview](https://github.com/NO00/vscode-codex-speed/blob/main/docs/MARKETPLACE.md) for a quick user guide. This document retains the full configuration, limitations, and development instructions.

Monitor **Codex output tokens per second on a Remote SSH server** from the VS Code status bar. Local VS Code, WSL, and development containers are also supported by the extension's workspace-host architecture.

The extension runs as a `workspace` extension. In a remote window, it reads Codex logs directly on the remote extension host, using that host's user account. No additional SSH credentials or log synchronization are needed.

> This is an independent extension, not an official OpenAI extension or part of Agent Speed.

## Monitoring console (0.1.7)

Hover over the status item for a compact summary. Click it, or run **Codex Speed: Open Dashboard**, to open the dashboard beside your editor. It includes a digital speed readout, measured/estimated state, 1/2/5-minute charts, session/model/phase summaries, and usage statistics for the last 30 minutes, today, the last 7 days or the last 30 days. Today is the default and follows the dashboard client’s time zone; 7/30-day windows are rolling 7/30 × 24 hours. The toolbar contains language selection, rescan and Settings. Connection metadata, including the client time zone, is available in an expandable details section.

The console uses blue for measured speed and teal for estimates. Wide windows place the live reading beside the trend chart, show usage in a horizontal strip, and align sessions in a table with short IDs. Narrow windows switch to compact cards. The circular gauge has been removed.

The chart records while monitoring and retains five minutes in memory. Dashed segments include estimates; the main readout, session rates and chart use the same three-second window and return to zero without current output or an estimate. The last completed call is shown separately with its rate and time. No history is invented for time before monitoring began. Changing log directories, scope, or restarting monitoring resets the chart; switching language does not. Closing the dashboard leaves status-bar sampling active, while hidden dashboards skip detailed aggregation.

Input counts may include cached tokens. Average speed is weighted by completed request duration and excludes responses with unknown duration. The five-minute peak can include estimates. Usage history is indexed incrementally from the beginning of uncompressed JSONL files under `sessions` modified within the last 30 days, then cached in extension storage. Cursor and counters are saved together; restarts resume from committed line boundaries. Existing Codex logs remain read-only. Counts already cached from deleted logs remain until the 30-day retention window expires; a damaged cache can only be rebuilt from logs that still exist.

Initial indexing, read failures and resource limits are explicitly marked as potentially incomplete. Background indexing uses the existing monitoring cycle with a byte budget; disabling monitoring pauses it and releases the cache writer lock. Cost estimates and network traffic tracking are not included.

Select the period in the usage card, or set `codexSpeed.usageRange` to `today` (default), `30m`, `7d` or `30d` in User or Remote settings. Changing the usage period does not clear the speed chart.

## Interface language

Since 0.1.3, the UI follows the VS Code client display language. English, Simplified Chinese and Traditional Chinese are supported; other languages fall back to English. Remote SSH uses the client's display language, not the server's system locale.

Set `codexSpeed.language` to `auto` (default), `en`, `zh-cn` or `zh-tw` in User or Remote settings, for example `"codexSpeed.language": "en"`. Manual changes immediately update the status bar, hover details, dashboard and diagnostic messages without reloading or resetting usage counts.

Command Palette titles and Settings descriptions always follow the VS Code display language. Restart VS Code when prompted after changing its display language.

## Install in a Remote SSH window

1. Connect to your server using **Remote - SSH** and open a remote folder.
2. Open the Command Palette and run **Extensions: Install from VSIX...**. Select `vscode-codex-speed-0.1.7.vsix`.
3. Confirm that **VSCode Codex Speed** appears under **SSH: your-server — Installed** in the Extensions view. If it is installed only locally, select **Install in SSH: your-server**. Run **Developer: Reload Window** if needed.
4. Run Codex on the server as the same user. The status bar will show `Codex … tok/s`. New sessions are normally discovered within about five seconds, and existing logs are polled every second by default. Click the item to open the dashboard, whose toolbar offers rescanning and Settings.

The extension host must have permission to read the Codex user's data directory. If Codex runs as a different user, inside a container, or with a custom `CODEX_HOME`, install the extension in the matching environment or configure an accessible directory.

Starting with 0.1.1, the publisher is the actual Marketplace publisher `NO00`, and the extension ID is `NO00.vscode-codex-speed`. Uninstall **Codex SSH Speed**, or **VSCode Codex Speed 0.1.0** published under `local-codex-tools`, before installing this package. Running the old and new IDs together can cause duplicate status items and command registrations. Existing `codexSpeed.*` settings remain compatible.

## Configure the log directory

The default data directory is taken from the extension host's `CODEX_HOME` environment variable, falling back to `~/.codex`. VS Code Server may inherit a different environment from your interactive terminal; set the path explicitly if necessary.

In your Remote SSH window, add this to **Remote Settings (JSON)**:

```json
{
  "codexSpeed.codexHome": "/home/your-user/.codex",
  "codexSpeed.scope": "all",
  "codexSpeed.pollIntervalMs": 1000,
  "codexSpeed.showEstimates": true
}
```

Set `codexHome` to the data directory containing `sessions`, not to `.../.codex/sessions` itself. Paths starting with `~/` are supported.

The default `all` scope aggregates recent sessions on the host, including terminal sessions and subagents. Use `workspace` to include only sessions whose logged `cwd` is inside one of the current workspace folders. This selects folders, not the particular chat currently visible in the Codex UI.

All settings use VS Code's machine scope. Set them in User or Remote settings rather than in a project's `.vscode/settings.json`.

## Understand the status bar

The examples below show the English UI. Chinese labels are used when that language is selected.

| Display | Meaning |
| --- | --- |
| `Codex 85.0 tok/s` | Output rate derived from completed response records within the trailing three-second window |
| `Codex ~85.0 tok/s` | Generation is in progress; the rate includes an estimate based on this session's latest three measured responses |
| `Codex -- tok/s · Waiting for counts` | Waiting for usage counts: generation is in progress, but no speed reference is available or estimates are disabled |
| `Codex 0.0 tok/s` | No output in the three-second window; the last completed call is displayed separately in the dashboard |
| `Codex 0.0 tok/s · Tools` | The model has finished a response and is waiting for tool results |
| `Codex 0.0 tok/s` | Idle |
| `Codex -- tok/s` | No matching sessions; hover for the configured path and diagnostic information |
| `Codex Logs` with a warning icon | Missing directory, insufficient permissions, or another log-reading error; hover for details |

When multiple sessions are generating, the item includes `· N agents`. The suffix `· Partial` means a scan limit was reached and the displayed data is partial.

**The logs do not provide token-by-token live counts.** Here, “live” means continuous monitoring and display updates. During generation, `~` marks an estimate based on previous measured speeds. Completed usage records replace that estimate with a rate derived from token counts and log timestamps. An estimated value is not a count of tokens actually produced in the current second. Disable `showEstimates` to wait for measured results instead.

Output uses `output_tokens`, which already includes reasoning tokens. `reasoning_output_tokens` must not be added again. Request duration is inferred from input and usage-record timestamps, includes time to first token, and excludes the preceding wait for tool results. Network delays and retries can affect the result. This is a different metric from the model server's internal decoding speed.

If an end event is missing, a session can retain its generation estimate until five minutes after its latest log event. Also, the host-wide scope can show activity from another Codex session even when the chat you are looking at has stopped.

## Settings and commands

| Setting | Default | Description |
| --- | --- | --- |
| `codexSpeed.language` | `auto` | Follow VS Code, or override the runtime UI with `en`, `zh-cn` or `zh-tw`; applies immediately |
| `codexSpeed.enabled` | `true` | Enable monitoring |
| `codexSpeed.codexHome` | Empty | Automatically resolve the Codex data directory |
| `codexSpeed.scope` | `all` | Monitor `all` recent host sessions or only the current `workspace` |
| `codexSpeed.pollIntervalMs` | `1000` | Incremental reads and display refresh interval, from 500 to 10000 ms |
| `codexSpeed.scanDays` | `3` | Include recently modified logs from the last 1–30 days; resumed sessions in older date folders can also be discovered |
| `codexSpeed.showEstimates` | `true` | Show generation estimates marked with `~` |

The Command Palette provides these commands:

- **Codex Speed: Show Speed Details** — Show speed details.
- **Codex Speed: Rescan Logs** — Rescan logs.
- **Codex Speed: Open Settings** — Open settings.
- **Codex Speed: Show Diagnostic Logs** — Show diagnostic logs.

Diagnostic logs record operational messages, paths, and operating-system error codes. They are written to `logs/codex-speed.log` under VS Code's extension log directory and rotate after approximately 1 MiB. Run **Codex Speed: Show Diagnostic Logs** to see the file location.

## Limits, performance, and privacy

- Supports modern `token_usage_record` and legacy `event_msg/token_count` events. Modern records take precedence to avoid double-counting compatibility events.
- Reads uncompressed `.jsonl` files under `sessions`. This version does not read `.jsonl.zst` files or archived sessions. Historical totals depend on available logs and index completeness.
- Rediscovers files every five seconds. Each discovery pass visits at most 20000 file/directory entries, traverses up to six levels, and tracks the latest 128 session files. Workspace filtering uses the logged `cwd`.
- For large files, startup reads identity metadata from the beginning and parses only the last 8 MiB. Subsequent polling reads at most 4 MiB per file per pass. Partial JSON lines are buffered until complete; lines larger than 2 MiB are skipped. Usage records without a known request start can contribute token counts but do not produce an invented duration.
- Real-time speed retains up to 1000 responses per session from the last 30 minutes. Historical usage has a separate persistent 30-day index and is not restricted to that live sample window. Parallel sessions are aggregated and completed responses are deduplicated by identity. Generation estimates stop after five minutes without a new log event.
- Makes no network requests, reads no login credentials, and does not modify Codex configuration or session files. It does not persist or output conversation text. Parsing necessarily touches raw JSONL rows, but the retained data consists of timestamps, counts, model names, session identities, and working directories.

## Develop, test, and package

Building and publishing require Node.js 22+ and Bash. On Windows, Git Bash can be used. Dependency installation, builds, and tests run through scripts in `scripts/`; their output is also saved under `logs/`.

```bash
bash scripts/setup.sh
bash scripts/test.sh
bash scripts/host-test.sh "/path/to/VS Code/executable"
bash scripts/package.sh
```

Windows example:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' scripts/host-test.sh 'C:\path\to\Microsoft VS Code\Code.exe'
```

`host-test.sh` launches VS Code with separate temporary user data, synthetic Codex logs, and an isolated extensions directory. It does not change your existing VS Code configuration. Reports and host logs are retained in the temporary directory printed by the script.

If no executable path is supplied, `@vscode/test-electron` downloads a separate VS Code 1.90.2 test copy from Microsoft and runs the host tests against that version. A successful download and test run are required to confirm compatibility with that minimum version. The completed host validation for this project used VS Code 1.143.1; minimum-version and actual Remote SSH validation remain outstanding.

For a Windows installation using version subdirectories, an updater lock may prevent a new instance from starting. Use `bash scripts/host-test.sh --copy-installed "/path/to/VS Code"` to create an isolated copy under `.vscode-test/isolated-installed`. Only that copy's product metadata is adjusted to disable Windows installer update coordination; the original installation remains read-only. This tests the installed version, not necessarily the minimum supported version.

The package is generated at `artifacts/vscode-codex-speed-0.1.7.vsix`. Starting with 0.1.2, `docs/MARKETPLACE.md` supplies the bilingual user-facing Marketplace overview, and `assets/icon.png` supplies the extension's own icon. Version 0.1.3 includes manifest and runtime translations. The detailed Chinese/English README files remain in the repository. No Node.js dependency installation is required on the server. All VSIX paths use ASCII characters for upload compatibility. Architecture and validation documents remain in the source repository at `docs/设计说明.md` and `docs/验证记录.md`.

Run `bash scripts/check-package.sh` to inspect an existing package, optionally passing a VSIX path. Checks reject duplicate paths after lossy ASCII conversion, non-ASCII paths, incorrect publisher/version metadata, and missing entry points or user documentation.

Pushing a matching stable `vX.Y.Z` tag automatically runs tests, builds the VSIX and creates a GitHub Release with the VSIX and SHA-256 attachments. The release stays a draft until upload and verification succeed. No additional token is required. Manual workflow dispatch remains build-only. Marketplace uploads remain manual. Details are in the Chinese [release guide](publishing.md).

## References

- [VS Code: Supporting Remote Development](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [Codex repository](https://github.com/openai/codex)
- [Agent Speed measurement specification](https://github.com/zoefix/agent-speed/blob/main/spec/METRICS.md)
