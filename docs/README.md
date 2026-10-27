# VSCode Codex Speed

简体中文 | [English](https://github.com/NO00/vscode-codex-speed/blob/main/docs/README.en.md)

[插件市场介绍（中英文）](https://github.com/NO00/vscode-codex-speed/blob/main/docs/MARKETPLACE.md)。本文保留完整配置、实现限制和开发步骤。

在 VS Code 状态栏查看 **Remote SSH 服务器上的 Codex 输出 token/s**。也支持本机 VS Code、WSL 和开发容器。扩展声明为 `workspace` 类型，在远程窗口中直接运行于远程扩展宿主，读取该用户的 Codex 日志；不需要额外填写 SSH 密码或同步日志。

## 监控台（0.1.10）

悬停状态栏显示简洁摘要；点击直接打开仪表盘，也可执行 **Codex Speed: 打开仪表盘**。面板采用蓝色与浅蓝绿色的开发者监控台布局：宽屏将实时读数与趋势图并排，用量数据横向排列，会话以表格展示并带短 ID；窄窗口自动转为紧凑卡片。蓝色实线为实测部分，浅蓝绿色虚线为含估算合计。面板提供：

- 数字式实时读数及实测、估算、等待、工具和空闲状态。
- 1／2／5 分钟曲线，每秒桶分别保存实测和估算，收到完成计数后按调用区间重建历史，替换对应在途估算。蓝线为实测部分，浅蓝绿色虚线为含估算合计；悬停或使用方向键可查看时间、实测、估算与占比。
- 会话名称、模型、阶段、输出数量及响应数，工作区范围和镜像去重规则沿用监控设置。
- 可选近 30 分钟、今天、近 7 天、近 30 天的输入、输出、响应数与加权平均速度，默认“今天”。今天按仪表盘客户端时区划分，近 7／30 天是滚动的 7／30 × 24 小时。近五分钟监测峰值仍来自实时曲线，可能含估算。输入可能含缓存 token，平均速度仅使用耗时已知的已完成调用。
- API 等值费用以美元显示，按响应模型区分普通输入、缓存输入和输出；随所选用量范围及工作区范围更新，支持自定义模型单价。
- 顶部界面语言、重新扫描和设置操作；连接目录、范围及时区收进可展开的连接详情。切换语言立即更新状态栏和监控台。

曲线从已有解析记录重建最近三百个一秒桶，不保存旧的估算截图；启动、迟到记录和重开面板均能利用可用日志重建。主读数为最近三秒平均，曲线为每秒值，当前尚未结束的一秒只计入已覆盖的部分，因此不必与主读数完全相等。实线也是按完成调用耗时均匀分配，并非逐 token 遥测。上次完成调用以次要文字独立展示，不占用当前主读数。

核心测速规则对齐 Agent Speed 的 Codex 口径：响应耗时至少按 500 毫秒计算，未知、倒序或超过十五分钟的区间不计速；生成中先取本会话近十分钟最后三次可测调用的加权速度，缺少时回退到同模型、同来源近半小时最后十次。参考仅来自当前所选范围内的可用完成记录；关闭 `showEstimates` 后只显示实测部分。历史用量继续单独建立持久化索引，读取与计数不修改 Codex 日志。

首次回填、读取失败或达到资源上限时会显示统计可能不完整，不能把加载过程中的零视为完整结果。仅索引 `sessions` 下近 30 天内更新的未压缩 JSONL；已索引后删除的日志，其缓存计数仍保留至 30 天窗口过期。缓存损坏时只能从仍存在的可用日志重建。

关闭面板后沿用既有状态栏轮询推进日志读取与后台索引，没有增加额外扫描计时器；隐藏时不重建图表或汇总详情。默认每 500 毫秒刷新，用户已配置的间隔保持生效。停用监控时暂停索引并让出缓存写入权。不监测网络流量。

可在用量卡片右上角选择范围，也可在用户或远程设置中配置 `"codexSpeed.usageRange": "today"`；其他可选值为 `30m`、`7d`、`30d`。语言选择继续独立生效。

## API 等值费用

费用卡片显示美元总额、三项费用和逐模型明细，按当前价格快照估算所有选中记录，不代表 Codex 订阅或实际账单。普通输入为总输入减缓存命中（再减去日志单列的缓存写入）；输出已经包含 reasoning，不重复计费。内置单价依据 [OpenAI 官方定价](https://developers.openai.com/api/docs/pricing)，快照日期为 2026-10-27。已核对模型的长上下文加价按单条响应输入总数判断。

未知模型显示“未计价”；缓存拆分或输入总数缺失时仅计算能够确定的分项，显示“已知费用小计”和完整计价覆盖率。单独记录的缓存写入不纳入三项费用，并显示排除数量；工具、Fast／Flex／Batch 等档位和地区附加费也不包含。生成中的速度估算不产生费用，费用只来自完成用量。

旧缓存会在现有后台预算内逐步补齐模型和缓存计数，不清空原统计。已删除的源日志无法补全时会保留计数并提示未计价。缓存保存原始计数而非金额，调整单价后可立即重算。

在用户或远程设置 JSON 中用 `codexSpeed.priceOverrides` 覆盖精确模型名。单位是**美元／百万 token**，三项必须齐全，零单价有效；内置模型默认继承已知长上下文规则，也可通过 `longContext` 自定义阈值及倍率。未知模型不猜测规则。示例：

```json
{
  "codexSpeed.priceOverrides": {
    "gpt-6.1-sol": { "input": 2, "cachedInput": 0.1, "output": 10 }
  }
}
```

详细的价格来源、公式和限制见[费用设计说明](https://github.com/NO00/vscode-codex-speed/blob/main/docs/design/pricing.md)。无需 API Key，不发起额外请求。

## 界面语言

从 0.1.3 起，界面默认跟随 VS Code 客户端显示语言，支持英文、简体中文和繁体中文，其他语言使用英文。Remote SSH 不使用服务器系统语言。

设置 `codexSpeed.language` 可选 `auto`（默认）、`en`、`zh-cn`、`zh-tw`。手动切换立即更新状态栏、悬浮详情、仪表盘和诊断提示，无需重载，不清空已有统计。Remote SSH 请在用户或远程设置中配置，例如 `"codexSpeed.language": "en"`。

命令面板标题和设置说明始终跟随 VS Code 显示语言。更改编辑器显示语言后，按提示重启 VS Code。

## 安装到 Remote SSH

1. 在本机 VS Code 使用 **Remote - SSH** 连接服务器，并打开一个远程目录。
2. 按 `Ctrl+Shift+P`，执行 **Extensions: Install from VSIX...（扩展：从 VSIX 安装）**，选择 `vscode-codex-speed-0.1.10.vsix`。
3. 在扩展面板确认 **VSCode Codex Speed** 位于 **SSH: 服务器名 — 已安装**。如果只安装在本地，点击扩展上的 **Install in SSH: 服务器名**。必要时执行 **Developer: Reload Window**。
4. 在服务器上以同一个用户运行 Codex。底部状态栏会出现 `Codex … tok/s`；新会话自动发现最多约需 5 秒，之后默认每半秒读取新增日志。点击状态栏打开仪表盘，使用面板顶部按钮重新扫描或打开设置。

扩展宿主必须能读取运行 Codex 的用户目录。如果 Codex 在另一个用户、Docker 容器或独立 `CODEX_HOME` 中运行，需要在相应远程环境安装扩展或显式配置可读目录。

从 0.1.1 开始，发布者标识使用实际 Marketplace Publisher `NO00`，完整插件 ID 为 `NO00.vscode-codex-speed`。如果之前安装过 **Codex SSH Speed**，或发布者为 `local-codex-tools` 的 **VSCode Codex Speed 0.1.0**，请先卸载旧扩展再安装本包，避免重复状态栏和命令注册。已有 `codexSpeed.*` 设置可以继续使用。

## 目录配置

默认顺序是远程扩展宿主的 `CODEX_HOME` 环境变量，然后是 `~/.codex`。VS Code Server 启动时继承的环境可能与交互终端不同；这时直接设置目录更可靠。

在 Remote SSH 窗口的 **远程设置 JSON** 中添加：

```json
{
  "codexSpeed.codexHome": "/home/你的用户名/.codex",
  "codexSpeed.scope": "all",
  "codexSpeed.pollIntervalMs": 500,
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
| `Codex 0.0 tok/s` | 三秒窗口已无输出；上次完成调用在仪表盘单独展示 |
| `Codex 0.0 tok/s · 工具中` | 模型已结束，等待工具结果 |
| `Codex 0.0 tok/s` | 当前空闲 |
| `Codex -- tok/s` | 暂无匹配会话；悬停查看路径与提示 |
| `Codex 日志` 警告 | 目录不存在、无读取权限或其他读取错误；悬停查看原因 |

多个正在生成的会话会显示 `· N agents`。达到扫描上限时显示 `· 部分`，不把部分数据当作完整统计。

**当前实现使用响应级日志，不能还原逐 token 的瞬时速度。** `~` 表示三秒窗口中包含估算，面板显示它占总速率的比例。完成计数会校正过去对应的曲线，但单次调用区间内仍是平均分配，水平线可以正常出现。工具中仍可能保留刚完成响应在三秒窗口中的贡献；窗口排空后归零，不保留十五秒的旧速率。

输出使用 `output_tokens`，已包含 reasoning，不能再加一次 `reasoning_output_tokens`。速度包含首 token 等待时间，依据输入事件与用量记录时间推断模型请求区间，并排除此前等待工具结果的时间。它与推理服务内部报告的纯解码速度不是同一口径；网络等待及重试会影响数值。

## 配置与操作

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `codexSpeed.enabled` | `true` | 启用监控 |
| `codexSpeed.codexHome` | 空 | 自动识别数据目录 |
| `codexSpeed.scope` | `all` | `all` 或 `workspace` |
| `codexSpeed.pollIntervalMs` | `500` | 增量读取和状态栏刷新间隔，500～10000 毫秒 |
| `codexSpeed.scanDays` | `3` | 最近修改过的日志范围，1～30 天；旧日期目录中恢复的会话也会被发现 |
| `codexSpeed.showEstimates` | `true` | 显示带 `~` 的生成中估算 |
| `codexSpeed.priceOverrides` | `{}` | 覆盖每模型的普通输入、缓存输入、输出美元单价（每百万 token），立即重算 |

命令面板提供 **Codex Speed: 查看测速详情 / 重新扫描日志 / 打开设置 / 查看诊断日志**。日志仅记录运行提示、路径及操作系统错误代码，位于 VS Code 扩展日志区域的 `logs/codex-speed.log`；单个文件超过约 1 MiB 时轮转。点击“查看测速详情”后也可以看到文件位置。

## 范围、性能和隐私

- 兼容现代 `token_usage_record` 与旧版 `event_msg/token_count`，优先现代格式，避免两种事件重复计数。
- 读取 `sessions` 下未压缩的 `.jsonl`；此版本不读取 `.jsonl.zst` 和归档目录。历史用量受可用日志和索引完整性限制。
- 目录每 5 秒重新发现；每轮最多访问 20000 个目录/文件项、跟踪最新 128 个会话、遍历至六层。工作区过滤基于日志中的 `cwd`。
- 大文件启动仅解析头部身份信息和末尾 8 MiB。普通轮询每文件读取最多 4 MiB；未完成 JSON 行留到下一次继续。超过 2 MiB 的单行跳过。缺少请求起点的用量可计入统计，但不编造耗时。
- 实时测速每会话最多保留 1000 条、近半小时的响应；历史用量另建三十天索引并持久化，不受实时样本保留窗口限制。并行会话汇总，已完成响应按身份去重；超过五分钟无日志更新的会话不再继续估算。
- 不发起网络请求，不读取登录凭证，不修改 Codex 配置或会话文件，不持久化或输出对话正文。JSON 解析过程中会接触原始日志行，只保留时间、计数、模型、会话身份及工作目录。

## 开发、测试和打包

构建与发布需要 Node.js 22+ 和 Bash；Windows 可以使用 Git Bash。运行与依赖安装入口统一在 `scripts/` 中，输出同时保存到 `logs/`。

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

产物位于 `artifacts/vscode-codex-speed-0.1.10.vsix`。从 0.1.2 起，打包使用 `docs/MARKETPLACE.md` 作为面向使用者的中英文首页，独立 PNG 图标位于 `assets/icon.png`；0.1.3 同时包含清单和运行时翻译资源。详细的中英文 README 仅保留在仓库。服务器不需要安装 Node.js 依赖。为兼容 Marketplace 上传端，包内路径只使用 ASCII 字符；设计和验证文档见 `docs/设计说明.md` 与 `docs/验证记录.md`。

`bash scripts/check-package.sh` 可独立校验现有安装包；也可在命令末尾传入待检查的 VSIX 路径。检查包括路径编码退化后的重名、非 ASCII 路径、实际 Publisher、版本、入口和中英文使用说明。

推送与版本一致的 `vX.Y.Z` 标签后，自动测试、构建并创建 GitHub Release，附件包含 VSIX 与 SHA-256。上传与校验全部成功后才正式发布，失败时保留草稿；无需配置额外 Token。手动运行工作流仍只构建，插件市场上传仍由你手动完成。步骤见[自动发布说明](publishing.md)。

## 参考

- [VS Code 远程扩展运行位置](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [Codex 项目](https://github.com/openai/codex)
- [Agent Speed 的日志及测速规格](https://github.com/zoefix/agent-speed/blob/main/spec/METRICS.md)

本扩展为独立实现，不属于 OpenAI 官方扩展或 Agent Speed 项目。
