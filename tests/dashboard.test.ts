import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardHistory } from '../src/dashboard/model';
import { dashboardHtml } from '../src/dashboard/html';
import { calculate } from '../src/engine';
import { MonitorOptions } from '../src/types';
import { response, session, row } from './helpers';

/** 仪表盘测试只用固定时钟及虚拟用量，不读取真实对话。 */
const options: MonitorOptions = { home: '/home/test/.codex', scope: 'all', workspaces: [], showEstimates: true, scanDays: 3, pollIntervalMs: 1000 };

test('Agent Speed 口径：完成计数回填同一秒，替换先前的估算曲线', () => {
  const first = session('aligned'), model = new DashboardHistory();
  response(first, 1000000, 1001000, 90);
  first.consume(row(1010000, 'event_msg', { type: 'task_started' }));
  const before = model.data([first], options, calculate([first], options, 1013000), 1013000);
  assert.equal(before.points.find(point => point.time === 1011000)!.estimated, 90);
  assert.equal(before.points.find(point => point.time === 1011000)!.measured, 0);
  first.consume(row(1014000, 'token_usage_record', { response_id: 'completed', usage: { output_tokens: 180 } }));
  const after = model.data([first], options, calculate([first], options, 1014000), 1014000);
  assert.equal(after.points.find(point => point.time === 1011000)!.measured, 45);
  assert.equal(after.points.find(point => point.time === 1011000)!.estimated, 0);
  assert.equal(after.snapshot.estimatedShare, 0);
});

test('并行混合桶保留两部分，单个会话采用与总计相同的模型回退参考', () => {
  const counted = session('counted'), generating = session('generating');
  counted.model = generating.model = 'same-model';
  response(counted, 1010000, 1014000, 200, 'measured'); counted.samples[0]!.model = 'same-model';
  generating.consume(row(1010000, 'event_msg', { type: 'task_started' }));
  const now = 1014000, sessions = [counted, generating];
  const data = new DashboardHistory().data(sessions, options, calculate(sessions, options, now), now);
  const point = data.points.find(point => point.time === 1011000)!;
  assert.equal(point.measured, 50); assert.equal(point.estimated, 50); assert.equal(point.rate, 100);
  assert.equal(data.snapshot.rate, data.sessions.reduce((sum, item) => sum + item.rate, 0));
  assert.equal(data.sessions.find(item => item.id === 'generating')!.rate, 50);
});

test('会话镜像合并，输入输出全局去重，未知耗时不污染加权平均', () => {
  const first = session('a'), mirror = session('a'), second = session('b');
  response(first, 1000000, 1001000, 100, 'shared'); response(mirror, 1000000, 1001000, 100, 'shared'); response(second, 1000000, 1002000, 100, 'other');
  first.samples[0]!.input = 1000; mirror.samples[0]!.input = 1000; second.samples[0]!.input = 2000;
  second.samples.push({ key: 'unknown', start: undefined, end: 1002100, output: 500, input: 5000, model: 'test-model' });
  const sessions = [first, mirror, second];
  const data = new DashboardHistory().data(sessions, options, calculate(sessions, options, 1003000), 1003000);
  assert.equal(data.sessions.length, 2); assert.equal(data.usage.output, 700); assert.equal(data.usage.input, 8000); assert.equal(data.usage.responses, 3);
  assert.ok(Math.abs(data.usage.average - 200 / 3) < .0001);
  assert.equal(data.points.find(point => point.time === 1000000)!.measured, 150);
});

test('工作区过滤也限制估算回退，失联会话空闲且不继续估算', () => {
  const first = session('a'), other = session('b'); first.cwd = '/project'; other.cwd = '/project-other';
  response(other, 1000000, 1001000, 100);
  first.consume(row(1002000, 'event_msg', { type: 'task_started' }));
  const filtered = { ...options, scope: 'workspace' as const, workspaces: ['/project'] };
  const data = new DashboardHistory().data([first, other], filtered, calculate([first, other], filtered, 1006000), 1006000);
  assert.equal(data.snapshot.kind, 'waiting'); assert.equal(data.sessions.length, 1); assert.equal(data.usage.output, 0);
  const stale = new DashboardHistory().data([first, other], filtered, calculate([first, other], filtered, 1400000), 1400000);
  assert.equal(stale.sessions[0]!.phase, 'idle'); assert.ok(stale.points.every(point => point.rate === 0));
});

test('一秒桶按毫秒交集分配，总计守恒，未来和未知耗时只影响可用计数', () => {
  const first = session('a');
  first.samples = [{ key: 'fractional', start: 1000250, end: 1001750, output: 90, input: 0, model: '' },
    { key: 'unknown', start: undefined, end: 1002000, output: 100, input: 0, model: '' },
    { key: 'future', start: 1002000, end: 1004000, output: 300, input: 0, model: '' }];
  const data = new DashboardHistory().data([first], options, calculate([first], options, 1003000), 1003000);
  assert.equal(data.points.length, 300);
  assert.equal(data.points.find(point => point.time === 1000000)!.measured, 45);
  assert.equal(data.points.find(point => point.time === 1001000)!.measured, 45);
  assert.equal(data.points.reduce((sum, point) => sum + point.measured, 0), 90);
  assert.equal(data.usage.output, 190);
});

test('重复刷新和重开从日志重建有界曲线，关闭估算不抹掉实测', () => {
  const first = session('a'), model = new DashboardHistory();
  first.samples = Array.from({ length: 1010 }, (_, index) => ({ key: `call-${index}`, start: 1000000 + index * 100, end: 1001000 + index * 100, output: 20, input: 0, model: '' }));
  const now = 1200000, snapshot = calculate([first], options, now);
  const data = model.data([first], options, snapshot, now);
  assert.equal(data.points.length, 300); assert.equal(data.usage.responses, 1010);
  assert.ok(Math.abs(data.points.reduce((sum, point) => sum + point.measured, 0) - 20200) < .000001);
  assert.deepEqual(model.data([first], options, snapshot, now).points, data.points);
  assert.deepEqual(new DashboardHistory().data([first], options, snapshot, now).points, data.points);
  const disabled = { ...options, showEstimates: false };
  assert.deepEqual(model.data([first], disabled, calculate([first], disabled, now), now).points, data.points);
});

test('工具阶段窗口排空后读数和末桶归零，历史实测段仍保留', () => {
  const first = session('a'); response(first, 1000000, 1001000, 133); first.phase = 'tools'; first.lastEvent = 1001000;
  const now = 1005000, snapshot = calculate([first], options, now);
  const data = new DashboardHistory().data([first], options, snapshot, now);
  assert.equal(data.points.at(-1)!.rate, 0); assert.equal(data.snapshot.rate, 0); assert.equal(data.snapshot.kind, 'tools');
  assert.equal(data.points.find(point => point.time === 1000000)!.measured, 133); assert.equal(data.sessions[0]!.rate, 0);
});

test('Webview 禁止默认资源、外部网络和未授权脚本，HTML 不嵌入会话数据', () => {
  const html = dashboardHtml({ css: 'https://local/style?a="bad', script: 'https://local/app.js', source: 'https://local', nonce: 'test-nonce' });
  assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("script-src 'nonce-test-nonce'"));
  assert.ok(html.includes('&quot;bad')); assert.ok(!html.includes('unsafe-inline')); assert.ok(html.includes('id="sessions"') && html.includes('id="language"'));
});
