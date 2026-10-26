const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseMetadata, validateLock, validateTagPush, verifyChecksum } = require('./metadata.cjs');

/** 同步工具接口使用参数数组，不把仓库名、标签或文件名拼接成 shell 命令。 */
function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { const error = new Error(`${command} 执行失败：${result.stderr.trim()}`); error.status = result.status; throw error; }
  return result.stdout;
}

/** 远程标签必须仍指向当前构建提交；支持附注标签，并限制嵌套解析次数。 */
function verifyTag(options, call) {
  let object = JSON.parse(call(['api', `repos/${options.repo}/git/ref/tags/${options.tag}`])).object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) object = JSON.parse(call(['api', `repos/${options.repo}/git/tags/${object.sha}`])).object;
  assert.equal(object?.type, 'commit', '远程标签未解析为提交');
  assert.equal(object.sha, options.commit, '远程标签已移动，停止发布与构建源码不一致的安装包');
}

/** 草稿上传失败时保持草稿；正式版本验证原附件后复用，不覆盖已发布或不可变资产。 */
function publishRelease(options, call, verifyAssets) {
  assert.match(options.repo, /^[\w.-]+\/[\w.-]+$/, '仓库身份格式错误');
  assert.match(options.tag, /^v\d+\.\d+\.\d+$/, '仅允许稳定版本标签');
  assert.match(options.commit, /^[a-f0-9]{40,64}$/, '构建提交格式错误');
  verifyTag(options, call);
  let release;
  try { release = JSON.parse(call(['api', `repos/${options.repo}/releases/tags/${options.tag}`])); }
  catch (error) { if (!/HTTP 404\b/.test(error.message)) throw error; }
  if (release) {
    assert.equal(release.tag_name, options.tag, '返回了其他标签的 Release');
    assert.equal(typeof release.draft, 'boolean', 'Release 状态无效');
    if (!release.draft) {
      assert.equal(release.prerelease, false, '已存在预发布 Release，请先人工处理该版本');
      const assets = new Set((release.assets ?? []).map(asset => asset.name));
      assert.ok(assets.has(options.basename) && assets.has(`${options.basename}.sha256`), '已发布 Release 附件不完整；请人工处理，自动流程不会覆盖正式版本');
      verifyAssets(); return 'existing';
    }
  } else {
    call(['release', 'create', options.tag, '--repo', options.repo, '--draft', '--verify-tag', '--title', options.tag, '--generate-notes']);
  }
  call(['release', 'upload', options.tag, options.vsix_path, options.checksum_path, '--repo', options.repo, '--clobber']);
  verifyAssets();
  verifyTag(options, call);
  call(['release', 'edit', options.tag, '--repo', options.repo, '--draft=false', '--prerelease=false']);
  return 'published';
}

/** 核对远程实际附件的哈希、版本及包内容，再允许将草稿转为正式版本。 */
function verifyRemoteAssets(options, call) {
  const root = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'codex-speed-release-'));
  try {
    call(['release', 'download', options.tag, '--repo', options.repo, '--dir', directory, '--pattern', options.basename, '--pattern', `${options.basename}.sha256`]);
    const vsix = path.join(directory, options.basename);
    verifyChecksum(fs.readFileSync(vsix), fs.readFileSync(`${vsix}.sha256`, 'utf8'), options.basename);
    execute(process.execPath, ['scripts/tools/check-package.cjs', vsix]);
  } finally {
    // 只删除本次创建且直接位于系统临时目录下的确切路径。
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('codex-speed-release-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** 真正写入前再次验证事件、清单、锁文件与校验值，防止手动运行误发布。 */
function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  validateLock(manifest, JSON.parse(fs.readFileSync('package-lock.json', 'utf8')));
  validateTagPush(manifest);
  const metadata = releaseMetadata(manifest);
  verifyChecksum(fs.readFileSync(metadata.vsix_path), fs.readFileSync(metadata.checksum_path, 'utf8'), metadata.basename);
  const options = { ...metadata, repo: process.env.GITHUB_REPOSITORY, tag: process.env.RELEASE_TAG, commit: execute('git', ['rev-parse', 'HEAD']).trim() };
  const call = args => execute('gh', args);
  const outcome = publishRelease(options, call, () => verifyRemoteAssets(options, call));
  console.log(outcome === 'existing' ? '正式 Release 及已有附件校验通过，未覆盖安装包。' : 'Release 已正式发布，VSIX 与 SHA-256 附件已验证。');
}

module.exports = { publishRelease, verifyTag };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
