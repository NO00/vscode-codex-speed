import * as vscode from 'vscode';
import crypto from 'node:crypto';
import { DashboardData } from './model';
import { dashboardHtml } from './html';

/** 给 Webview 的完整消息，动态值全部走 JSON 通道而非拼接 HTML。 */
export interface DashboardPayload {
  /** 测速与用量数据。 */
  data: DashboardData;
  /** 已选语言的文案。 */
  labels: Record<string, string>;
  /** 生效的数字和时间区域。 */
  locale: string;
  /** 设置中保留的语言选项，可为 auto。 */
  selectedLanguage: string;
  /** 当前主机、目录、范围、错误和限额提示。 */
  context: { host: string; home: string; scope: string; notice: string; error: boolean; limited: boolean; enabled: boolean };
}

/** 单例仪表盘宿主；只向可见面板发消息，关闭时释放 Webview 及所有监听。 */
export class DashboardPanel implements vscode.Disposable {
  /** 目前打开的单个编辑器面板。 */
  private panel: vscode.WebviewPanel | undefined;
  /** 面板相关监听，关闭后统一释放。 */
  private subscriptions: vscode.Disposable[] = [];
  /** 最近一次来自页面脚本的渲染确认，只保存语言及数量。 */
  private rendered: { locale: string; sessions: number } | undefined;

  /** 注入只读数据提供器和有限的用户操作，避免 Webview 执行任意命令。 */
  constructor(private readonly extensionUri: vscode.Uri, private readonly getPayload: () => DashboardPayload,
    private readonly actions: { refresh: () => void; settings: () => void; language: (value: string) => void }) {}

  /** 点击状态栏时复用已有标签；不切走用户正在编辑的原文件。 */
  show(): void {
    if (this.panel) { this.panel.reveal(); this.update(); return; }
    const root = vscode.Uri.joinPath(this.extensionUri, 'assets', 'dashboard');
    const panel = vscode.window.createWebviewPanel('codexSpeed.dashboard', 'Codex Speed', vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [root] });
    this.panel = panel;
    panel.webview.html = dashboardHtml({ css: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'dashboard.css')).toString(),
      script: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'dashboard.js')).toString(), source: panel.webview.cspSource,
      nonce: crypto.randomBytes(18).toString('hex') });
    this.rendered = undefined;
    this.subscriptions = [panel.onDidDispose(() => { this.panel = undefined; this.rendered = undefined; this.clearListeners(); }),
      panel.onDidChangeViewState(() => this.update()), panel.webview.onDidReceiveMessage(message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') this.update();
        if (message.type === 'refresh') this.actions.refresh();
        if (message.type === 'settings') this.actions.settings();
        if (message.type === 'language' && ['auto', 'en', 'zh-cn', 'zh-tw'].includes(message.value)) this.actions.language(message.value);
        if (message.type === 'rendered' && typeof message.locale === 'string' && Number.isSafeInteger(message.sessions)) this.rendered = { locale: message.locale, sessions: message.sessions };
      })];
  }

  /** 每次已有监控刷新后调用，隐藏面板不进行额外汇总或消息发送。 */
  update(): void { if (this.panel?.visible) void this.panel.webview.postMessage({ type: 'update', payload: this.getPayload() }); }

  /** 诊断只暴露开关状态，不暴露 Webview 内部对象。 */
  get visible(): boolean { return this.panel?.visible ?? false; }

  /** 回放验收用的精简确认，不包含用户会话内容。 */
  get lastRender(): { locale: string; sessions: number } | undefined { return this.rendered; }

  /** 释放监听列表，避免多次打开后重复处理菜单操作。 */
  private clearListeners(): void { this.subscriptions.splice(0).forEach(item => item.dispose()); }

  /** 扩展退出时连同 Webview 一起销毁。 */
  dispose(): void { this.panel?.dispose(); this.panel = undefined; this.clearListeners(); }
}
