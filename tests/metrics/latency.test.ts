import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentWait, summarizeLatency } from '../../src/metrics/latency';
import { CodexParser } from '../../src/parser';
import { row, session } from '../helpers';

test('首段只记录首次内容时间，断点和后续输入不重置已开始响应', () => {
  const parser = session(); parser.consume(row(1001000, 'event_msg', { type: 'task_started' }));
  parser.consume(row(1002200, 'response_item', { type: 'reasoning' }));
  parser.consume(row(1002500, 'response_item', { type: 'message', role: 'assistant' }));
  const restored = new CodexParser('/virtual/restored'); restored.restore(parser.checkpoint());
  restored.consume(row(1002600, 'event_msg', { type: 'user_message' }));
  restored.consume(row(1003000, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 50 } }));
  assert.equal(restored.samples[0]!.firstContent, 1002200);
  assert.equal(contentWait(restored.samples[0]!), 1200); assert.equal(restored.firstContent, undefined);
  assert.deepEqual(summarizeLatency([restored], 'all', [], 1003100), { state: 'last', ms: 1200, requests: 1, at: 1003000 });
});

test('等待中显示已等待时长，首段出现后切换为已观测，工具结果和取消重置', () => {
  const parser = session(); parser.consume(row(1001000, 'event_msg', { type: 'user_message' }));
  assert.deepEqual(summarizeLatency([parser], 'all', [], 1002500), { state: 'waiting', ms: 1500, requests: 1 });
  parser.consume(row(1003000, 'response_item', { type: 'function_call' }));
  assert.deepEqual(summarizeLatency([parser], 'all', [], 1004000), { state: 'observed', ms: 2000, requests: 1 });
  parser.consume(row(1005000, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 80 } }));
  parser.consume(row(1006000, 'response_item', { type: 'function_call_output' }));
  assert.equal(summarizeLatency([parser], 'all', [], 1007000).ms, 1000);
  parser.consume(row(1007000, 'event_msg', { type: 'turn_aborted' }));
  assert.equal(parser.firstContent, undefined); assert.equal(summarizeLatency([parser], 'all', [], 1007000).state, 'last');
});

test('缺失首段或请求起点、负耗时和超长区间不能编造完成等待', () => {
  for (const sample of [ { start: undefined, end: 20, firstContent: 10 }, { start: 10, end: 20 },
    { start: 10, end: 20, firstContent: 9 }, { start: 10, end: 20, firstContent: 21 },
    { start: 10, end: 900011, firstContent: 12 }, { start: NaN, end: 20, firstContent: 12 } ]) assert.equal(contentWait(sample), undefined);
  const parser = session(); parser.consume(row(1001000, 'response_item', { type: 'message', role: 'assistant' }));
  parser.consume(row(1002000, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 30 } }));
  assert.deepEqual(summarizeLatency([parser], 'all', [], 1003000), { state: 'unavailable', requests: 0 });
});

test('旧版流式检查点没有首段字段时不把后续片段当首段', () => {
  const original = session(); original.consume(row(1001000, 'event_msg', { type: 'task_started' }));
  original.consume(row(1002000, 'response_item', { type: 'reasoning' }));
  const checkpoint = original.checkpoint(); delete checkpoint.firstContent;
  const restored = new CodexParser('/virtual/old'); restored.restore(checkpoint);
  restored.consume(row(1003000, 'response_item', { type: 'message', role: 'assistant' }));
  restored.consume(row(1004000, 'token_usage_record', { response_id: 'old', usage: { output_tokens: 40 } }));
  assert.equal(restored.samples[0]!.firstContent, undefined); assert.equal(contentWait(restored.samples[0]!), undefined);
});

test('并发等待取最久请求，已观测取均值；镜像、工作区、未来和失联不重复计入', () => {
  const a = session('a'), b = session('b'); b.cwd = '/other';
  a.consume(row(1001000, 'event_msg', { type: 'task_started' })); b.consume(row(1002000, 'event_msg', { type: 'task_started' }));
  assert.deepEqual(summarizeLatency([a, a, b], 'all', [], 1005000), { state: 'waiting', ms: 4000, requests: 2 });
  a.consume(row(1003000, 'response_item', { type: 'reasoning' })); b.consume(row(1003000, 'response_item', { type: 'reasoning' }));
  assert.deepEqual(summarizeLatency([a, a, b], 'all', [], 1005000), { state: 'observed', ms: 1500, requests: 2 });
  assert.equal(summarizeLatency([a, b], 'workspace', ['/project'], 1005000).ms, 2000);
  assert.equal(summarizeLatency([a, b], 'all', [], 1310000).state, 'unavailable');
  assert.equal(summarizeLatency([a, b], 'all', [], 1000000).state, 'unavailable');
});
