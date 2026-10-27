const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const yauzl = require('yauzl');

/** 验证实际 VSIX 的部署声明、入口和文件清单，避免把测试与依赖打进包。 */
async function main() {
  const sourceManifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const file = process.argv[2] || `artifacts/${sourceManifest.name}-${sourceManifest.version}.vsix`;
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
  assert.equal(manifest.name, sourceManifest.name);
  assert.equal(manifest.version, sourceManifest.version);
  assert.equal(manifest.publisher, 'NO00', '安装包必须使用实际的 Marketplace Publisher ID');
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.ok(entries.has(`extension/${manifest.main.replace(/^\.\//, '')}`));
  assert.ok(entries.has('extension/readme.md'));
  const readme = entries.get('extension/readme.md').toString('utf8');
  assert.ok(readme.includes('## 简体中文') && readme.includes('## English'), '市场首页必须同时包含中英文用户说明');
  assert.equal(manifest.icon, 'assets/icon.png', '必须配置独立的插件图标');
  const icon = entries.get(`extension/${manifest.icon}`);
  assert.ok(icon && icon.length >= 24, '安装包必须包含图标文件');
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '插件图标必须为有效 PNG');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128, '图标尺寸不能小于 128×128');
  assert.ok(entries.get('extension.vsixmanifest').toString('utf8').includes('Microsoft.VisualStudio.Services.Icons.Default'), '市场清单必须包含插件图标资源');
  assert.ok(entries.has('extension/LICENSE.txt'));
  assert.equal(manifest.l10n, './l10n', '必须声明运行时翻译目录');
  for (const file of ['assets/dashboard/dashboard.css', 'assets/dashboard/dashboard.js', 'dist/src/dashboard/model.js', 'dist/src/dashboard/html.js', 'dist/src/dashboard/messages.js', 'dist/src/dashboard/panel.js', 'dist/src/history/index.js', 'dist/src/history/cache.js', 'dist/src/history/reader.js', 'dist/src/history/ranges.js', 'dist/src/cost/catalog.js', 'dist/src/cost/estimate.js', 'dist/src/cost/usage.js']) {
    assert.ok(entries.has(`extension/${file}`), `仪表盘资源缺失：${file}`);
  }
  assert.ok(manifest.contributes.commands.some(command => command.command === 'codexSpeed.openDashboard'), '必须声明仪表盘命令');
  // 检查最终包中的语言资源，避免本地可用但发布时被忽略。
  const keys = [...JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)].map(match => match[1]);
  for (const suffix of ['', '.zh-cn', '.zh-tw']) {
    const bundle = JSON.parse(entries.get(`extension/package.nls${suffix}.json`).toString('utf8'));
    for (const key of keys) assert.ok(bundle[key], `清单翻译缺失：${suffix} ${key}`);
  }
  for (const locale of ['zh-cn', 'zh-tw']) {
    const bundle = JSON.parse(entries.get(`extension/l10n/bundle.l10n.${locale}.json`).toString('utf8'));
    assert.ok(bundle.Last && bundle['Read error'], `运行时翻译缺失：${locale}`);
  }
  assert.ok([...entries.keys()].every(file => !file.includes('/tests/') && !file.includes('/node_modules/') && !file.includes('/logs/')));
  assert.ok([...entries.values()].every(content => !content.includes('CODEX_SPEED_TEST_HOME')));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${sourceManifest.name}-${sourceManifest.version}.vsix\n`);
  console.log(`VSIX 验证通过：${entries.size} 个文件，Publisher=${manifest.publisher}，版本=${manifest.version}，路径全部为 ASCII 且无重名，入口、PNG 图标、中英文市场首页及界面翻译完整。`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
