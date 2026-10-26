const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const yauzl = require('yauzl');

/** 验证实际 VSIX 的部署声明、入口和文件清单，避免把测试与依赖打进包。 */
async function main() {
  const file = process.argv[2] || 'artifacts/vscode-codex-speed-0.1.1.vsix';
  const entries = new Map();
  await new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        if (entries.has(entry.fileName)) { zip.close(); return reject(new Error(`VSIX 存在重复文件：${entry.fileName}`)); }
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
  // 某些上传端会将非 ASCII 路径退化为问号；先复现重名，再拒绝此类路径。
  const degraded = new Map();
  for (const name of entries.keys()) {
    const key = Buffer.from(name, 'utf8').map(byte => byte > 127 ? 63 : byte).toString('ascii').toLowerCase();
    assert.ok(!degraded.has(key), `安装包路径编码退化后重名：${degraded.get(key)} 与 ${name} → ${key}`);
    degraded.set(key, name);
  }
  assert.ok([...entries.keys()].every(name => /^[\x20-\x7e]+$/.test(name)), 'VSIX 内部路径必须使用 ASCII 字符，避免市场上传端的编码兼容问题');
  const manifest = JSON.parse(entries.get('extension/package.json').toString());
  const sourceManifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(manifest.name, sourceManifest.name);
  assert.equal(manifest.version, sourceManifest.version);
  assert.equal(manifest.publisher, 'NO00', '安装包必须使用实际的 Marketplace Publisher ID');
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.ok(entries.has(`extension/${manifest.main.replace(/^\.\//, '')}`));
  assert.ok(entries.has('extension/readme.md'));
  assert.ok(entries.has('extension/docs/README.en.md'));
  assert.ok(entries.has('extension/LICENSE.txt'));
  assert.ok([...entries.keys()].every(file => !file.includes('/tests/') && !file.includes('/node_modules/') && !file.includes('/logs/')));
  assert.ok([...entries.values()].every(content => !content.includes('CODEX_SPEED_TEST_HOME')));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${sourceManifest.name}-${sourceManifest.version}.vsix\n`);
  console.log(`VSIX 验证通过：${entries.size} 个文件，Publisher=${manifest.publisher}，版本=${manifest.version}，路径全部为 ASCII 且无重名，入口和中英文说明完整。`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
