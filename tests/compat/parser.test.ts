import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexParser } from '../../src/parser';
import { estimateCost } from '../../src/cost/estimate';
import { sampleRate } from '../../src/engine';
import { row } from '../helpers';
import { fixture } from './fixtures';

/** 回放不接触真实用户目录。 */
function replay(lines: string[]): CodexParser { const parser = new CodexParser('/fixture'); for (const line of lines) parser.consume(line); return parser; }

test('分页子会话跳过父历史，真实输出为两条响应及 130 token', () => {
  const lines = fixture('paginated'), parser = replay(lines);
  assert.equal(parser.samples.length, 2); assert.equal(parser.samples.reduce((sum, sample) => sum + sample.output, 0), 130);
  assert.deepEqual(parser.samples.map(sample => sample.key), ['resp-p1', 'resp-p2']);
  const inherited = replay(lines.slice(0, 15));
  assert.equal(inherited.samples.length, 0); assert.equal(inherited.phase, 'idle');
  assert.equal(inherited.model, '未知模型'); assert.equal(inherited.pendingStart, undefined);
});

test('原生写入字段明确零值可完整计价，API 字段仍兼容且不重复计算', () => {
  const parser = replay(fixture('modern'));
  assert.deepEqual(parser.samples.map(sample => sample.cacheWriteInput), [0, 0]);
  const cost = estimateCost(parser.samples); assert.equal(cost.complete, 2); assert.ok(Math.abs(cost.usd - .0119) < 1e-10);
  const p = new CodexParser('/native');
  p.consume(row(1000, 'token_usage_record', { response_id: 'native', usage: { input_tokens: 100, cached_input_tokens: 50, cache_write_input_tokens: 0, cache_write_tokens: 20, output_tokens: 10 } }));
  p.consume(row(2000, 'token_usage_record', { response_id: 'api', usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 20 }, output_tokens: 10 } }));
  assert.deepEqual(p.samples.map(sample => sample.cacheWriteInput), [0, 20]);
});

test('原生缓存写入累计值在检查点恢复后差分，重置采用 last 用量', () => {
  const p = new CodexParser('/legacy');
  p.consume(row(1000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 30, output_tokens: 10, total_tokens: 110 } } }));
  const next = new CodexParser('/legacy'); next.restore(JSON.parse(JSON.stringify(p.checkpoint())));
  next.consume(row(2000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 100, cache_write_input_tokens: 50, output_tokens: 30, total_tokens: 230 } } }));
  next.consume(row(3000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 80, cached_input_tokens: 20, cache_write_input_tokens: 10, output_tokens: 5, total_tokens: 85 }, last_token_usage: { input_tokens: 80, cached_input_tokens: 20, cache_write_input_tokens: 10, output_tokens: 5 } } }));
  assert.deepEqual([...p.samples, ...next.samples].map(sample => sample.cacheWriteInput), [30, 20, 10]);
});

test('邮箱只更新发给当前 agent 的请求起点，不唤醒空闲或覆盖流式起点', () => {
  const parser = replay(fixture('subagent'));
  assert.deepEqual(parser.samples.map(sample => sample.start), [Date.parse('2026-10-20T10:00:21Z'), Date.parse('2026-10-20T10:00:40Z')]);
  assert.equal(sampleRate(parser.samples[0]!), 40); assert.ok(Math.abs(sampleRate(parser.samples[1]!) - 60 / 7) < 1e-10);
  const p = new CodexParser('/mail');
  p.consume(row(1000, 'session_meta', { id: 'worker', agent_path: '/root/worker' }));
  p.consume(row(2000, 'response_item', { type: 'agent_message', recipient: '/root', author: '/root/worker' }));
  assert.equal(p.pendingStart, undefined);
  p.consume(row(3000, 'response_item', { type: 'agent_message', recipient: '/root/worker' }));
  assert.equal(p.pendingStart, 3000); assert.equal(p.phase, 'idle');
  p.consume(row(4000, 'response_item', { type: 'reasoning' }));
  p.consume(row(5000, 'response_item', { type: 'agent_message', recipient: '/root/worker' }));
  assert.equal(p.pendingStart, 3000);
});

/** 在原始 JSON 中构造序号字面量，避免 JSON.stringify 将 1.0／1e0 折叠成整数。 */
function literal(time: number, type: string, payload: string, ordinal?: string): string {
  return `{"timestamp":"${new Date(time).toISOString()}","type":"${type}","payload":${payload}${ordinal === undefined ? '' : `,"ordinal":${ordinal}`}}`;
}

test('序号严格按每行字面量判断，坏行及错误序号不能移动过滤边界', () => {
  const meta = literal(1000, 'session_meta', '{"id":"child","subagent_history_start_ordinal":3}');
  for (const ordinal of ['null', '"1"', '1.0', '1e0', '-1', '9223372036854775808', undefined]) {
    const p = replay([meta, '{invalid json', literal(2000, 'token_usage_record', '{"usage":{"output_tokens":10}}', ordinal)]);
    assert.equal(p.samples.length, 1, `非序号 ${ordinal} 不应命中边界`);
  }
  const p = replay([meta, literal(2000, 'token_usage_record', '{"usage":{"output_tokens":100}}', '2'),
    '{invalid json', literal(3000, 'token_usage_record', '{"usage":{"output_tokens":10}}', '3')]);
  assert.equal(p.samples.length, 1); assert.equal(p.samples[0]!.output, 10);
  for (const boundary of ['null', '"3"', '3.0', '3e0', '-1', '9223372036854775808']) {
    const parser = replay([literal(1000, 'session_meta', `{"subagent_history_start_ordinal":${boundary}}`), literal(2000, 'token_usage_record', '{"usage":{"output_tokens":10}}', '0')]);
    assert.equal(parser.samples.length, 1, `无效边界 ${boundary} 不应过滤`);
  }
});

test('64 位序号不会被 JavaScript 舍入，断点及大文件头部种子保留边界和邮箱地址', () => {
  const p = new CodexParser('/large');
  p.seedMetadata(literal(1000, 'session_meta', '{"id":"child","agent_path":"/root/worker","subagent_history_start_ordinal":9223372036854775807}'));
  const restored = new CodexParser('/large'); restored.restore(JSON.parse(JSON.stringify(p.checkpoint())));
  restored.consume(literal(2000, 'token_usage_record', '{"usage":{"output_tokens":100}}', '9223372036854775806'));
  assert.equal(restored.samples.length, 0);
  restored.consume(literal(3000, 'response_item', '{"type":"agent_message","recipient":"/root/worker"}', '9223372036854775807'));
  assert.equal(restored.pendingStart, 3000); assert.equal(restored.phase, 'idle');
});

test('序号只读取正确层级，支持转义字段名和重复键的最后有效值', () => {
  const meta = literal(1000, 'session_meta', '{"subagent_history_start_ordinal":3}');
  const p = replay([meta, literal(2000, 'token_usage_record', '{"ordinal":0,"usage":{"output_tokens":10}}', '3')]);
  assert.equal(p.samples.length, 1);
  const escaped = meta.replace('subagent_history_start_ordinal', 'subagent_history_start_ordin\\u0061l');
  const inherited = literal(2000, 'token_usage_record', '{"usage":{"output_tokens":10}}', '1').replace('"ordinal":1', '"ord\\u0069nal":1');
  assert.equal(replay([escaped, inherited]).samples.length, 0);
  const duplicate = inherited.replace('"ord\\u0069nal":1', '"ordinal":1,"ordinal":3');
  assert.equal(replay([meta, duplicate]).samples.length, 1);
});
