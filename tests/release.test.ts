import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';

/** 加载实际发布脚本中的校验器，测试运行目录由 scripts/common.sh 固定。 */
const { releaseMetadata, validateLock, publishAllowed, verifyChecksum } = require(path.resolve('scripts/release/metadata.cjs'));
/** 使用虚拟的未来版本验证构建脚本不再固定输出到旧版本。 */
const manifest = { name: 'vscode-codex-speed', publisher: 'NO00', version: '1.2.3' };

test('正式发布校验精确标签，并为未来版本生成正确安装包路径', () => {
  const result = releaseMetadata(manifest, { GITHUB_EVENT_NAME: 'release', RELEASE_TAG: 'v1.2.3', RELEASE_IS_PRERELEASE: 'false' });
  assert.equal(result.vsix_path, 'artifacts/vscode-codex-speed-1.2.3.vsix');
  assert.equal(result.checksum_path, 'artifacts/vscode-codex-speed-1.2.3.vsix.sha256');
});

test('版本不一致、缺少标签、异常版本或不同发布者必须阻止发布', () => {
  assert.throws(() => releaseMetadata(manifest, { GITHUB_EVENT_NAME: 'release', RELEASE_TAG: 'v1.2.4' }), /完全一致/);
  assert.throws(() => releaseMetadata(manifest, { GITHUB_EVENT_NAME: 'release' }), /完全一致/);
  assert.throws(() => releaseMetadata({ ...manifest, version: '1.2.3/../../other' }, {}), /三段版本号/);
  assert.throws(() => releaseMetadata({ ...manifest, publisher: 'other' }, {}), /NO00/);
});

test('手动预检可以构建当前版本，在线发布只允许正式 Release 事件', () => {
  assert.equal(releaseMetadata(manifest, { GITHUB_EVENT_NAME: 'workflow_dispatch' }).version, '1.2.3');
  assert.equal(publishAllowed({ GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_IS_PRERELEASE: 'false' }), false);
  assert.equal(publishAllowed({ GITHUB_EVENT_NAME: 'release', RELEASE_IS_PRERELEASE: 'true' }), false);
  assert.equal(publishAllowed({ GITHUB_EVENT_NAME: 'release', RELEASE_IS_PRERELEASE: 'false' }), true);
  assert.throws(() => releaseMetadata(manifest, { RELEASE_IS_PRERELEASE: 'true' }), /预发布版本/);
});

test('锁文件根版本或清单版本不匹配时拒绝继续', () => {
  const lock = { name: manifest.name, version: manifest.version, packages: { '': { version: manifest.version } } };
  assert.doesNotThrow(() => validateLock(manifest, lock));
  assert.throws(() => validateLock(manifest, { ...lock, version: '1.2.2' }), /锁文件版本/);
  assert.throws(() => validateLock(manifest, { ...lock, packages: { '': { version: '1.2.2' } } }), /根包版本/);
});

test('安装包内容、校验文件格式或文件名改变时不能在线发布', () => {
  const content = Buffer.from('synthetic-vsix');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const checksum = `${hash}  extension.vsix\n`;
  assert.doesNotThrow(() => verifyChecksum(content, checksum, 'extension.vsix'));
  assert.throws(() => verifyChecksum(Buffer.from('changed'), checksum, 'extension.vsix'), /校验失败/);
  assert.throws(() => verifyChecksum(content, checksum, 'other.vsix'), /其他安装包/);
  assert.throws(() => verifyChecksum(content, 'not-a-checksum', 'extension.vsix'), /格式错误/);
});
