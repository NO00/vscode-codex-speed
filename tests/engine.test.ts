import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, calculateFrame, inWorkspace, sampleRate } from '../src/engine';
import fs from 'node:fs';
import { Phase, Session } from '../src/types';
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

test('Agent Speed 口径：生成中使用三秒窗口估算，完成后由实际计数替代', () => {
  const first = session('aligned');
  response(first, 1000000, 1001000, 90);
  first.consume(row(1010000, 'event_msg', { type: 'task_started' }));
  const generating = calculate([first], options, 1013000);
  assert.equal(generating.rate, 90); assert.equal(generating.kind, 'estimated');
  first.consume(row(1014000, 'token_usage_record', { response_id: 'completed', usage: { output_tokens: 180 } }));
  const complete = calculate([first], options, 1014000);
  assert.equal(complete.rate, 45); assert.equal(complete.kind, 'measured');
});

test('生成中估算与完成计数互相替代，不会重复加上同一请求', () => {
  const a = session();
  response(a, 1000000, 1001000, 90);
  a.consume(row(1010000, 'response_item', { type: 'function_call_output' }));
  const estimated = calculate([a], options, 1013000);
  assert.equal(estimated.rate, 90);
  assert.equal(estimated.kind, 'estimated');
  assert.equal(estimated.estimatedShare, 1);
  a.consume(row(1013000, 'token_usage_record', { response_id: 'new', usage: { output_tokens: 180 } }));
  const measured = calculate([a], options, 1013000);
  assert.equal(measured.rate, 60);
  assert.equal(measured.kind, 'measured');
});

test('并行实测和估算分别保留并计算占比，镜像估算仅计一次', () => {
  const first = session('first'), generating = session('generating');
  response(first, 1010000, 1013000, 180, 'counted');
  response(generating, 1000000, 1001000, 90, 'reference');
  generating.consume(row(1010000, 'response_item', { type: 'function_call_output' }));
  const snapshot = calculate([first, generating, generating], options, 1013000);
  assert.equal(snapshot.kind, 'estimated');
  assert.equal(snapshot.rate, 150);
  assert.equal(snapshot.measuredRate, 60); assert.equal(snapshot.estimatedRate, 90); assert.equal(snapshot.estimatedShare, .6);
  const disabled = calculate([first, generating], { ...options, showEstimates: false }, 1013000);
  assert.equal(disabled.estimatedRate, 0);
  assert.equal(disabled.rate, 60); assert.equal(disabled.kind, 'measured');
});

test('零贡献估算不覆盖实测，工具阶段窗口排空前保留实际速度', () => {
  const first = session('zero-estimate');
  response(first, 1000000, 1003000, 90);
  first.consume(row(1003000, 'event_msg', { type: 'task_started' }));
  assert.equal(calculate([first], options, 1003000).kind, 'measured');
  first.phase = 'tools';
  assert.equal(calculate([first], options, 1004000).rate, 20);
  assert.equal(calculate([first], options, 1006000).rate, 0);
});

test('短于五百毫秒的响应扩展区间，过长或倒序响应仅保留计数', () => {
  const sample = { key: 'short', start: 1000000, end: 1000000, output: 50, input: 0, model: '' };
  assert.equal(sampleRate(sample), 100);
  assert.equal(sampleRate({ ...sample, end: 1900001 }), 0);
  assert.equal(sampleRate({ ...sample, end: 999999 }), 0);
});

