import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { row } from '../helpers';
import { MonitorState } from '../../src/monitor';
import { statusText, resolveHome, tooltip } from '../../src/extension';

/** 真实扩展宿主的只读诊断返回结构。 */
interface Diagnostics {
  /** 最新一次监控结果。 */
  state?: MonitorState;
  /** 实际写入状态栏的文字。 */
  text: string;
  /** 运行主机解析后的 Codex Home。 */
  home: string;
  /** 实际 Webview 可见状态及前端回传的渲染确认。 */
  dashboardVisible: boolean;
  dashboardRender?: { locale: string; sessions: number; usageRange?: string; output?: number; estimatedBuckets?: number; measuredBuckets?: number; costUSD?: number; pricedResponses?: number };
}

/** 等待异步状态栏刷新，在限定时间内失败而不是永久阻塞。 */
async function waitFor(check: (diagnostics: Diagnostics) => boolean): Promise<Diagnostics> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diagnostics = await vscode.commands.executeCommand<Diagnostics>('codexSpeed.getDiagnostics');
    if (diagnostics && check(diagnostics)) return diagnostics;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待状态栏更新超时');
}

/** VS Code 加载入口：通过真实命令、配置和状态栏装配回放虚拟日志。 */
export async function run(): Promise<void> {
  const report = process.env.CODEX_SPEED_TEST_REPORT!;
  try {
    const home = process.env.CODEX_SPEED_TEST_HOME!;
    const extension = vscode.extensions.getExtension('NO00.vscode-codex-speed');
    assert.ok(extension, '扩展必须被 VS Code 发现');
    assert.deepEqual(extension.packageJSON.extensionKind, ['workspace']);
    await extension.activate();
    const locale = process.env.CODEX_SPEED_TEST_LOCALE || 'en';
    assert.equal(vscode.env.language, locale, '宿主必须实际采用指定的客户端语言');
    const chinese = locale === 'zh-cn' || locale === 'zh-tw';
    const traditional = locale === 'zh-tw';
    assert.equal(vscode.l10n.t('Last'), chinese ? '上次' : 'Last');
    assert.equal(vscode.l10n.t('Read error'), chinese ? traditional ? '讀取異常' : '读取异常' : 'Read error');
    const commandTitle = extension.packageJSON.contributes.commands.find((item: { command: string }) => item.command === 'codexSpeed.showDetails').title;
    // 本地化命令标题在宿主描述中可能保留 value/original，以便同时搜索英文。
    assert.equal(typeof commandTitle === 'string' ? commandTitle : commandTitle.value, chinese ? traditional ? 'Codex Speed: 查看測速詳細資料' : 'Codex Speed: 查看测速详情' : 'Codex Speed: Show Speed Details');
    assert.equal(resolveHome('~/.codex', {}, '/remote-user'), path.resolve('/remote-user', '.codex'));
    const file = path.join(home, 'sessions', 'rollout-test.jsonl');
    let now = Date.now();
    await fs.writeFile(file, [
      row(now - 5000, 'session_meta', { id: 'host-test', cwd: '/project' }),
      row(now - 4500, 'turn_context', { model: 'gpt-6.1-sol' }),
      row(now - 4000, 'event_msg', { type: 'task_started' }),
      row(now - 1000, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 300, input_tokens: 1000, cached_input_tokens: 800 } }),
      row(now - 900, 'event_msg', { type: 'task_complete' })
    ].join('\n') + '\n');
    await vscode.commands.executeCommand('codexSpeed.refresh');
    const measured = await waitFor(d => d.state?.snapshot.output === 300);
    assert.equal(measured.home, home);
    assert.match(measured.text, /tok\/s/);
    const tip = tooltip(measured.state!, { home, scanDays: 3, scope: 'all', workspaces: [], showEstimates: true, pollIntervalMs: 500 }, 'ssh-remote / test-host').value.replace(/&nbsp;/g, ' ');
    assert.ok(tip.includes(chinese ? '宿主' : 'Host'));
    assert.ok(tip.includes(chinese ? traditional ? '輸出速度' : '输出速度' : 'Output speed'));
    assert.ok(tip.includes(chinese ? traditional ? '儀表板' : '仪表盘' : 'dashboard'));
    assert.ok(tip.length < 650, '悬浮摘要不应重新堆成长面板');
    assert.ok(!tip.includes(chinese ? 'Output speed' : '输出速度'));
    await vscode.commands.executeCommand('codexSpeed.showDetails');
    await waitFor(d => d.dashboardVisible && d.dashboardRender?.sessions === 1);
    await waitFor(d => d.dashboardRender?.usageRange === 'today' && d.dashboardRender.output === 300);
    await waitFor(d => d.dashboardRender?.pricedResponses === 1 && Math.abs((d.dashboardRender.costUSD ?? 0) - .00348) < .00000001);
    // 修改单价即时重算，不重启监控，输出计数和语言切换均保留。
    await vscode.workspace.getConfiguration('codexSpeed').update('priceOverrides', { 'gpt-6.1-sol': { input: 0, cachedInput: 0, output: 0 } }, vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.costUSD === 0 && d.dashboardRender.pricedResponses === 1 && d.state?.snapshot.output === 300);
    await vscode.workspace.getConfiguration('codexSpeed').update('priceOverrides', {}, vscode.ConfigurationTarget.Global);
    await waitFor(d => Math.abs((d.dashboardRender?.costUSD ?? 0) - .00348) < .00000001);
    const oldFile = path.join(home, 'sessions', 'historical.jsonl');
    await fs.writeFile(oldFile, [row(now - 2 * 86400000 - 3000, 'session_meta', { id: 'historical', cwd: '/project' }),
      row(now - 2 * 86400000 - 2000, 'event_msg', { type: 'user_message' }),
      row(now - 2 * 86400000, 'token_usage_record', { response_id: 'historical-old', usage: { output_tokens: 600 } })].join('\n') + '\n');
    await vscode.commands.executeCommand('codexSpeed.refresh');
    await vscode.workspace.getConfiguration('codexSpeed').update('usageRange', '7d', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.usageRange === '7d' && d.dashboardRender.output === 900);
    await vscode.workspace.getConfiguration('codexSpeed').update('usageRange', '30d', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.usageRange === '30d' && d.dashboardRender.output === 900);
    await vscode.workspace.getConfiguration('codexSpeed').update('usageRange', '30m', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.usageRange === '30m' && d.dashboardRender.output === 300);
    await vscode.workspace.getConfiguration('codexSpeed').update('usageRange', 'today', vscode.ConfigurationTarget.Global);
    await fs.unlink(oldFile);
    // 真实宿主确认调用离开窗口后，状态栏不会继续保留上次速度。
    const quiet = await waitFor(d => d.state?.snapshot.output === 300 && d.state.snapshot.kind === 'idle' && d.state.snapshot.rate === 0);
    assert.match(quiet.text, /Codex 0\.0 tok\/s/);
    now = Date.now();
    await fs.appendFile(file, row(now, 'event_msg', { type: 'task_started' }) + '\n');
    const estimated = await waitFor(d => d.state?.snapshot.kind === 'estimated');
    assert.match(estimated.text, /~/);
    await waitFor(d => (d.dashboardRender?.estimatedBuckets ?? 0) > 0 && (d.dashboardRender?.measuredBuckets ?? 0) > 0);
    await vscode.workspace.getConfiguration('codexSpeed').update('showEstimates', false, vscode.ConfigurationTarget.Global);
    const waiting = await waitFor(d => d.state?.snapshot.kind === 'waiting');
    assert.ok(waiting.text.includes(chinese ? traditional ? '等待計數' : '等待计数' : 'Waiting for counts'));
    await waitFor(d => d.dashboardRender?.estimatedBuckets === 0 && (d.dashboardRender.measuredBuckets ?? 0) > 0);
    // 在仍有计数的同一会话内覆盖和恢复语言，确认立即生效且不丢失测速状态。
    for (const [selected, expected] of [['zh-cn', '等待计数'], ['zh-tw', '等待計數'], ['en', 'Waiting for counts'], ['auto', chinese ? traditional ? '等待計數' : '等待计数' : 'Waiting for counts']]) {
      await vscode.workspace.getConfiguration('codexSpeed').update('language', selected, vscode.ConfigurationTarget.Global);
      const changed = await waitFor(d => d.text.includes(expected!));
      assert.equal(changed.state?.snapshot.output, 300);
      const declared: string | { value: string; original: string } = extension.packageJSON.contributes.commands.find((item: { command: string }) => item.command === 'codexSpeed.showDetails').title;
      assert.equal(declared, commandTitle, '手动语言不改变 VS Code 原生清单标题');
      await waitFor(d => d.dashboardRender?.locale === (selected === 'auto' ? locale : selected));
      await waitFor(d => Math.abs((d.dashboardRender?.costUSD ?? 0) - .00348) < .00000001);
    }
    now = Date.now();
    await fs.appendFile(file, row(now, 'token_usage_record', { response_id: 'two', usage: { output_tokens: 120 } }) + '\n' + row(now + 1, 'event_msg', { type: 'task_complete' }) + '\n');
    await waitFor(d => d.state?.snapshot.output === 420);
    const empty = { snapshot: { rate: 0, measuredRate: 0, estimatedRate: 0, estimatedShare: 0, kind: 'idle' as const, active: 0, sessions: 0, responses: 0, output: 0, latest: undefined }, notice: '', error: true, limited: false };
    assert.match(statusText(empty), /warning/);
    await vscode.workspace.getConfiguration('codexSpeed').update('codexHome', path.join(home, 'missing'), vscode.ConfigurationTarget.Global);
    const missing = await waitFor(d => d.state?.error === true);
    assert.ok(missing.state?.notice.includes(chinese ? traditional ? '找不到 sessions' : '未找到 sessions' : 'Sessions directory not found'));
    await vscode.workspace.getConfiguration('codexSpeed').update('language', 'zh-tw', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.notice.includes('找不到 sessions') === true);
    await vscode.workspace.getConfiguration('codexSpeed').update('language', 'en', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.notice.includes('Sessions directory not found') === true);
    await vscode.workspace.getConfiguration('codexSpeed').update('language', 'auto', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('codexSpeed').update('codexHome', home, vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.snapshot.output === 420 && !d.state.error);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor(d => !d.dashboardVisible);
    await vscode.commands.executeCommand('codexSpeed.openDashboard');
    await waitFor(d => d.dashboardVisible && d.dashboardRender?.sessions === 1 && d.state?.snapshot.output === 420);
    await vscode.workspace.getConfiguration('codexSpeed').update('enabled', false, vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.sessions === 0);
    await vscode.workspace.getConfiguration('codexSpeed').update('language', 'zh-tw', vscode.ConfigurationTarget.Global);
    await waitFor(d => d.dashboardRender?.locale === 'zh-tw');
    await vscode.workspace.getConfiguration('codexSpeed').update('language', 'auto', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('codexSpeed').update('enabled', true, vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.snapshot.output === 420 && d.dashboardRender?.locale === locale);
    await fs.writeFile(report, JSON.stringify({ ok: true, locale: vscode.env.language, checks: ['真实宿主加载', 'workspace 远程部署声明', '日志发现与状态栏文字', '无窗口内输出时状态栏归零', '实测/估算/等待切换', '配置变更重启', '增量输出去重', '路径错误与恢复', '客户端语言及原生翻译加载', '悬浮摘要及错误提示翻译', '手动切换四种语言选项并保留用量', '错误提示随手动语言切换', 'Webview 实际脚本渲染与语言更新', '关闭并重开仪表盘', '停用监控后仍可切换面板语言', '默认今天和四种用量时间范围', '历史记录只在对应范围内累计', '三项 API 等值费用实际渲染', '修改单价即时重算并恢复', '语言切换保留费用'] }));
  } catch (error) {
    await fs.writeFile(report, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }));
    throw error;
  }
}
