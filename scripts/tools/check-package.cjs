const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const yauzl = require('yauzl');

/** 验证实际 VSIX 的部署声明、入口和文件清单，避免把测试与依赖打进包。 */
async function main() {
  const file = 'artifacts/vscode-codex-speed-0.1.0.vsix';
  const entries = new Map();
  await new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', entry => {
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
  const manifest = JSON.parse(entries.get('extension/package.json').toString());
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.ok(entries.has(`extension/${manifest.main.replace(/^\.\//, '')}`));
  assert.ok(entries.has('extension/readme.md'));
  assert.ok(entries.has('extension/LICENSE.txt'));
  assert.ok([...entries.keys()].every(file => !file.includes('/tests/') && !file.includes('/node_modules/') && !file.includes('/logs/')));
  assert.ok([...entries.values()].every(content => !content.includes('CODEX_SPEED_TEST_HOME')));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha256}  vscode-codex-speed-0.1.0.vsix\n`);
  console.log(`VSIX 验证通过：${entries.size} 个文件，远程 workspace 扩展，入口完整，无测试或运行依赖。`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
