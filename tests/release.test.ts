import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';

/** 加载实际发布脚本中的校验器，测试运行目录由 scripts/common.sh 固定。 */
const { releaseMetadata, validateLock, verifyChecksum, validateTagPush } = require(path.resolve('scripts/release/metadata.cjs'));
const { publishRelease, verifyTag } = require(path.resolve('scripts/release/github.cjs'));
/** 使用虚拟的未来版本验证构建脚本不再固定输出到旧版本。 */
const manifest = { name: 'vscode-codex-speed', publisher: 'NO00', version: '1.2.3' };
/** 模拟真实 GitHub 标签推送，避免测试只填写 RELEASE_TAG 而漏检事件来源。 */
const tagEvent = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF: 'refs/tags/v1.2.3', RELEASE_TAG: 'v1.2.3', RELEASE_DELETED: 'false' };

test('正式发布校验精确标签，并为未来版本生成正确安装包路径', () => {
  const result = releaseMetadata(manifest, tagEvent);
  assert.equal(result.vsix_path, 'artifacts/vscode-codex-speed-1.2.3.vsix');
  assert.equal(result.checksum_path, 'artifacts/vscode-codex-speed-1.2.3.vsix.sha256');
});

test('版本不一致、缺少标签、异常版本或不同发布者必须阻止发布', () => {
  assert.throws(() => releaseMetadata(manifest, { ...tagEvent, RELEASE_TAG: 'v1.2.4' }), /完全一致/);
  assert.throws(() => releaseMetadata(manifest, { ...tagEvent, RELEASE_TAG: '' }), /完全一致/);
  assert.throws(() => releaseMetadata(manifest, { ...tagEvent, GITHUB_REF_TYPE: 'branch' }), /仅标签/);
  assert.throws(() => validateTagPush(manifest, { ...tagEvent, RELEASE_DELETED: 'true' }), /删除标签/);
  assert.throws(() => validateTagPush(manifest, { ...tagEvent, GITHUB_REF: 'refs/heads/v1.2.3' }), /ref/);
  assert.throws(() => releaseMetadata({ ...manifest, version: '1.2.3/../../other' }, {}), /三段版本号/);
  assert.throws(() => releaseMetadata({ ...manifest, publisher: 'other' }, {}), /NO00/);
});

test('手动预检可以构建但不能发布，预发布标签被明确拒绝', () => {
  assert.equal(releaseMetadata(manifest, { GITHUB_EVENT_NAME: 'workflow_dispatch' }).version, '1.2.3');
  assert.throws(() => validateTagPush(manifest, { ...tagEvent, GITHUB_EVENT_NAME: 'workflow_dispatch' }), /仅标签 push/);
  assert.throws(() => validateTagPush(manifest, { ...tagEvent, GITHUB_EVENT_NAME: 'release' }), /仅标签 push/);
  assert.throws(() => releaseMetadata(manifest, { ...tagEvent, RELEASE_TAG: 'v1.2.3-beta.1' }), /完全一致/);
});

/** 发布生命周期只使用虚拟 GitHub 响应，单元测试绝不创建真实 Release。 */
const releaseOptions = { repo: 'NO00/vscode-codex-speed', tag: 'v1.2.3', commit: 'a'.repeat(40), basename: 'vscode-codex-speed-1.2.3.vsix',
  vsix_path: 'artifacts/vscode-codex-speed-1.2.3.vsix', checksum_path: 'artifacts/vscode-codex-speed-1.2.3.vsix.sha256' };

/** 记录 GitHub 操作顺序，同时区分不存在、权限失败及正常的草稿或正式版本。 */
function fakeGitHub(release?: object) {
  const calls: string[][] = [];
  const call = (args: string[]): string => {
    calls.push(args);
    if (args[0] === 'api') {
      if (args[1]!.includes('/git/ref/')) return JSON.stringify({ object: { type: 'commit', sha: releaseOptions.commit } });
      if (release) return JSON.stringify(release);
      throw new Error('gh: Not Found (HTTP 404)');
    }
    return '';
  };
  return { calls, call };
}

test('不存在或已有草稿时，上传和远程校验完成后才正式发布', () => {
  for (const release of [undefined, { tag_name: releaseOptions.tag, draft: true }]) {
    const github = fakeGitHub(release);
    const result = publishRelease(releaseOptions, github.call, () => github.calls.push(['verify-assets']));
    assert.equal(result, 'published');
    const writes = github.calls.filter(call => call[0] !== 'api');
    assert.deepEqual(writes.map(call => call[0] === 'verify-assets' ? 'verify' : call[1]), release ? ['upload', 'verify', 'edit'] : ['create', 'upload', 'verify', 'edit']);
    if (!release) { assert.ok(writes[0]!.includes('--draft')); assert.ok(writes[0]!.includes('--verify-tag')); }
    assert.ok(writes.at(-1)!.includes('--draft=false'));
  }
});

