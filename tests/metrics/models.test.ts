import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFrame } from '../../src/engine';
import { response, row, session } from '../helpers';
import { DashboardHistory } from '../../src/dashboard/model';

/** 模型分组和主读数采用相同范围，避免分组后单独重算估算参考。 */
const options = { scope: 'all' as const, workspaces: [], showEstimates: true };

test('模型切换后旧响应仍归实际模型，新模型在途估算独立分配且总和守恒', () => {
  const parser = session(); parser.model = 'model-a'; response(parser, 1000000, 1003000, 90, 'a');
  parser.consume(row(1003000, 'turn_context', { model: 'model-b' }));
  parser.consume(row(1003000, 'response_item', { type: 'function_call_output' }));
  const frame = calculateFrame([parser], options, 1004000, true);
  assert.equal(frame.models.find(model => model.model === 'model-a')!.measuredRate, 20);
  assert.equal(frame.models.find(model => model.model === 'model-b')!.estimatedRate, 10);
  assert.equal(frame.models.reduce((sum, model) => sum + model.rate, 0), frame.snapshot.rate);
  assert.equal(frame.models.find(model => model.model === 'model-b')!.active, 1);
});

test('并行模型、同会话镜像及跨会话重复响应不使分组速度膨胀', () => {
  const a = session('a'), b = session('b'), mirror = session('mirror'); a.model = 'model-a'; b.model = 'model-b'; mirror.model = 'model-a';
  response(a, 1000000, 1003000, 90, 'a'); response(b, 1000000, 1003000, 180, 'b'); response(mirror, 1000000, 1003000, 90, 'a');
  const frame = calculateFrame([a, a, b, mirror], options, 1003000, true);
  assert.equal(frame.snapshot.rate, 90);
  assert.equal(frame.models.find(model => model.model === 'model-a')!.rate, 30);
  assert.equal(frame.models.find(model => model.model === 'model-b')!.rate, 60);
  assert.equal(frame.models.reduce((sum, model) => sum + model.rate, 0), 90);
});

test('关闭估算、过滤工作区和工具窗口排空不改变模型汇总口径', () => {
  const a = session('a'), b = session('b'); a.model = 'known'; b.cwd = '/other';
  response(a, 1000000, 1001000, 90); a.consume(row(1010000, 'event_msg', { type: 'task_started' }));
  b.consume(row(1010000, 'event_msg', { type: 'task_started' }));
  const filtered = { ...options, scope: 'workspace' as const, workspaces: ['/project'], showEstimates: false };
  const frame = calculateFrame([a, b], filtered, 1013000, true);
  assert.equal(frame.models.length, 1); assert.equal(frame.models[0]!.rate, 0); assert.equal(frame.models[0]!.active, 1);
  a.phase = 'tools'; a.pendingStart = undefined;
  assert.equal(calculateFrame([a], options, 1014000, true).models[0]!.tools, 1);
  a.phase = 'idle';
  assert.deepEqual(calculateFrame([a], options, 1014000, true).models, []);
});

test('状态栏帧省略模型和历史汇总，主读数与完整仪表盘帧一致', () => {
  const parser = session(); parser.model = 'model'; response(parser, 1000000, 1003000, 90);
  const compact = calculateFrame([parser], options, 1003000), full = calculateFrame([parser], options, 1003000, true);
  assert.deepEqual(compact.models, []); assert.deepEqual(compact.points, []);
  assert.deepEqual(compact.snapshot, full.snapshot); assert.equal(full.models[0]!.rate, 30);
});

test('仪表盘在状态栏上一轮快照之后刷新时，模型合计仍与当前主读数一致', () => {
  const parser = session(); parser.model = 'model'; response(parser, 1000000, 1003000, 90);
  const old = calculateFrame([parser], options, 1003000).snapshot;
  const data = new DashboardHistory().data([parser], { ...options, home: '/virtual', scanDays: 3, pollIntervalMs: 500 }, old, 1004000);
  assert.equal(old.rate, 30); assert.equal(data.snapshot.rate, 20);
  assert.equal(data.models.reduce((sum, model) => sum + model.rate, 0), data.snapshot.rate);
});
