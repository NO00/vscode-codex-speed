import * as vscode from 'vscode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { FileLogger } from './logger';
import { CodexMonitor, errorCode, MonitorState } from './monitor';
import { calculate, measured } from './engine';
import { MonitorOptions } from './types';
import { createTranslator, resolveLanguage, Translate } from './localization';
import { DashboardHistory } from './dashboard/model';
import { dashboardMessages } from './dashboard/messages';
import { DashboardPanel, DashboardPayload } from './dashboard/panel';
import { UsageIndex } from './history';
import { usageRange, validTimeZone } from './history/ranges';

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

/** 将当前计算结果映射为状态栏文字，历史调用不回填实时速度。 */
export function statusText(state: MonitorState): string {
  if (state.error) return `$(warning) Codex ${t('Logs')}`;
  const s = state.snapshot;
  if (s.sessions === 0) return '$(pulse) Codex -- tok/s';
  const number = s.rate.toFixed(1);
  const suffix = s.active > 1 ? ` · ${t('{0} agents', s.active)}` : '';
  const limit = state.limited ? ` · ${t('Partial')}` : '';
  if (s.kind === 'estimated') return `$(pulse) Codex ~${number} tok/s${suffix}${limit}`;
  if (s.kind === 'waiting') return `$(pulse) Codex -- tok/s · ${t('Waiting for counts')}${suffix}${limit}`;
  if (s.kind === 'tools') return `$(tools) Codex 0.0 tok/s · ${t('Tools')}${limit}`;
  return `$(pulse) Codex ${number} tok/s${suffix}${limit}`;
}

