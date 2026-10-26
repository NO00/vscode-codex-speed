const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

/** 将指定的已安装官方语言包复制到测试目录，仅为独立窗口生成语言索引。 */
async function prepareLanguagePack(source, locale, user, extensions) {
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const localization = manifest.contributes?.localizations?.find(item => item.languageId === locale);
  if (!localization) throw new Error(`指定语言包不支持 ${locale}`);
  const id = `${manifest.publisher}.${manifest.name}`;
  const destination = path.join(extensions, `${id}-${manifest.version}`);
  await fs.cp(source, destination, { recursive: true });
  const translations = Object.fromEntries(localization.translations.map(item => [item.id, path.resolve(destination, item.path)]));
  const pack = {
    hash: crypto.createHash('sha256').update(`${id}@${manifest.version}`).digest('hex'),
    extensions: [{ extensionIdentifier: { id }, version: manifest.version }], translations
  };
  await fs.writeFile(path.join(user, 'languagepacks.json'), JSON.stringify({ [locale]: pack }));
}

/** 以独立配置启动实际 VS Code 扩展宿主，不接触用户现有设置或扩展。 */
async function main() {
  // 未指定已安装版本时，下载最低支持版本的独立测试副本。
  const executable = process.argv[2] === '--copy-installed'
    ? await require('./prepare-host.cjs')(process.argv[3])
    : process.argv[2] || process.env.VSCODE_EXECUTABLE || await require('@vscode/test-electron').downloadAndUnzipVSCode('1.90.2');
  // 仅改变独立测试窗口的客户端语言，不修改用户的 VS Code 设置。
  const locale = process.env.CODEX_SPEED_TEST_LOCALE || 'en';
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-speed-host-'));
  const user = path.join(temp, 'user');
  const home = path.join(temp, 'codex');
  const workspace = path.join(temp, 'workspace');
  await fs.mkdir(path.join(user, 'User'), { recursive: true });
  await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(user, 'User', 'settings.json'), JSON.stringify({
    'codexSpeed.codexHome': home,
    'codexSpeed.pollIntervalMs': 500,
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off',
    'security.workspace.trust.enabled': false
  }));
  const env = { ...process.env, CODEX_SPEED_TEST_HOME: home, CODEX_SPEED_TEST_REPORT: path.join(temp, 'report.json') };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VSCODE_') || key.startsWith('ELECTRON_')) delete env[key];
  }
  // 非英文客户端测试必须提供真实语言包，否则 VS Code 本身会回退到英文。
  if (locale !== 'en' && process.env.CODEX_SPEED_TEST_LANGUAGE_PACK) {
    await prepareLanguagePack(process.env.CODEX_SPEED_TEST_LANGUAGE_PACK, locale, user, path.join(temp, 'extensions'));
  }
  const args = [workspace, '--locale', locale, '--user-data-dir', user, '--extensions-dir', path.join(temp, 'extensions'), '--extensionDevelopmentPath', process.cwd(), '--extensionTestsPath', path.join(process.cwd(), 'dist/tests/host/index.js'), '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--no-sandbox'];
  console.log(`启动独立 VS Code 扩展宿主进行回放测试，客户端语言：${locale}。`);
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { void fs.appendFile(path.join(temp, 'launcher.log'), chunk); });
  child.stderr.on('data', chunk => { void fs.appendFile(path.join(temp, 'launcher.log'), chunk); });
  let timeout;
  try {
    const report = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', async code => {
        console.log(`测试宿主退出码：${code}`);
        try {
          const result = JSON.parse(await fs.readFile(env.CODEX_SPEED_TEST_REPORT, 'utf8'));
          if (!result.ok) reject(new Error(result.error));
          else if (code !== 0) reject(new Error(`宿主退出码 ${code}`));
          else resolve(result);
        } catch (error) { reject(error); }
      });
      timeout = setTimeout(() => { child.kill(); reject(new Error('扩展宿主测试超时（90 秒）')); }, 90000);
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    clearTimeout(timeout);
    // 只清理由本次 mkdtemp 创建的绝对路径；失败时保留诊断文件。
    console.log(`独立测试资料：${temp}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