test('上传失败或附件校验失败不会将草稿发布', () => {
  for (const failure of ['upload', 'verify']) {
    const github = fakeGitHub();
    const call = (args: string[]): string => { if (args[1] === 'upload' && failure === 'upload') throw new Error('upload failed'); return github.call(args); };
    assert.throws(() => publishRelease(releaseOptions, call, () => { if (failure === 'verify') throw new Error('checksum failed'); }), /failed/);
    assert.equal(github.calls.some(call => call[1] === 'edit'), false);
  }
});

test('已正式发布或不可变的版本仅验证原附件，不覆盖资产', () => {
  const github = fakeGitHub({ tag_name: releaseOptions.tag, draft: false, prerelease: false, immutable: true,
    assets: [{ name: releaseOptions.basename }, { name: `${releaseOptions.basename}.sha256` }] });
  let verified = false;
  assert.equal(publishRelease(releaseOptions, github.call, () => { verified = true; }), 'existing');
  assert.equal(verified, true); assert.equal(github.calls.some(call => call[0] === 'release'), false);
});

test('正式版本附件不完整或被标记预发布时停止自动修改', () => {
  for (const prerelease of [false, true]) {
    const github = fakeGitHub({ tag_name: releaseOptions.tag, draft: false, prerelease, assets: [] });
    assert.throws(() => publishRelease(releaseOptions, github.call, () => {}), /不完整|预发布/);
    assert.equal(github.calls.some(call => call[0] === 'release'), false);
  }
});

test('附注标签可以解析，远程标签移动时阻止创建 Release', () => {
  let step = 0;
  assert.doesNotThrow(() => verifyTag(releaseOptions, () => JSON.stringify({ object: ++step === 1 ? { type: 'tag', sha: 'b'.repeat(40) } : { type: 'commit', sha: releaseOptions.commit } })));
  const github = fakeGitHub();
  assert.throws(() => publishRelease(releaseOptions, (args: string[]) => args[1]!.includes('/git/ref/') ? JSON.stringify({ object: { type: 'commit', sha: 'b'.repeat(40) } }) : github.call(args), () => {}), /标签已移动/);
  assert.equal(github.calls.length, 0);
});

test('上传期间标签移动时保留草稿，不发布与标签不一致的包', () => {
  const github = fakeGitHub(); let refs = 0;
  const call = (args: string[]): string => args[1]?.includes('/git/ref/') && ++refs === 2 ? JSON.stringify({ object: { type: 'commit', sha: 'b'.repeat(40) } }) : github.call(args);
  assert.throws(() => publishRelease(releaseOptions, call, () => {}), /标签已移动/);
  assert.equal(github.calls.some(call => call[1] === 'edit'), false);
});

test('读取 Release 的权限或网络失败不能误判为不存在并尝试创建', () => {
  const github = fakeGitHub();
  const call = (args: string[]): string => { if (args[1]?.includes('/releases/')) throw new Error('Forbidden (HTTP 403)'); return github.call(args); };
  assert.throws(() => publishRelease(releaseOptions, call, () => {}), /HTTP 403/);
  assert.equal(github.calls.some(call => call[0] === 'release'), false);
});

test('锁文件根版本或清单版本不匹配时拒绝继续', () => {
  const lock = { name: manifest.name, version: manifest.version, packages: { '': { version: manifest.version } } };
  assert.doesNotThrow(() => validateLock(manifest, lock));
  assert.throws(() => validateLock(manifest, { ...lock, version: '1.2.2' }), /锁文件版本/);
  assert.throws(() => validateLock(manifest, { ...lock, packages: { '': { version: '1.2.2' } } }), /根包版本/);
});

test('安装包内容、校验文件格式或文件名改变时拒绝更新 Release 附件', () => {
  const content = Buffer.from('synthetic-vsix');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const checksum = `${hash}  extension.vsix\n`;
  assert.doesNotThrow(() => verifyChecksum(content, checksum, 'extension.vsix'));
  assert.throws(() => verifyChecksum(Buffer.from('changed'), checksum, 'extension.vsix'), /校验失败/);
  assert.throws(() => verifyChecksum(content, checksum, 'other.vsix'), /其他安装包/);
  assert.throws(() => verifyChecksum(content, 'not-a-checksum', 'extension.vsix'), /格式错误/);
});
