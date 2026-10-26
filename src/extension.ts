import * as vscode from 'vscode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { FileLogger } from './logger';
import { CodexMonitor, errorCode, MonitorState } from './monitor';
import { measured, sampleRate } from './engine';
import { MonitorOptions } from './types';
import { createTranslator, resolveLanguage, Translate } from './localization';

/** 使用客户端显示语言；Remote SSH 宿主不读取服务器系统语言。 */
let translate: Translate = vscode.l10n.t;
/** 监控层持有稳定入口，语言切换后仍能使用最新词条。 */
const t: Translate = (message, ...args) => translate(message, ...args);
/** 数字分组也跟随当前界面语言，不使用服务器操作系统的区域设置。 */
let uiLanguage = vscode.env.language;

/** 从实际扩展宿主环境解析路径；Remote SSH 下 os.homedir() 就是服务器用户。 */
export function resolveHome(configured: string, environment = process.env, home = os.homedir()): string {
  const raw = configured.trim() || environment.CODEX_HOME || path.join(home, '.codex');
  if (raw === '~') return home;
  if (/^~[\\/]/.test(raw)) return path.resolve(home, raw.slice(2));
  // 不依赖启动 VS Code Server 时的 cwd 解析相对配置路径。
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(home, raw);
}

/** 读取机器级配置，工作区项目无法偷偷替换 Codex 日志目录。 */
function readOptions(): MonitorOptions {
  const config = vscode.workspace.getConfiguration('codexSpeed');
  return {
    home: resolveHome(config.get<string>('codexHome', '')),
    scanDays: Math.max(1, Math.min(30, config.get<number>('scanDays', 3))),
    pollIntervalMs: Math.max(500, Math.min(10000, config.get<number>('pollIntervalMs', 1000))),
    scope: config.get<'all' | 'workspace'>('scope', 'all'),
    workspaces: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
    showEstimates: config.get<boolean>('showEstimates', true)
  };
}

/** 将计算结果映射为状态栏文字，明确区分实测、估算、等待和上次速度。 */
export function statusText(state: MonitorState): string {
  if (state.error) return `$(warning) Codex ${t('Logs')}`;
  const s = state.snapshot;
  if (s.sessions === 0) return '$(pulse) Codex -- tok/s';
  const number = s.rate.toFixed(1);
  const suffix = s.active > 1 ? ` · ${t('{0} agents', s.active)}` : '';
  const limit = state.limited ? ` · ${t('Partial')}` : '';
  if (s.kind === 'estimated') return `$(pulse) Codex ~${number} tok/s${suffix}${limit}`;
  if (s.kind === 'waiting') return `$(pulse) Codex -- tok/s · ${t('Waiting for counts')}${suffix}${limit}`;
  if (s.kind === 'last') return `$(pulse) Codex ${number} tok/s · ${t('Last')}${limit}`;
  if (s.kind === 'tools') return `$(tools) Codex 0.0 tok/s · ${t('Tools')}${limit}`;
  return `$(pulse) Codex ${number} tok/s${suffix}${limit}`;
}

/** 构造纯文本内容的 Markdown tooltip，日志中的模型和路径不会被当成命令执行。 */
export function tooltip(state: MonitorState, options: MonitorOptions, host: string): vscode.MarkdownString {
  const tip = new vscode.MarkdownString();
  tip.appendMarkdown('### VSCode Codex Speed\n\n');
  tip.appendText(t('Host: {0}\nDirectory: {1}\nScope: {2}\n', host, options.home, options.scope === 'all' ? t('All recent sessions on this host') : t('Current workspace')));
  const s = state.snapshot;
  const source = {
    measured: t('Measured over a three-second window'), estimated: t('Includes estimates from previous rates (~)'),
    last: t('Last completed call, not the current rate'), waiting: t('Generating, waiting for token counts'),
    tools: t('Waiting for tool results'), idle: t('Idle')
  }[s.kind];
  tip.appendText(t('\nOutput speed: {0} token/s\nSource: {1}\nSessions: {2}, generating: {3}\nLast 30 minutes: {4} output tokens / {5} responses\n', s.rate.toFixed(1), source, s.sessions, s.active, s.output.toLocaleString(uiLanguage), s.responses));
  if (s.latest && measured(s.latest)) tip.appendText(t('\nLatest model: {0}\nLatest call: {1} tok/s, {2} output tokens, {3} seconds\n', s.latest.model, sampleRate(s.latest).toFixed(1), s.latest.output, ((s.latest.end - s.latest.start) / 1000).toFixed(2)));
  if (state.notice) tip.appendText(`\n${state.notice}\n`);
  if (state.limited) tip.appendText(t('\nScan limit reached. Only some sessions are shown.\n'));
  tip.appendText(t('\nOutput includes reasoning; duration includes time to first token. Values marked ~ during generation are estimates; logs do not provide live per-token counts.\nClick for details and actions.'));
  return tip;
}

