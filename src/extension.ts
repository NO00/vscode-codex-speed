import * as vscode from 'vscode';
import os from 'node:os';
import path from 'node:path';
import { FileLogger } from './logger';
import { CodexMonitor, errorCode, MonitorState } from './monitor';
import { measured, sampleRate } from './engine';
import { MonitorOptions } from './types';

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
  if (state.error) return '$(warning) Codex 日志';
  const s = state.snapshot;
  if (s.sessions === 0) return '$(pulse) Codex -- tok/s';
  const number = s.rate.toFixed(1);
  const suffix = s.active > 1 ? ` · ${s.active} agents` : '';
  const limit = state.limited ? ' · 部分' : '';
  if (s.kind === 'estimated') return `$(pulse) Codex ~${number} tok/s${suffix}${limit}`;
  if (s.kind === 'waiting') return `$(pulse) Codex -- tok/s · 等待计数${suffix}${limit}`;
  if (s.kind === 'last') return `$(pulse) Codex ${number} tok/s · 上次${limit}`;
  if (s.kind === 'tools') return `$(tools) Codex 0.0 tok/s · 工具中${limit}`;
  return `$(pulse) Codex ${number} tok/s${suffix}${limit}`;
}

/** 构造纯文本内容的 Markdown tooltip，日志中的模型和路径不会被当成命令执行。 */
function tooltip(state: MonitorState, options: MonitorOptions, host: string): vscode.MarkdownString {
  const tip = new vscode.MarkdownString();
  tip.appendMarkdown('### VSCode Codex Speed\n\n');
  tip.appendText(`宿主：${host}\n目录：${options.home}\n范围：${options.scope === 'all' ? '此主机全部近期会话' : '当前工作区'}\n`);
  const s = state.snapshot;
  tip.appendText(`\n输出速度：${s.rate.toFixed(1)} token/s\n来源：${({ measured: '三秒窗口实测', estimated: '含历史速率估算（~）', last: '上次已完成调用，非当前实时速度', waiting: '正在生成，等待可用计数', tools: '等待工具结果', idle: '空闲' })[s.kind]}\n会话：${s.sessions}，正在生成：${s.active}\n近半小时：${s.output.toLocaleString()} 输出 token / ${s.responses} 条响应\n`);
  if (s.latest && measured(s.latest)) tip.appendText(`\n最近模型：${s.latest.model}\n最近调用：${sampleRate(s.latest).toFixed(1)} tok/s，${s.latest.output} 输出 token，${((s.latest.end - s.latest.start) / 1000).toFixed(2)} 秒\n`);
  if (state.notice) tip.appendText(`\n${state.notice}\n`);
  if (state.limited) tip.appendText('\n达到扫描上限，仅显示部分会话。\n');
  tip.appendText('\n输出含 reasoning；请求耗时含首 token 等待。生成中的 ~ 数值是估算，日志不提供逐 token 实时计数。\n点击查看详情与操作。');
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
      logger.write(`刷新失败：${errorCode(error)}`);
      bar.text = '$(warning) Codex 读取异常';
      bar.tooltip = '点击查看诊断日志或检查 Codex Home 设置。';
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
    monitor = new CodexMonitor(options, message => logger.write(message));
    logger.write(`开始监控：${host}；Codex Home=${options.home}；scope=${options.scope}`);
    bar.text = '$(sync~spin) Codex 扫描中';
    bar.tooltip = `正在读取 ${options.home} 下的会话日志`;
    bar.show();
    void render(true);
    timer = setInterval(() => { void render(); }, options.pollIntervalMs);
  }

  context.subscriptions.push(output, bar,
    // 只返回计数及运行状态，供诊断和真实扩展宿主回放使用。
    vscode.commands.registerCommand('codexSpeed.getDiagnostics', () => ({ state, text: bar.text, home: options.home, remote: vscode.env.remoteName ?? 'local' })),
    vscode.commands.registerCommand('codexSpeed.showLogs', () => output.show()),
    vscode.commands.registerCommand('codexSpeed.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-codex-tools.vscode-codex-speed')),
    vscode.commands.registerCommand('codexSpeed.refresh', () => render(true)),
    vscode.commands.registerCommand('codexSpeed.showDetails', async () => {
      const choice = await vscode.window.showQuickPick([
        { label: '$(output) 查看测速详情', description: state ? `${state.snapshot.rate.toFixed(1)} tok/s · ${state.snapshot.sessions} 个会话` : '等待扫描', action: 'details' },
        { label: '$(refresh) 重新扫描日志', action: 'refresh' },
        { label: '$(settings-gear) 配置日志目录和范围', action: 'settings' }
      ], { title: `VSCode Codex Speed · ${host}` });
      if (choice?.action === 'refresh') await render(true);
      if (choice?.action === 'settings') await vscode.commands.executeCommand('codexSpeed.openSettings');
      if (choice?.action === 'details') {
        if (state) output.appendLine(tooltip(state, options, host).value);
        output.appendLine(`诊断日志文件：${logger.file}`);
        output.show();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('codexSpeed')) restart(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(restart),
    { dispose: () => { disposed = true; if (timer) clearInterval(timer); monitor?.dispose(); void logger.flush(); } }
  );
  restart();
}
