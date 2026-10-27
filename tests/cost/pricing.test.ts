import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { estimateCost } from '../../src/cost/estimate';
import { createPriceBook, defaultPrices, findPrice } from '../../src/cost/catalog';
import { CodexParser } from '../../src/parser';
import { summarize } from '../../src/history/ranges';
import { UsageIndex } from '../../src/history';
import { HistoryCacheStore } from '../../src/history/cache';
import { emptyFile, readHistoryFile } from '../../src/history/reader';
import { MonitorOptions, Sample } from '../../src/types';
import { UsageRecord } from '../../src/history/types';
import { row } from '../helpers';

/** 计价测试使用固定时钟和明确的缓存拆分，不依赖用户日志。 */
const now = Date.parse('2026-10-27T08:00:00Z');
/** 所有数值都取自虚拟记录，可按需求覆盖字段制造缺失或边界。 */
function sample(changes: Partial<Sample> = {}): Sample {
  return { key: 'r', start: now - 2000, end: now - 1000, input: 100000, inputKnown: true, cachedInput: 80000, cacheWriteInput: 0, output: 10000, model: 'gpt-6.1-sol', ...changes };
}
/** 金额保留完整浮点精度，只在显示时舍入。 */
function near(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`); }

test('普通输入先减去缓存输入，再分别乘以模型单价，reasoning 不再重复相加', () => {
  const result = estimateCost([sample()]);
  near(result.ordinary.usd, .04); near(result.cached.usd, .008); near(result.output.usd, .1); near(result.usd, .148);
  assert.equal(result.complete, 1); assert.equal(result.ordinary.tokens, 20000); assert.equal(result.cached.tokens, 80000);
});

test('多模型各自计价，未核实的日期、相似名称或服务档位后缀不猜价格', () => {
  near(estimateCost([sample(), sample({ key: 'b', model: 'gpt-6-astra' })]).usd, .928);
  assert.equal(findPrice('gpt-6.1-sol-2026-10-20', defaultPrices).source, 'unknown');
  assert.equal(findPrice('gpt-6.1-sol-fast', defaultPrices).source, 'unknown');
  assert.equal(findPrice('toString', defaultPrices).source, 'unknown');
});

test('272K 阈值严格按单次输入总量判断，全请求的三项分别乘长上下文倍率', () => {
  const normal = estimateCost([sample({ input: 272000, cachedInput: 200000 })]);
  near(normal.usd, .144 + .02 + .1);
  const long = estimateCost([sample({ input: 272001, cachedInput: 200000 })]);
  near(long.usd, 72001 * 4 / 1000000 + .04 + .15);
  assert.equal(long.models[0]!.longContextResponses, 1);
  assert.equal(estimateCost([sample(), sample({ key: 'b' }), sample({ key: 'c' })]).models[0]!.longContextResponses, 0);
});

test('未知模型不按零价展示，缺失或错误缓存拆分只计算确定的输出费用', () => {
  const unknown = estimateCost([sample({ model: 'private-model' })]);
  assert.equal(unknown.complete, 0); assert.equal(unknown.output.pricedTokens, 0); assert.equal(unknown.models[0]!.source, 'unknown');
  for (const cachedInput of [undefined, 100001]) {
    const partial = estimateCost([sample({ cachedInput })]);
    near(partial.usd, .1); assert.equal(partial.complete, 0); assert.equal(partial.unknownInput, 100000);
  }
  const absent = estimateCost([sample({ input: 0, inputKnown: false, cachedInput: undefined })]);
  assert.equal(absent.missingInput, 1); assert.equal(absent.output.pricedTokens, 0);
  const zero = estimateCost([sample({ input: 0, cachedInput: undefined })]);
  assert.equal(zero.complete, 1); near(zero.usd, .1);
});

test('缓存写入单独排除，不重复当作普通输入，费用标为部分估算', () => {
  const cost = estimateCost([sample({ cacheWriteInput: 10000 })]);
  near(cost.ordinary.usd, .02); near(cost.usd, .128); assert.equal(cost.cacheWrites, 10000); assert.equal(cost.complete, 0);
});

test('用户模型覆盖支持零价和长上下文，非法覆盖不静默回退到内置单价', () => {
  const prices = createPriceBook({ 'gpt-6.1-sol': { input: 3, cachedInput: .5, output: 12 }, free: { input: 0, cachedInput: 0, output: 0 } });
  near(estimateCost([sample()], prices).usd, .06 + .04 + .12);
  assert.equal(estimateCost([sample()], prices).models[0]!.source, 'custom');
  const inherited = estimateCost([sample({ input: 300000, cachedInput: 200000 })], prices);
  near(inherited.usd, .6 + .2 + .18); assert.equal(inherited.models[0]!.longContextResponses, 1);
  const free = estimateCost([sample({ model: 'free' })], prices); assert.equal(free.complete, 1); assert.equal(free.usd, 0);
  for (const value of [{ input: -1, cachedInput: 0, output: 1 }, { input: 1, output: 1 }, { input: Infinity, cachedInput: 0, output: 1 },
    { input: 1, cachedInput: 1, output: 1, longContext: { threshold: -1, input: 2, cachedInput: 2, output: 1.5 } }]) {
    assert.equal(estimateCost([sample()], createPriceBook({ 'gpt-6.1-sol': value })).models[0]!.source, 'unknown');
  }
  const custom = createPriceBook({ mine: { input: 1, cachedInput: 1, output: 1, longContext: { threshold: 50000, input: 3, cachedInput: 2, output: 4 } } });
  near(estimateCost([sample({ model: 'mine' })], custom).usd, .06 + .16 + .04);
});

test('极小调用费用不逐条舍入为零，已完成零输出仍正常计输入费用', () => {
  const result = estimateCost(Array.from({ length: 1000 }, (_, index) => sample({ key: String(index), input: 1, cachedInput: 0, output: 0 })));
  near(result.usd, .002); assert.equal(result.complete, 1000);
});

test('现代日志保存每次响应模型，兼容扁平缓存和 API 详情字段，不改变原始总量', () => {
  const parser = new CodexParser('/fixture');
  parser.consume(row(now - 3000, 'turn_context', { model: 'gpt-6-astra' }));
  parser.consume(row(now - 2000, 'token_usage_record', { response_id: 'a', model: 'gpt-6.1-sol', usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 80 } }));
  parser.consume(row(now - 1000, 'token_usage_record', { response_id: 'b', usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 20 } } }));
  parser.consume(row(now, 'token_usage_record', { response_id: 'c', usage: { output_tokens: 10 } }));
  assert.equal(parser.samples[0]!.model, 'gpt-6.1-sol'); assert.equal(parser.samples[0]!.cachedInput, 80);
  assert.equal(parser.samples[1]!.model, 'gpt-6-astra'); assert.equal(parser.samples[1]!.input, 100); assert.equal(parser.samples[1]!.cachedInput, 50);
  assert.equal(parser.samples[1]!.cacheWriteInput, 20); assert.equal(parser.samples[2]!.inputKnown, false);
});

test('旧版缓存计数差分在检查点恢复后连续，重复累计快照不重复计费', () => {
  const first = new CodexParser('/fixture');
  first.consume(row(now - 3000, 'turn_context', { model: 'gpt-6.1-sol' }));
  first.consume(row(now - 2000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 80, cache_write_tokens: 0, output_tokens: 10, total_tokens: 110 } } }));
  const restored = new CodexParser('/fixture'); restored.restore(first.checkpoint());
  const next = row(now - 1000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 250, cached_input_tokens: 180, cache_write_tokens: 0, output_tokens: 30, total_tokens: 280 } } });
  restored.consume(next); restored.consume(next);
  assert.equal(restored.samples.length, 1); assert.equal(restored.samples[0]!.input, 150); assert.equal(restored.samples[0]!.cachedInput, 100);
  near(estimateCost([...first.samples, ...restored.samples]).usd, 70 * 2 / 1000000 + 180 * .1 / 1000000 + 30 * 10 / 1000000);
});

test('旧版缓存累计缺失时不假定零，回退到匹配当前增量的 last 缓存明细', () => {
  const parser = new CodexParser('/fixture');
  parser.consume(row(now - 2000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } }));
  parser.consume(row(now - 1000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 }, last_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 60 } } }));
  assert.equal(parser.samples[0]!.cachedInput, undefined); assert.equal(parser.samples[1]!.cachedInput, 60);
});

test('缺失输入累计值跨检查点恢复后仍未知，计数重置采用 last 的缓存明细', () => {
  const first = new CodexParser('/fixture');
  first.consume(row(now - 3000, 'event_msg', { type: 'token_count', info: { total_token_usage: { output_tokens: 10, total_tokens: 10 } } }));
  const restored = new CodexParser('/fixture'); restored.restore(first.checkpoint());
  restored.consume(row(now - 2000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120 } } }));
  assert.equal(restored.samples[0]!.inputKnown, false);
  restored.consume(row(now - 1000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 30, output_tokens: 5, total_tokens: 55 },
    last_token_usage: { input_tokens: 50, cached_input_tokens: 30, output_tokens: 5 } } }));
  assert.equal(restored.samples[1]!.input, 50); assert.equal(restored.samples[1]!.cachedInput, 30);
});

test('费用和统计共用时间、工作区及响应去重，实时镜像补齐历史元数据', () => {
  const record: UsageRecord = { ...sample(), cwd: '/project', session: 'a' };
  const old = { ...record, model: '', cachedInput: undefined, inputKnown: undefined };
  const result = summarize([old, record, { ...record }, { ...record, key: 'outside', cwd: '/other' }, { ...record, key: 'old', end: now - 31 * 86400000 },
    { ...record, key: 'future', end: now + 1 }], '30d', 'UTC', { scope: 'workspace', workspaces: ['/project'] }, now);
  assert.equal(result.responses, 1); assert.equal(result.cost.complete, 1); near(result.cost.usd, .148);
});

test('历史超过实时去重容量后再次出现同一响应，保留原始时间和计价一次', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cost-duplicate-')), file = path.join(root, 'a.jsonl');
  try {
    const lines = Array.from({ length: 1002 }, (_, index) => row(now - 20000 + index, 'token_usage_record', {
      response_id: `r-${index}`, model: 'gpt-6.1-sol', usage: { input_tokens: 100, cached_input_tokens: 80, cache_write_tokens: 0, output_tokens: 10 }
    }));
    await fs.writeFile(file, [row(now - 21000, 'event_msg', { type: 'user_message' }), ...lines,
      row(now - 1000, 'token_usage_record', { response_id: 'r-0', model: 'gpt-6.1-sol', usage: { input_tokens: 100, cached_input_tokens: 80, cache_write_tokens: 0, output_tokens: 10 } })].join('\n') + '\n');
    const state = emptyFile(file); await readHistoryFile(state, 4 * 1024 * 1024, now - 86400000, 10000);
    assert.equal(state.records.length, 1002); assert.equal(state.records[0]!.end, now - 20000);
    const cost = estimateCost(state.records); assert.equal(cost.complete, 1002); near(cost.usd, .000148 * 1002);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('旧缓存费用元数据按预算回填，原统计不丢失且不重复，改价无需重读日志', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cost-'));
  const home = path.join(root, 'codex'), storage = path.join(root, 'cache'), file = path.join(home, 'sessions', 'a.jsonl');
  const options: MonitorOptions = { home, scope: 'all', workspaces: [], scanDays: 3, pollIntervalMs: 1000, showEstimates: true };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, [row(now - 5000, 'session_meta', { id: 'a', cwd: '/project' }), row(now - 4000, 'turn_context', { model: 'gpt-6.1-sol' }),
      row(now - 1000, 'token_usage_record', { response_id: 'r', usage: { input_tokens: 100000, cached_input_tokens: 80000, cache_write_tokens: 0, output_tokens: 10000 } })].join('\n') + '\n');
    const state = emptyFile(file); await readHistoryFile(state, 65536, now - 86400000, 100);
    delete state.costVersion; state.records[0]!.model = ''; delete state.records[0]!.cachedInput; delete state.records[0]!.inputKnown;
    const store = new HistoryCacheStore(storage, path.resolve(home)); await store.open(); await store.save([state], true); await store.release();
    const index = new UsageIndex(home, storage, () => now);
    try {
      await index.refresh(true);
      const totals = index.query('today', 'UTC', options);
      assert.equal(totals.responses, 1); assert.equal(totals.cost.complete, 1); near(totals.cost.usd, .148);
      const prices = createPriceBook({ 'gpt-6.1-sol': { input: 0, cachedInput: 0, output: 0 } });
      assert.equal(index.query('today', 'UTC', options, [], prices).cost.usd, 0);
      near(index.query('today', 'UTC', options).cost.usd, .148);
    } finally { await index.dispose(); }
    const reloaded = new HistoryCacheStore(storage, path.resolve(home)), cached = await reloaded.load();
    assert.equal(cached[0]!.costVersion, 1); assert.equal(cached[0]!.records[0]!.cachedInput, 80000);
    // 已删除来源的旧记录仍保留用量，不能为补价格而清空原统计。
    delete cached[0]!.costVersion; cached[0]!.records[0]!.model = ''; delete cached[0]!.records[0]!.cachedInput;
    await reloaded.open(); await reloaded.save(cached, true); await reloaded.release(); await fs.unlink(file);
    const missing = new UsageIndex(home, storage, () => now);
    try { await missing.refresh(true); const result = missing.query('today', 'UTC', options); assert.equal(result.responses, 1); assert.equal(result.cost.complete, 0); }
    finally { await missing.dispose(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