test('差分桶与独立逐区间公式一致，覆盖部分秒、负时间与窗口裁剪', () => {
  let seed = 1979;
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const now of [1000123, -12345]) {
    const first: Session = { file: '/fixture', id: 'fractional', cwd: '/fixture', model: 'm', phase: 'idle', pendingStart: undefined, lastEvent: now,
      samples: Array.from({ length: 150 }, (_, index) => { const end = now - Math.floor(random() * 400000); return { key: `r${index}`, end, start: end - Math.floor(random() * 60000), output: Math.floor(random() * 500), input: 0, model: 'm' }; }) };
    const frame = calculateFrame([first], options, now, true);
    for (const point of frame.points) {
      // 参考实现逐条计算交集，不使用差分数组或生产代码的分桶辅助函数。
      const expected = first.samples.reduce((sum, sample) => {
        const duration = Math.max(500, sample.end - sample.start!);
        const intersection = Math.max(0, Math.min(point.time + 1000, sample.end) - Math.max(point.time, sample.end - duration));
        return sum + sample.output * intersection / duration;
      }, 0);
      assert.ok(Math.abs(point.measured - expected) < .000001, `bucket ${point.time}: ${point.measured} != ${expected}`);
      if (expected === 0) assert.equal(point.measured, 0);
      assert.equal(point.estimated, 0);
    }
  }
});

test('一百二十八个活跃会话的大样本仍保持独立估算和固定历史容量', context => {
  const now = 1000000000000;
  const sessions: Session[] = Array.from({ length: 128 }, (_, agent) => ({ file: `/load/${agent}`, id: `agent-${agent}`, cwd: '/load', model: `m${agent % 4}`, phase: 'generating', pendingStart: now - 5000, lastEvent: now - 100,
    samples: Array.from({ length: 1000 }, (_, index) => ({ key: `load-${agent}-${index}`, start: now - 10500 - index * 1000, end: now - 10000 - index * 1000, output: 10, input: 100, model: `m${agent % 4}` })) }));
  const started = performance.now();
  const frame = calculateFrame(sessions, options, now, true);
  context.diagnostic(`128000 条记录重建耗时 ${(performance.now() - started).toFixed(1)} ms`);
  assert.equal(frame.snapshot.rate, 2560); assert.equal(frame.snapshot.estimatedShare, 1);
  assert.equal(frame.agents.size, 128); assert.equal(frame.points.length, 300);
});

/** 上游公开 Codex 最终响应案例，只比对本扩展支持的输出速度、估算占比和历史桶。 */
interface ReferenceCase {
  name: string;
  agents: { id: string; model: string | null; phase: Phase; inFlightStartMs: number | null; lastLineMs: number }[];
  responses: { key: string; agentId: string; model: string | null; startMs: number | null; endMs: number; output: number; input: number }[];
  queries: { nowMs: number; liveOutput: number; estimatedShare: number; historyMeasuredOutput?: Record<string, number> }[];
}

test('与 Agent Speed 原版 Codex fixture 的输出速度和估算占比交叉核对', () => {
  const fixture: { cases: ReferenceCase[] } = JSON.parse(fs.readFileSync('tests/fixtures/agent-speed-engine.json', 'utf8'));
  assert.ok(fixture.cases.length >= 7);
  for (const entry of fixture.cases) for (const query of entry.queries) {
    const sessions = entry.agents.map(agent => ({ file: `/fixture/${agent.id}`, id: agent.id, cwd: '/fixture', model: agent.model ?? '', phase: agent.phase,
      pendingStart: agent.inFlightStartMs ?? undefined, lastEvent: agent.lastLineMs,
      samples: entry.responses.filter(response => response.agentId === agent.id).map(response => ({ key: response.key, start: response.startMs ?? undefined, end: response.endMs, output: response.output, input: response.input, model: response.model ?? '' })) }));
    const frame = calculateFrame(sessions, options, query.nowMs, true);
    assert.ok(Math.abs(frame.snapshot.rate - query.liveOutput) < .000001, `${entry.name}: liveOutput ${frame.snapshot.rate} != ${query.liveOutput}`);
    assert.ok(Math.abs(frame.snapshot.estimatedShare - query.estimatedShare) < .000001, `${entry.name}: estimatedShare`);
    for (const [time, expected] of Object.entries(query.historyMeasuredOutput ?? {})) assert.ok(Math.abs(frame.points.find(point => point.time === Number(time))!.measured - expected) < .000001, `${entry.name}: bucket ${time}`);
  }
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