/** 构造纯文本内容的 Markdown tooltip，日志中的模型和路径不会被当成命令执行。 */
export function tooltip(state: MonitorState, options: MonitorOptions, host: string): vscode.MarkdownString {
  const tip = new vscode.MarkdownString();
  tip.appendMarkdown('### VSCode Codex Speed\n\n');
  const s = state.snapshot;
  const source = {
    measured: t('Measured over a three-second window'), estimated: t('Includes estimates from previous rates (~)'),
    waiting: t('Generating, waiting for token counts'),
    tools: t('Waiting for tool results'), idle: t('Idle')
  }[s.kind];
  tip.appendText(t('Output speed: {0} tok/s\n{1}\nSessions: {2} · generating: {3}\n', `${s.kind === 'estimated' ? '~' : ''}${s.rate.toFixed(1)}`, source, s.sessions, s.active));
  if (s.latest && measured(s.latest)) tip.appendText(t('Model: {0}\n', s.latest.model === '未知模型' ? t('Unknown model') : s.latest.model));
  tip.appendText(t('Host: {0}\n', host));
  if (state.notice) tip.appendText(`\n${state.notice}\n`);
  if (state.limited) tip.appendText(t('Scan limit reached. Only some sessions are shown.'));
  tip.appendText(t('\nClick to open the dashboard.'));
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
  let history = new DashboardHistory();
  /** 历史缓存按 Codex Home 隔离，保存在扩展宿主的 globalStorage 下。 */
  let usageIndex: UsageIndex | undefined;
  let indexHome = '';
  let indexWork: Promise<void> | undefined;
  let timeZone = validTimeZone(context.globalState.get<string>('usage.timeZone', 'UTC'));
  /** 从现有只读监控器创建面板快照，隐藏时不会被调用。 */
  function dashboardPayload(): DashboardPayload {
    const snapshot = state?.snapshot ?? calculate([], options, Date.now());
    const sessions = monitor ? [...monitor.tailers.values()].map(item => item.parser) : [];
    const selectedRange = usageRange(vscode.workspace.getConfiguration('codexSpeed').get('usageRange', 'today'));
    return { data: history.data(sessions, options, snapshot, Date.now(), usageIndex?.query(selectedRange, timeZone, options, sessions), usageIndex?.status),
      labels: dashboardMessages(t), locale: uiLanguage,
      selectedLanguage: vscode.workspace.getConfiguration('codexSpeed').get<string>('language', 'auto'),
      context: { host, home: options.home, scope: options.scope, notice: state?.notice ?? '', error: state?.error ?? false,
        limited: state?.limited ?? false, enabled: vscode.workspace.getConfiguration('codexSpeed').get<boolean>('enabled', true) } };
  }
  const dashboard = new DashboardPanel(context.extensionUri, dashboardPayload, {
    refresh: () => { void vscode.commands.executeCommand('codexSpeed.refresh'); }, settings: () => { void vscode.commands.executeCommand('codexSpeed.openSettings'); },
    language: value => { void vscode.workspace.getConfiguration('codexSpeed').update('language', value, vscode.ConfigurationTarget.Global); },
    usageRange: value => { void vscode.workspace.getConfiguration('codexSpeed').update('usageRange', value, vscode.ConfigurationTarget.Global); },
    timeZone: value => { const next = validTimeZone(value); if (next !== timeZone) { timeZone = next; void context.globalState.update('usage.timeZone', next); } }
  });

  /** 自动模式使用 VS Code 原生翻译；手动模式仅在设置变化时读取内置资源。 */
  function configureLanguage(): void {
    const selected = vscode.workspace.getConfiguration('codexSpeed').get<string>('language', 'auto');
    uiLanguage = resolveLanguage(selected, vscode.env.language);
    translate = selected === 'auto' ? vscode.l10n.t : createTranslator(uiLanguage, locale => JSON.parse(fs.readFileSync(context.asAbsolutePath(`l10n/bundle.l10n.${locale}.json`), 'utf8')));
  }

  /** 刷新失败时仍保持状态栏可诊断；配置更换后丢弃旧实例结果。 */
  async function render(force = false): Promise<void> {
    const current = monitor;
    if (!current || disposed) { if (!disposed) dashboard.update(); return; }
    try {
      const result = await current.tick(force);
      if (monitor !== current || disposed) return;
      state = result;
      history.record(result.snapshot, Date.now(), result.error);
      bar.text = statusText(result);
      bar.tooltip = tooltip(result, options, host);
      bar.backgroundColor = result.error ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      bar.accessibilityInformation = { label: bar.text.replace(/\$\([^)]+\)/g, '') };
      dashboard.update();
      // 历史回填有独立字节预算，完成后更新面板，但不阻塞当前速度显示。
      if (!indexWork && usageIndex) {
        const index = usageIndex, pending = index.refresh(); indexWork = pending;
        void pending.then(() => { if (usageIndex === index && !disposed) dashboard.update(); }).finally(() => { if (indexWork === pending) indexWork = undefined; });
      }
    } catch (error) {
      logger.write(t('Refresh failed: {0}', errorCode(error)));
      bar.text = `$(warning) Codex ${t('Read error')}`;
      bar.tooltip = t('Click to view diagnostic logs or check the Codex Home setting.');
      state = { snapshot: state?.snapshot ?? calculate([], options, Date.now()), notice: t('Refresh failed: {0}', errorCode(error)), error: true, limited: false };
      history.record(state.snapshot, Date.now(), true);
      dashboard.update();
    }
  }

  /** 切换配置时完整替换状态机和计时器，避免重复轮询及旧目录状态残留。 */
  function restart(): void {
    if (timer) clearInterval(timer);
    monitor?.dispose();
    monitor = undefined;
    state = undefined;
    options = readOptions();
    if (!usageIndex || indexHome !== options.home) {
      const previous = usageIndex;
      usageIndex = new UsageIndex(options.home, path.join(context.globalStorageUri.fsPath, 'usage-history')); indexHome = options.home;
      void previous?.dispose().catch(() => logger.write(t('History cache shutdown failed')));
    }
    history = new DashboardHistory();
    if (!vscode.workspace.getConfiguration('codexSpeed').get<boolean>('enabled', true)) { bar.hide(); void usageIndex.pause().then(() => dashboard.update()); dashboard.update(); return; }
    usageIndex.resume();
    monitor = new CodexMonitor(options, message => logger.write(message), Date.now, t);
    logger.write(t('Monitoring started: {0}; Codex Home={1}; scope={2}', host, options.home, options.scope));
    bar.text = `$(sync~spin) Codex ${t('Scanning')}`;
    bar.tooltip = t('Reading session logs under {0}', options.home);
    bar.show();
    void render(true);
    timer = setInterval(() => { void render(); }, options.pollIntervalMs);
  }

  context.subscriptions.push(output, bar, dashboard,
    // 只返回计数及运行状态，供诊断和真实扩展宿主回放使用。
    vscode.commands.registerCommand('codexSpeed.getDiagnostics', () => ({ state, text: bar.text, home: options.home, remote: vscode.env.remoteName ?? 'local', dashboardVisible: dashboard.visible, dashboardRender: dashboard.lastRender, history: usageIndex?.status })),
    vscode.commands.registerCommand('codexSpeed.showLogs', () => { output.appendLine(t('Diagnostic log file: {0}', logger.file)); output.show(); }),
    vscode.commands.registerCommand('codexSpeed.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:NO00.vscode-codex-speed')),
    vscode.commands.registerCommand('codexSpeed.refresh', () => { void usageIndex?.refresh(true).then(() => dashboard.update()); return render(true); }),
    vscode.commands.registerCommand('codexSpeed.openDashboard', () => { dashboard.show(); }),
    vscode.commands.registerCommand('codexSpeed.showDetails', async () => {
      // 保留既有命令标识供老快捷键使用，状态栏点击直接打开完整仪表盘。
      dashboard.show();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('codexSpeed')) return;
      if (event.affectsConfiguration('codexSpeed.language')) configureLanguage();
      // 只切换语言时保留监控状态，强制刷新目录提示，无需重新扫描会话内容。
      if (['enabled', 'codexHome', 'scope', 'pollIntervalMs', 'scanDays', 'showEstimates'].some(key => event.affectsConfiguration(`codexSpeed.${key}`))) restart();
      else void render(true);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(restart),
    { dispose: () => { disposed = true; if (timer) clearInterval(timer); monitor?.dispose(); void usageIndex?.dispose().catch(() => logger.write(t('History cache shutdown failed'))); void logger.flush(); } }
  );
  configureLanguage();
  restart();
}
