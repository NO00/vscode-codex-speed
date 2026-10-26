import { test } from 'node:test';
import assert from 'node:assert/strict';
import { row, session, response } from './helpers';

test('现代记录优先；兼容 token_count 镜像不重复累计或重复添加 reasoning', () => {
  const p = session();
  response(p, 1000100, 1001100, 80, 'same');
  p.consume(row(1001101, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 80, total_tokens: 1080 } } }));
  p.consume(row(1001102, 'token_usage_record', { response_id: 'same', usage: { output_tokens: 80 } }));
  assert.equal(p.samples.length, 1);
  assert.equal(p.samples[0]?.output, 80);
  assert.equal(p.samples[0]?.start, 1000100);
  assert.equal(p.phase, 'tools');
});

test('工具执行时间被排除，工具结果到达后为下一次请求重新计时', () => {
  const p = session();
  response(p, 1000000, 1001000, 100);
  p.consume(row(1010000, 'response_item', { type: 'function_call_output' }));
  p.consume(row(1010200, 'response_item', { type: 'reasoning' }));
  p.consume(row(1011000, 'token_usage_record', { response_id: 'second', usage: { output_tokens: 50 } }));
  assert.equal(p.samples[1]?.start, 1010000);
  p.consume(row(1011001, 'event_msg', { type: 'task_complete' }));
  assert.equal(p.phase, 'idle');
  assert.equal(p.pendingStart, undefined);
});

test('旧版累计差分、重复快照和计数回退均不造成大幅虚高', () => {
  const p = session();
  const usage = (time: number, total: number, output: number, lastOutput: number) => p.consume(row(time, 'event_msg', {
    type: 'token_count', info: { total_token_usage: { total_tokens: total, output_tokens: output, input_tokens: total - output }, last_token_usage: { output_tokens: lastOutput } }
  }));
  p.consume(row(1000100, 'event_msg', { type: 'task_started' }));
  usage(1001100, 10000, 500, 70);
  usage(1001101, 10000, 500, 70);
  p.consume(row(1002000, 'response_item', { type: 'function_call_output' }));
  usage(1003000, 11000, 650, 150);
  p.consume(row(1004000, 'event_msg', { type: 'user_message' }));
  usage(1005000, 300, 40, 40);
  assert.deepEqual(p.samples.map(s => s.output), [70, 150, 40]);
});

test('fork 复制历史、重复 session_meta、坏 JSON 与负用量均忽略', () => {
  const p = session('fork', 2000000);
  p.consume(row(1000000, 'session_meta', { id: 'parent', cwd: '/elsewhere' }));
  response(p, 1000001, 1001000, 999999);
  p.consume('not json');
  p.consume(JSON.stringify({ timestamp: 'bad', type: 'event_msg', payload: { type: 'task_started' } }));
  p.consume(row(2001000, 'token_usage_record', { usage: { output_tokens: -1 } }));
  assert.equal(p.id, 'fork');
  assert.equal(p.cwd, '/project');
  assert.equal(p.samples.length, 0);
});

test('从半截日志开始时缺失请求起点，不能编造实测耗时', () => {
  const p = session();
  p.consume(row(1005000, 'response_item', { type: 'message', role: 'assistant' }));
  p.consume(row(1005001, 'token_usage_record', { usage: { output_tokens: 1000 } }));
  assert.equal(p.samples[0]?.start, undefined);
});

test('生成中接收新输入不覆盖已经开始流式输出的请求起点，取消后空闲', () => {
  const p = session();
  p.consume(row(1000000, 'event_msg', { type: 'task_started' }));
  p.consume(row(1000500, 'response_item', { type: 'reasoning' }));
  p.consume(row(1000800, 'event_msg', { type: 'user_message' }));
  assert.equal(p.pendingStart, 1000000);
  p.consume(row(1001000, 'event_msg', { type: 'turn_aborted' }));
  assert.equal(p.phase, 'idle');
});
