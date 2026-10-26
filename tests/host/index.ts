import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { row } from '../helpers';
import { MonitorState } from '../../src/monitor';
import { statusText, resolveHome } from '../../src/extension';

/** 真实扩展宿主的只读诊断返回结构。 */
interface Diagnostics {
  /** 最新一次监控结果。 */
  state?: MonitorState;
  /** 实际写入状态栏的文字。 */
  text: string;
  /** 运行主机解析后的 Codex Home。 */
  home: string;
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
    const extension = vscode.extensions.getExtension('local-codex-tools.vscode-codex-speed');
    assert.ok(extension, '扩展必须被 VS Code 发现');
    assert.deepEqual(extension.packageJSON.extensionKind, ['workspace']);
    await extension.activate();
    assert.equal(resolveHome('~/.codex', {}, '/remote-user'), path.resolve('/remote-user', '.codex'));
    const file = path.join(home, 'sessions', 'rollout-test.jsonl');
    let now = Date.now();
    await fs.writeFile(file, [
      row(now - 5000, 'session_meta', { id: 'host-test', cwd: '/project' }),
      row(now - 4000, 'event_msg', { type: 'task_started' }),
      row(now - 1000, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 300 } }),
      row(now - 900, 'event_msg', { type: 'task_complete' })
    ].join('\n') + '\n');
    await vscode.commands.executeCommand('codexSpeed.refresh');
    const measured = await waitFor(d => d.state?.snapshot.output === 300);
    assert.equal(measured.home, home);
    assert.match(measured.text, /tok\/s/);
    now = Date.now();
    await fs.appendFile(file, row(now, 'event_msg', { type: 'task_started' }) + '\n');
    const estimated = await waitFor(d => d.state?.snapshot.kind === 'estimated');
    assert.match(estimated.text, /~/);
    await vscode.workspace.getConfiguration('codexSpeed').update('showEstimates', false, vscode.ConfigurationTarget.Global);
    const waiting = await waitFor(d => d.state?.snapshot.kind === 'waiting');
    assert.match(waiting.text, /等待计数/);
    now = Date.now();
    await fs.appendFile(file, row(now, 'token_usage_record', { response_id: 'two', usage: { output_tokens: 120 } }) + '\n' + row(now + 1, 'event_msg', { type: 'task_complete' }) + '\n');
    await waitFor(d => d.state?.snapshot.output === 420);
    const empty = { snapshot: { rate: 0, kind: 'idle' as const, active: 0, sessions: 0, responses: 0, output: 0, latest: undefined }, notice: '', error: true, limited: false };
    assert.match(statusText(empty), /warning/);
    await vscode.workspace.getConfiguration('codexSpeed').update('codexHome', path.join(home, 'missing'), vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.error === true);
    await vscode.workspace.getConfiguration('codexSpeed').update('codexHome', home, vscode.ConfigurationTarget.Global);
    await waitFor(d => d.state?.snapshot.output === 420 && !d.state.error);
    await fs.writeFile(report, JSON.stringify({ ok: true, checks: ['真实宿主加载', 'workspace 远程部署声明', '日志发现与状态栏文字', '实测/估算/等待切换', '配置变更重启', '增量输出去重', '路径错误与恢复'] }));
  } catch (error) {
    await fs.writeFile(report, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }));
    throw error;
  }
}
