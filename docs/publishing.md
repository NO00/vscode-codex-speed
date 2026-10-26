# GitHub Release 自动发布到 VS Code 插件市场

## 已配置的流程

仓库工作流位于 `.github/workflows/publish.yml`，面向发布者 `NO00` 的 `NO00.vscode-codex-speed` 扩展。

正式发布 GitHub Release 后，GitHub Actions 会：

1. 检出 Release 标签指向的源码，校验标签与 `package.json`、`package-lock.json` 中的版本完全一致。
2. 使用 Node.js 22 安装锁定依赖，运行核心、文件回放和发布校验测试。
3. 构建并校验 VSIX，验证路径、版本、发布者、图标和双语市场介绍。
4. 将 VSIX 与 SHA-256 文件上传至该 Release，并保存一份 Actions 构建产物。同名 Release 附件以本次构建结果为准。
5. 发布任务下载同一份构建产物，先核对原 SHA-256，再通过 GitHub OIDC 取得短期 Marketplace 凭证并发布。

当前 Marketplace 端的原生可信策略入口尚未确认可用，因此仓库变量 `MARKETPLACE_OIDC_ENABLED` 保持 `false`。在此状态下，正式 Release 仍自动构建和上传 VSIX，但市场发布任务跳过，并在运行摘要中明确说明“未发布到 Marketplace”。完成策略绑定并验证后，才能将该变量改为 `true`。

工作流只监听 `release.published`，创建草稿不会触发。标记为预发布的 Release 会跳过。`workflow_dispatch` 是手动预检入口，只测试、构建和保存 Actions 产物，不上传 Release 附件，也不发布到 Marketplace；可额外勾选 `verify_oidc`，仅验证短期凭证交换。

## 一次性绑定可信发布

GitHub 工作流中的 `id-token: write` 允许请求身份令牌，但不会自动赋予 Marketplace 发布权限。需要在 Marketplace 为发布者 `NO00` 配置可信发布策略，信任以下 GitHub 身份：

| 项目 | 值 |
| --- | --- |
| 提供方 | GitHub Actions |
| 仓库所有者 | `NO00` |
| 仓库名称 | `vscode-codex-speed` |
| 工作流文件 | `publish.yml`，完整路径 `.github/workflows/publish.yml` |
| GitHub Environment | `marketplace` |
| OIDC Issuer | `https://token.actions.githubusercontent.com` |
| Audience | `marketplace.visualstudio.com` |
| Environment Subject | 必须以 GitHub 实际签发的 `sub` 为准；新仓库可能采用包含不可变所有者/仓库 ID 的格式 |

以 Marketplace 实际提供的字段为准；不要把 GitHub Environment 当成仓库名称，也不要把域名认证当成可信发布绑定。策略属于微软托管的发布者账号配置，需要账号所有者在登录后完成；仅提交本仓库代码不能替代这一步。

不要直接套用旧示例中的 `repo:所有者/仓库:environment:marketplace` Subject：GitHub 对新建或迁移的仓库可能使用包含不可变 ID 的默认格式。若策略要求手工填写 Subject，需要先确认实际身份声明。

如果账号页面尚未提供 Trusted publishing / OIDC 策略入口，应先确认此功能是否已对该发布者开放。此配置不会自动切换到 PAT，不需要把任何密码或 Token 发到聊天中。

无需依赖该原生策略入口的另一条免 PAT 路线是微软正式支持的 Entra OIDC：创建 Entra 应用及联合身份，将其服务主体添加为 Marketplace 发布者成员，再通过 `--azure-credential` 发布。这需要租户和应用注册权限，不能仅修改本仓库文件完成。

GitHub 的 `marketplace` Environment 未配置人工审批，因此正常发布无需每次确认。若后续自行添加 Environment 审批规则，发布任务会按新规则等待审批。

## 以后发布新版本

例如发布 0.1.3：

1. 将 `package.json` 的 `version` 改为 `0.1.3`，同步 `package-lock.json` 顶层与根包版本，并提交推送。
2. 在 GitHub 创建指向该提交的正式 Release，标签填写 `v0.1.3`。
3. 点击 **Publish release**。无需手动附加 VSIX；工作流会构建并上传附件。
4. 在仓库 **Actions → 发布到 VS Code Marketplace** 查看结果。工具提交成功后，Marketplace 仍可能继续执行自己的扫描和校验。

必须使用包含自动发布工作流的新提交创建标签。旧标签（例如最初发布的 v0.1.2）指向的源码不含此工作流，不能仅通过重新发布旧 Release 来补上自动化。

重复运行时，已经存在于 Marketplace 的版本会由 `--skip-duplicate` 跳过。更新内容仍必须递增版本号；相同版本的安装包不能被当作新版本覆盖发布。

## 提前预检

从仓库 Actions 页面选择本工作流，点击 **Run workflow**，选择 `main`。默认不会请求 Marketplace 身份令牌，也不会执行在线发布。可以下载工作流生成的 VSIX 进行人工试用，再创建正式 Release。

配置完可信策略后，可再次运行并勾选 `verify_oidc`。该任务复用锁定版本 VSCE 的官方 OIDC 实现，只验证 GitHub 令牌到 Marketplace 短期凭证的交换；不上传插件，不写入或打印凭证。通过它可以确认一次性绑定是否生效，而不用创建测试版本。

本地也可运行：

```bash
bash scripts/setup.sh
bash scripts/release/check.sh
bash scripts/test.sh
bash scripts/package.sh
PUBLISH_DRY_RUN=true bash scripts/release/publish.sh
```

脚本统一写入 `logs/`，没有打印原始凭证的调试开关。构建产物、认证信息和运行日志不会进入源码仓库或 VSIX。

## 工具版本和验证边界

此项目锁定微软官方 `@vscode/vsce@4.0.1-5` 预览版。当前稳定版 4.0.0 使用较早的 OIDC 协议，预览版实现了官方仓库记录的 `7.2-preview.1` 与 `FederatedToken` 交换协议。该工具只用于构建和发布，不改变插件在服务器上的运行时依赖。

工作流构建与发布使用同一个依赖锁文件。未来升级工具时应先通过手动预检，再创建新版本。

本地预检或 GitHub 手动预检通过，只证明构建和打包正常。只有完成 Marketplace 端的可信策略，并成功执行一次正式发布任务后，才能确认 OIDC 端到端发布已验证。

## 参考

- [微软 VSCE 可信发布说明](https://github.com/microsoft/vscode-vsce#trusted-publishing)
- [GitHub Release 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)
