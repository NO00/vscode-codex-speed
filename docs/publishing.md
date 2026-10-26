# GitHub Release 自动生成安装包

## 当前配置

根据用户选择，当前仅自动构建 GitHub Release 安装包，没有配置 Marketplace 认证，也不会自动向插件市场发布。无需设置 PAT、OIDC 策略或其他发布凭证。

工作流位于 `.github/workflows/publish.yml`，在 Actions 中显示为 **构建 Release 安装包**。

正式发布 GitHub Release 后，GitHub Actions 会：

1. 检出 Release 标签指向的源码，确认标签与 `package.json`、`package-lock.json` 中的版本完全一致。
2. 使用 Node.js 22 安装锁定依赖并运行测试。
3. 构建 VSIX，验证版本、发布者、路径、图标和双语市场介绍。
4. 生成 SHA-256 校验文件，核对产物与校验文件一致。
5. 将 VSIX 与校验文件自动附加到该 GitHub Release，同时保存一份 Actions 构建产物。同名 Release 附件以本次构建结果为准。

工作流仅使用 GitHub 自带的 `GITHUB_TOKEN` 更新本仓库附件，没有 Marketplace 发布步骤，也不请求 OIDC 身份令牌。

## 以后创建新版本

例如发布 0.1.3：

1. 将 `package.json` 的 `version` 改为 `0.1.3`，同步 `package-lock.json` 顶层和根包版本，提交推送。
2. 在 GitHub 创建指向该提交的正式 Release，标签填写 `v0.1.3`。
3. 点击 **Publish release**。无需手动构建或附加 VSIX。
4. 在 **Actions → 构建 Release 安装包** 查看结果。运行完成后，Release 附件中会出现 `vscode-codex-speed-0.1.3.vsix` 和对应 `.sha256` 文件。
5. 下载 VSIX，在 Marketplace 的现有扩展页面手动上传该新版本。

必须使用包含此工作流的新提交创建标签。旧标签（例如最初发布的 v0.1.2）指向的源码不含工作流，不能仅重新发布旧 Release 来补上自动化。

草稿 Release 不触发工作流；标记为预发布的 Release 会跳过。正式标签必须形如 `v0.1.3`，且与清单中的稳定三段版本完全一致。版本或锁文件不匹配会在构建前失败。

## 手动预检

从仓库 Actions 页面选择 **构建 Release 安装包**，点击 **Run workflow**，选择 `main`。

手动运行会测试、构建和保存 Actions 产物，但不创建 Release、不更新现有 Release 附件，也不向 Marketplace 上传。可以用它在正式创建 Release 前试装 VSIX。

本地对应入口：

```bash
bash scripts/setup.sh
bash scripts/release/check.sh
bash scripts/test.sh
bash scripts/package.sh
```

所有脚本统一输出至 `logs/`。工作流及测试代码、依赖、日志和临时文件不会被打入 VSIX。

## 权限与后续扩展

构建任务的 `contents: write` 仅用于更新 GitHub Release 附件；仓库检出不保存 Git 推送凭证。没有市场发布认证，不涉及保存用户的 Token。

未来若要启用市场自动发布，需要另外选择并配置 Marketplace 支持的认证方式。当前没有可用的原生可信策略入口，因此没有将原生 OIDC 当作已启用功能。

## 参考

- [GitHub Release 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)
- [微软插件发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
