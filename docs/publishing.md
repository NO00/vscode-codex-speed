# 推送标签后自动发布 GitHub Release

## 当前流程

推送稳定版本标签后自动执行：**测试 → 构建 VSIX → 创建 Release 草稿 → 上传并验证 VSIX 与 SHA-256 → 正式发布 Release**。

工作流位于 `.github/workflows/publish.yml`，Actions 中名称为 **构建 Release 安装包**。仅使用 GitHub 自带的 `GITHUB_TOKEN`，无需配置个人 Token 或额外 Secret。没有 Marketplace 认证或发布步骤，插件市场仍由你手动上传。

## 发布新版本

例如发布 0.1.10：

1. 将 `package.json` 的版本改为 `0.1.10`，同步 `package-lock.json` 顶层和根包版本，提交推送。
2. 在包含当前工作流的该提交上创建标签并推送：

```bash
git tag -a v0.1.10 -m "发布 v0.1.10"
git push origin v0.1.10
```

3. 在 **Actions → 构建 Release 安装包** 查看运行结果。
4. 测试、打包及附件验证成功后，GitHub Releases 中自动出现 `v0.1.10`，包含 `vscode-codex-speed-0.1.10.vsix` 和对应 `.sha256`。
5. 下载 VSIX，在 Marketplace 的现有扩展页面手动上传新版本。

当前清单版本为 0.1.10；如要发布当前版本，可以在包含此自动化改动的提交上创建并推送新的 `v0.1.10` 标签，不需要先去 GitHub 网页创建 Release。仅在本地打标签不会触发，必须推送到远端。

版本标签必须是 `vX.Y.Z`，并与两个清单版本完全一致。预发布后缀、不一致版本、分支推送和标签删除均不能正式发布。旧标签指向的提交可能不含新工作流，不能仅靠重复推送旧标签补上自动化；也不应移动已发布标签。

## 发布与重试规则

- 检出推送标签对应的源码，先校验版本、锁文件、插件身份，之后安装锁定依赖、运行测试和打包。
- 构建产物同时保存为 Actions Artifact，保留 14 天。
- 创建 Release 前核对远程标签仍指向构建提交，支持轻量和附注标签。
- 新 Release 先作为草稿，自动生成发布说明。附件上传后重新下载，验证哈希、版本和安装包内容，再核对标签，最后转为正式 Release。
- 上传、校验或发布步骤失败时，尚未发布的 Release 保持草稿。修复后可在 Actions 中 **Re-run failed jobs** 或 **Re-run all jobs**，继续复用该草稿并补齐附件。
- 已经正式发布的 Release 只验证现有附件，完整则跳过，不覆盖正式或不可变资产。正式版缺少附件、内容不符或被标为预发布时明确失败，需要人工处理或发布新版本。
- 同一标签的运行串行执行；不同版本与手动预检互不取消。推送主分支和在网页手动发布 Release 本身不再触发此工作流。

## 手动预检

从 Actions 页面选择 **构建 Release 安装包 → Run workflow → main**。

手动运行只测试、构建和保存 Actions Artifact，不创建或更新 Release，也不上传 Marketplace。即使手动运行时选择标签，写入步骤也不会执行；脚本还会再次校验必须是标签 push 事件。

本地入口：

```bash
bash scripts/setup.sh
bash scripts/release/check.sh
bash scripts/test.sh
bash scripts/package.sh
```

所有脚本写日志至 `logs/`；工作流、测试、脚本、依赖及日志不会进入 VSIX。发布生命周期测试使用虚拟 GitHub 响应，不创建测试 Release。

## 权限

构建任务的 `contents: write` 用于创建草稿、上传附件和正式发布 GitHub Release。仓库检出不保存 Git 推送凭证。没有市场发布认证，不请求 OIDC 身份令牌，也不涉及保存用户的 Marketplace Token。

## 参考

- [GitHub 标签推送事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
- [GitHub CLI 创建 Release](https://cli.github.com/manual/gh_release_create)
- [GitHub CLI 发布草稿](https://cli.github.com/manual/gh_release_edit)