/** 装配监控、状态栏、命令和资源清理；不创建终端或修改 Codex 配置。 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('VSCode Codex Speed');
  const logger = new FileLogger(path.join(context.logUri.fsPath, 'logs'), message => output.appendLine(message));
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.name = 'VSCode Codex Speed';
  bar.command = 'codexSpeed.showDetails';
  let monitor: CodexMonitor | undefined;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;
  const host = `${vscode.env.remoteName ?? 'local'} / ${os.hostname()}`;
  let state: MonitorState | undefined;
  let options = readOptions();

  /** 自动模式使用 VS Code 原生翻译；手动模式仅在设置变化时读取内置资源。 */
  function configureLanguage(): void {
    const selected = vscode.workspace.getConfiguration('codexSpeed').get<string>('language', 'auto');
    uiLanguage = resolveLanguage(selected, vscode.env.language);
    translate = selected === 'auto' ? vscode.l10n.t : createTranslator(uiLanguage, locale => JSON.parse(fs.readFileSync(context.asAbsolutePath(`l10n/bundle.l10n.${locale}.json`), 'utf8')));
  }

  /** 刷新失败时仍保持状态栏可诊断；配置更换后丢弃旧实例结果。 */
  async function render(force = false): Promise<void> {
    const current = monitor;
    if (!current || disposed) return;
    try {
      const result = await current.tick(force);
      if (monitor !== current || disposed) return;
      state = result;
      bar.text = statusText(result);
      bar.tooltip = tooltip(result, options, host);
      bar.backgroundColor = result.error ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      bar.accessibilityInformation = { label: bar.text.replace(/\$\([^)]+\)/g, '') };
    } catch (error) {
      logger.write(t('Refresh failed: {0}', errorCode(error)));
      bar.text = `$(warning) Codex ${t('Read error')}`;
      bar.tooltip = t('Click to view diagnostic logs or check the Codex Home setting.');
    }
  }

  /** 切换配置时完整替换状态机和计时器，避免重复轮询及旧目录状态残留。 */
  function restart(): void {
    if (timer) clearInterval(timer);
    monitor?.dispose();
    monitor = undefined;
    state = undefined;
    options = readOptions();
    if (!vscode.workspace.getConfiguration('codexSpeed').get<boolean>('enabled', true)) { bar.hide(); return; }
    monitor = new CodexMonitor(options, message => logger.write(message), Date.now, t);
    logger.write(t('Monitoring started: {0}; Codex Home={1}; scope={2}', host, options.home, options.scope));
    bar.text = `$(sync~spin) Codex ${t('Scanning')}`;
    bar.tooltip = t('Reading session logs under {0}', options.home);
    bar.show();
    void render(true);
    timer = setInterval(() => { void render(); }, options.pollIntervalMs);
  }

  context.subscriptions.push(output, bar,
    // 只返回计数及运行状态，供诊断和真实扩展宿主回放使用。
    vscode.commands.registerCommand('codexSpeed.getDiagnostics', () => ({ state, text: bar.text, home: options.home, remote: vscode.env.remoteName ?? 'local' })),
    vscode.commands.registerCommand('codexSpeed.showLogs', () => output.show()),
    vscode.commands.registerCommand('codexSpeed.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:NO00.vscode-codex-speed')),
    vscode.commands.registerCommand('codexSpeed.refresh', () => render(true)),
    vscode.commands.registerCommand('codexSpeed.showDetails', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: `$(output) ${t('Show speed details')}`, description: state ? t('{0} tok/s · {1} sessions', state.snapshot.rate.toFixed(1), state.snapshot.sessions) : t('Waiting for scan'), action: 'details' },
        { label: `$(refresh) ${t('Rescan logs')}`, action: 'refresh' },
        { label: `$(settings-gear) ${t('Configure log directory and scope')}`, action: 'settings' }
      ], { title: `VSCode Codex Speed · ${host}` });
      if (choice?.action === 'refresh') await render(true);
      if (choice?.action === 'settings') await vscode.commands.executeCommand('codexSpeed.openSettings');
      if (choice?.action === 'details') {
        if (state) output.appendLine(tooltip(state, options, host).value);
        output.appendLine(t('Diagnostic log file: {0}', logger.file));
        output.show();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('codexSpeed')) return;
      if (event.affectsConfiguration('codexSpeed.language')) configureLanguage();
      // 只切换语言时保留监控状态，强制刷新目录提示，无需重新扫描会话内容。
      if (['enabled', 'codexHome', 'scope', 'pollIntervalMs', 'scanDays', 'showEstimates'].some(key => event.affectsConfiguration(`codexSpeed.${key}`))) restart();
      else void render(true);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(restart),
    { dispose: () => { disposed = true; if (timer) clearInterval(timer); monitor?.dispose(); void logger.flush(); } }
  );
  configureLanguage();
  restart();
}
