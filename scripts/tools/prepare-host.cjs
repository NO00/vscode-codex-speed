const fs = require('node:fs/promises');
const path = require('node:path');

/** 复制已安装的测试宿主，只在副本中关闭安装器更新协调；原安装保持只读。 */
async function prepare(installed) {
  const revision = (await fs.readFile(path.join(installed, 'updating_version'), 'utf8')).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('无法识别已安装 VS Code 的版本目录');
  const versionDirectory = revision.slice(0, 10);
  const destination = path.resolve('.vscode-test', 'isolated-installed');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(path.join(installed, versionDirectory), path.join(destination, versionDirectory), { recursive: true });
  await fs.copyFile(path.join(installed, 'new_Code.exe'), path.join(destination, 'Code.exe'));
  const productFile = path.join(destination, versionDirectory, 'resources', 'app', 'product.json');
  const product = JSON.parse(await fs.readFile(productFile, 'utf8'));
  // 此副本不属于 Windows 安装器，不能参与原安装的更新互斥协调。
  product.win32VersionedUpdate = false;
  await fs.writeFile(productFile, JSON.stringify(product));
  console.log(`准备独立 VS Code ${product.version} 测试副本：${destination}`);
  return path.join(destination, 'Code.exe');
}

module.exports = prepare;
