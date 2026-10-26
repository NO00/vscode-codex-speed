const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

/** 根据固定插件身份生成安全的构建路径，并拒绝标签与版本不一致的发布。 */
function releaseMetadata(manifest, environment = process.env) {
  assert.equal(manifest.name, 'vscode-codex-speed', '插件名称不匹配');
  assert.equal(manifest.publisher, 'NO00', 'Publisher 必须为 NO00');
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, '正式发布必须使用稳定的三段版本号');
  const tag = environment.RELEASE_TAG || '';
  if (environment.GITHUB_EVENT_NAME === 'release' || tag) {
    assert.equal(tag, `v${manifest.version}`, 'Release 标签必须与 package.json 完全一致，例如 v0.1.3');
  }
  assert.notEqual(environment.RELEASE_IS_PRERELEASE, 'true', '此工作流仅发布正式版本，预发布版本会跳过');
  const basename = `${manifest.name}-${manifest.version}.vsix`;
  return {
    version: manifest.version,
    basename,
    vsix_path: `artifacts/${basename}`,
    checksum_path: `artifacts/${basename}.sha256`,
    artifact_name: `${manifest.name}-${manifest.version}`
  };
}

/** 安装依赖前也能检查锁文件与清单，避免打包到另一个版本。 */
function validateLock(manifest, lock) {
  assert.equal(lock.name, manifest.name, '锁文件插件名称不一致');
  assert.equal(lock.version, manifest.version, '锁文件版本不一致');
  assert.equal(lock.packages?.['']?.version, manifest.version, '锁文件根包版本不一致');
}

/** 下载后先核对原有校验文件，避免在重新校验时覆盖并掩盖损坏的哈希。 */
function verifyChecksum(content, checksum, basename) {
  const match = /^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(checksum);
  assert.ok(match, 'SHA-256 校验文件格式错误');
  assert.equal(match[2], basename, '校验文件指向了其他安装包');
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'), match[1].toLowerCase(), 'VSIX 的 SHA-256 校验失败');
}

/** 将已校验元数据输出给 Bash 或 GitHub Actions，不输出任何认证信息。 */
function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  validateLock(manifest, lock);
  const metadata = releaseMetadata(manifest);
  if (process.argv[2] === '--verify-checksum') {
    verifyChecksum(fs.readFileSync(metadata.vsix_path), fs.readFileSync(metadata.checksum_path, 'utf8'), metadata.basename);
    console.log('下载的 VSIX 与原 SHA-256 校验文件一致');
  } else if (process.argv[2] === '--field') {
    const field = process.argv[3];
    assert.ok(Object.hasOwn(metadata, field), '未知的发布元数据字段');
    process.stdout.write(metadata[field]);
  } else {
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
    console.log(`版本校验通过：${metadata.version}，产物 ${metadata.vsix_path}`);
  }
}

module.exports = { releaseMetadata, validateLock, verifyChecksum };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
