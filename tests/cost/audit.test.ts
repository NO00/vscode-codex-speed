import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../../src/cost/estimate';
import { createPriceBook, defaultPrices, findPrice } from '../../src/cost/catalog';
import { summarize } from '../../src/history/ranges';
import { CodexParser } from '../../src/parser';
import { UsageRecord } from '../../src/history/types';
import { row } from '../helpers';

/** 官方定价审计固定输入，金额期望独立于实现中的单价常量。 */
const now = Date.parse('2026-10-27T08:00:00Z');
/** 完整记录明确声明缓存写入为零，缺失该字段的反例另行覆盖。 */
function record(changes: Partial<UsageRecord> = {}): UsageRecord {
  return { key: 'response', start: now - 2000, end: now - 1000, input: 100000, inputKnown: true, cachedInput: 80000, cacheWriteInput: 0,
    output: 10000, model: 'gpt-6.1-sol', cwd: '/project', session: 'session', ...changes };
}
/** 金额断言保留计算精度，显示舍入不参与定价。 */
function money(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`); }

test('官方标准价格独立算例覆盖六个模型的短上下文和长上下文', () => {
  // 短请求为 2 万普通输入、8 万缓存读取、1 万输出；长请求为 10 万普通输入、20 万缓存读取、1 万输出。
  for (const [model, short, long] of [
    ['gpt-6-astra', .78, 3.15], ['gpt-6.1-sol', .148, .59], ['gpt-6.1-terra', .074, .295],
    ['gpt-6-luna', .0078, .0315], ['gpt-5.6-sol', .312, 1.26], ['gpt-5.3-codex', .189, .35]
  ] as const) {
    money(estimateCost([record({ model })]).usd, short);
    money(estimateCost([record({ model, input: 300000, cachedInput: 200000 })]).usd, long);
  }
});

test('缺失缓存写入数不能冒充明确为零，普通输入费用保持未知', () => {
  const result = estimateCost([record({ cacheWriteInput: undefined })]);
  assert.equal(result.complete, 0);
  assert.equal(result.ordinary.pricedTokens, 0);
  money(result.usd, .108); // 只确定 8 万缓存读取和 1 万输出。
  assert.equal(result.missingWrites, 1); assert.equal(result.unknownInput, 20000);
});

test('没有写入计价的模型、全缓存输入和显式零输入可确定零写入', () => {
  const old = estimateCost([record({ model: 'gpt-5.3-codex', cacheWriteInput: undefined })]);
  assert.equal(old.complete, 1); money(old.usd, .189);
  const cached = estimateCost([record({ input: 80000, cacheWriteInput: undefined })]);
  assert.equal(cached.complete, 1); money(cached.usd, .108);
  const zero = estimateCost([record({ input: 0, cachedInput: undefined, cacheWriteInput: undefined })]);
  assert.equal(zero.complete, 1); money(zero.usd, .1);
  const configured = createPriceBook({ private: { input: 2, cachedInput: .1, output: 10, cacheWrites: false } });
  const custom = estimateCost([record({ model: 'private', cacheWriteInput: undefined })], configured);
  assert.equal(custom.complete, 1); money(custom.usd, .148);
});

test('镜像显式零输入补齐后可计输出，缺失输入占位不阻止完整用量覆盖', () => {
  const complete = record({ input: 0, cachedInput: 0 });
  const unknown = { ...complete, inputKnown: false, cachedInput: undefined, cacheWriteInput: undefined };
  for (const records of [[unknown, complete], [complete, unknown]]) {
    const totals = summarize(records, 'today', 'UTC', { scope: 'all', workspaces: [] }, now);
    assert.equal(totals.responses, 1); assert.equal(totals.cost.complete, 1); money(totals.cost.usd, .1);
  }
  const contradictory = { ...unknown, cachedInput: 80, cacheWriteInput: 20 };
  const corrected = summarize([contradictory, complete], 'today', 'UTC', { scope: 'all', workspaces: [] }, now);
  assert.equal(corrected.cost.complete, 1); money(corrected.cost.usd, .1);
  const full = record(), missing = { ...unknown, model: '' };
  for (const records of [[missing, full], [full, missing]]) {
    const totals = summarize(records, 'today', 'UTC', { scope: 'all', workspaces: [] }, now);
    assert.equal(totals.input, 100000); assert.equal(totals.cost.complete, 1); money(totals.cost.usd, .148);
  }
});

test('未经官方确认的日期型号不会直接套用基础型号价格', () => {
  assert.equal(findPrice('gpt-6.1-sol-1900-99-99', defaultPrices).source, 'unknown');
  assert.equal(findPrice('gpt-5.6', defaultPrices).price?.input, 4);
});

test('累计计数未增加时也应推进缓存基线，避免下次缓存读取被重复差分', () => {
  const parser = new CodexParser('/fixture');
  parser.consume(row(now - 4000, 'turn_context', { model: 'gpt-6.1-sol' }));
  for (const [offset, input, output, cached] of [[3000, 100, 10, undefined], [2000, 100, 10, 80], [1000, 200, 20, 160]] as const) {
    parser.consume(row(now - offset, 'event_msg', { type: 'token_count', info: { total_token_usage: {
      input_tokens: input, cached_input_tokens: cached, cache_write_tokens: 0, output_tokens: output, total_tokens: input + output
    } } }));
  }
  assert.equal(parser.samples.length, 2); assert.equal(parser.samples[1]!.cachedInput, 80);
});
