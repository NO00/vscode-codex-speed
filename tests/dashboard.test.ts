import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardHistory } from '../src/dashboard/model';
import { dashboardHtml } from '../src/dashboard/html';
import { calculate } from '../src/engine';
import { MonitorOptions } from '../src/types';
import { response, session } from './helpers';

/** 仪表盘测试只用固定时钟及虚拟用量，不读取真实对话。 */
const options: MonitorOptions = { home: '/home/test/.codex', scope: 'all', workspaces: [], showEstimates: true, scanDays: 3, pollIntervalMs: 1000 };

test('会话镜像合并，输入输出全局去重，未知耗时不污染加权平均', () => {
  const first = session('a'), mirror = session('a'), second = session('b');
  response(first, 1000000, 1001000, 100, 'shared');
  response(mirror, 1000000, 1001000, 100, 'shared');
  response(second, 1000000, 1002000, 100, 'other');
  first.samples[0]!.input = 1000; mirror.samples[0]!.input = 1000; second.samples[0]!.input = 2000;
  second.samples.push({ key: 'unknown', start: undefined, end: 1002100, output: 500, input: 5000, model: 'test-model' });
  const sessions = [first, mirror, second];
  const data = new DashboardHistory().data(sessions, options, calculate(sessions, options, 1003000), 1003000);
  assert.equal(data.sessions.length, 2);
  assert.equal(data.usage.output, 700);
  assert.equal(data.usage.input, 8000);
  assert.equal(data.usage.responses, 3);
  assert.ok(Math.abs(data.usage.average - 200 / 3) < .0001);
});

test('仪表盘遵守工作区和半小时边界，失联会话回到空闲', () => {
  const first = session('a'), other = session('b');
  first.cwd = '/project'; other.cwd = '/project-other';
  response(first, 1000000, 1001000, 10); response(other, 1000000, 1001000, 2000);
  first.phase = 'generating'; first.lastEvent = 1001000;
  const filtered = { ...options, scope: 'workspace' as const, workspaces: ['/project'] };
  const model = new DashboardHistory();
  const data = model.data([first, other], filtered, calculate([first, other], filtered, 1400000), 1400000);
  assert.equal(data.sessions.length, 1); assert.equal(data.usage.output, 10); assert.equal(data.sessions[0]!.phase, 'idle');
  assert.equal(model.data([first], filtered, data.snapshot, 3000000).usage.output, 0);
});

test('曲线不将上次速度当实时值，错误归零并限制为五分钟', () => {
  const model = new DashboardHistory();
  const snapshot = { ...calculate([], options, 0), rate: 80, kind: 'measured' as const };
  for (let index = 0; index <= 1000; index++) model.record(snapshot, index * 500);
  model.record({ ...snapshot, kind: 'last' }, 500500);
  model.record(snapshot, 501000, true);
  const data = model.data([], options, snapshot, 501000);
  assert.ok(data.points.length <= 601);
  assert.ok(data.points.every(point => point.time >= 201000));
  assert.equal(data.points.at(-1)!.rate, 0); assert.equal(data.points.at(-2)!.rate, 0);
  assert.equal(data.usage.peak, 80);
});

test('重复刷新覆盖曲线最后一点，时钟回退后重建时间线', () => {
  const model = new DashboardHistory(); const snapshot = calculate([], options, 0);
  model.record(snapshot, 1000000); model.record(snapshot, 1000100);
  assert.equal(model.data([], options, snapshot, 1000100).points.length, 1);
  model.record(snapshot, 999999);
  assert.deepEqual(model.data([], options, snapshot, 999999).points.map(point => point.time), [999999]);
});

test('Webview 禁止默认资源、外部网络和未授权脚本，HTML 不嵌入会话数据', () => {
  const html = dashboardHtml({ css: 'https://local/style?a="bad', script: 'https://local/app.js', source: 'https://local', nonce: 'test-nonce' });
  assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("script-src 'nonce-test-nonce'"));
  assert.ok(html.includes('&quot;bad')); assert.ok(!html.includes('unsafe-inline'));
  assert.ok(html.includes('id="sessions"') && html.includes('id="language"'));
});
