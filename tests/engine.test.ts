import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, inWorkspace } from '../src/engine';
import { row, session, response } from './helpers';

/** 用明确的固定时钟测试速率，避免测试机器速度影响结果。 */
const options = { scope: 'all' as const, workspaces: [], showEstimates: true };

test('三秒窗口按响应时间重叠计算，并行调用加总，response_id 跨文件去重', () => {
  const a = session('a');
  const b = session('b');
  const mirror = session('mirror');
  response(a, 1000000, 1004000, 400, 'a');
  response(b, 1000000, 1004000, 200, 'b');
  response(mirror, 1000000, 1004000, 400, 'a');
  const snapshot = calculate([a, b, mirror], options, 1004000);
  assert.equal(snapshot.rate, 150);
  assert.equal(snapshot.output, 600);
  assert.equal(snapshot.responses, 2);
  assert.equal(snapshot.kind, 'measured');
});

test('生成中速率明确标为估算，完成事件替代估算且不会重复计算', () => {
  const a = session();
  response(a, 1000000, 1001000, 90);
  a.consume(row(1010000, 'response_item', { type: 'function_call_output' }));
  const estimated = calculate([a], options, 1013000);
  assert.equal(estimated.rate, 90);
  assert.equal(estimated.kind, 'estimated');
  a.consume(row(1013000, 'token_usage_record', { response_id: 'new', usage: { output_tokens: 180 } }));
  const measured = calculate([a], options, 1013000);
  assert.equal(measured.rate, 60);
  assert.equal(measured.kind, 'measured');
});

test('首次生成或关闭估算时显示等待，五分钟不更新后不能继续显示生成', () => {
  const a = session();
  a.consume(row(1001000, 'event_msg', { type: 'task_started' }));
  assert.equal(calculate([a], options, 1005000).kind, 'waiting');
  assert.equal(calculate([a], options, 1400000).active, 0);
  response(a, 1400000, 1401000, 50);
  a.consume(row(1402000, 'response_item', { type: 'function_call_output' }));
  assert.equal(calculate([a], { ...options, showEstimates: false }, 1410000).kind, 'waiting');
});

test('完成调用离开三秒窗口后当前速度立即归零，历史速度仅保留在 latest', () => {
  const a = session();
  response(a, 1000000, 1001000, 90);
  a.consume(row(1001001, 'event_msg', { type: 'task_complete' }));
  const stopped = calculate([a], options, 1006000);
  assert.equal(stopped.rate, 0);
  assert.equal(stopped.kind, 'idle');
  assert.equal(stopped.latest?.output, 90);
  assert.equal(calculate([a], options, 1020000).rate, 0);
  assert.equal(calculate([a], options, 1020000).kind, 'idle');
});

test('工作区按完整路径边界过滤，缺失耗时与未来时间记录不产生虚假速度', () => {
  assert.equal(inWorkspace('/project/sub', ['/project']), true);
  assert.equal(inWorkspace('/project-other', ['/project']), false);
  const a = session();
  const b = session('b'); b.cwd = '/project-other';
  response(a, 1000000, 1001000, 50);
  response(b, 1000000, 1001000, 5000);
  assert.equal(calculate([a, b], { ...options, scope: 'workspace', workspaces: ['/project'] }, 1001000).output, 50);
  assert.equal(calculate([a], options, 999999).output, 0);
});
