const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

/** 以独立配置启动实际 VS Code 扩展宿主，不接触用户现有设置或扩展。 */
async function main() {
  // 未指定已安装版本时，下载最低支持版本的独立测试副本。
  const executable = process.argv[2] === '--copy-installed'
    ? await require('./prepare-host.cjs')(process.argv[3])
    : process.argv[2] || process.env.VSCODE_EXECUTABLE || await require('@vscode/test-electron').downloadAndUnzipVSCode('1.90.2');
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
  const args = [workspace, '--user-data-dir', user, '--extensions-dir', path.join(temp, 'extensions'), '--extensionDevelopmentPath', process.cwd(), '--extensionTestsPath', path.join(process.cwd(), 'dist/tests/host/index.js'), '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--no-sandbox'];
  console.log('启动独立 VS Code 扩展宿主进行回放测试。');
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
