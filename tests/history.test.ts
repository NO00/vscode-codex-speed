import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageIndex } from '../src/history';
import { HistoryCacheStore } from '../src/history/cache';
import { rangeStart, summarize, usageRange, validTimeZone } from '../src/history/ranges';
import { UsageRecord } from '../src/history/types';
import { readHistoryFile, emptyFile } from '../src/history/reader';
import { MonitorOptions } from '../src/types';
import { row } from './helpers';

/** 每例使用独立数据源和扩展存储，绝不读取当前用户的真实日志。 */
async function temporary(run: (home: string, storage: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-history-'));
  const home = path.join(directory, 'codex'), storage = path.join(directory, 'extension-cache');
  await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
  try { await run(home, storage); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

/** 标准配置，历史范围不受实时发现天数影响。 */
function options(home: string): MonitorOptions { return { home, scanDays: 3, scope: 'all', workspaces: [], showEstimates: true, pollIntervalMs: 1000 }; }

/** 生成多天虚拟用量，单个文件可包含超过实时保留窗口的记录。 */
function fixture(id: string, times: number[], cwd = '/project'): string {
  return [row(Math.min(...times) - 3000, 'session_meta', { id, cwd }), ...times.flatMap((time, index) => [
    row(time - 1000, 'event_msg', { type: 'user_message', message: 'DO_NOT_CACHE_CONVERSATION' }),
    row(time, 'token_usage_record', { response_id: `${id}-${index}`, usage: { input_tokens: 1000, output_tokens: 100 } }),
    row(time + 1, 'event_msg', { type: 'task_complete' })
  ])].join('\n') + '\n';
}

/** 推进分批任务；上限防止实现错误导致测试无限等待。 */
async function settle(index: UsageIndex): Promise<void> {
  await index.refresh(true);
  for (let step = 0; index.status.indexing && step < 80; step++) await index.refresh();
  assert.equal(index.status.indexing, false, JSON.stringify(index.status));
}

test('今天按客户端时区划分，近七天和三十天采用滚动小时边界', () => {
  const now = Date.parse('2026-10-26T03:00:00Z');
  assert.equal(rangeStart('today', now, 'Asia/Shanghai'), Date.parse('2026-10-25T16:00:00Z'));
  assert.equal(rangeStart('today', now, 'UTC'), Date.parse('2026-10-26T00:00:00Z'));
  assert.equal(rangeStart('7d', now, 'Asia/Shanghai'), now - 7 * 86400000);
  assert.equal(rangeStart('30d', now, 'UTC'), now - 30 * 86400000);
  assert.equal(usageRange('invalid'), 'today'); assert.equal(validTimeZone('../../cache'), 'UTC');
});

test('日历零点正确跨过夏令时，今天不是固定向前二十四小时', () => {
  const before = rangeStart('today', Date.parse('2024-03-10T18:00:00Z'), 'America/New_York');
  const after = rangeStart('today', Date.parse('2024-03-11T18:00:00Z'), 'America/New_York');
  assert.equal(after - before, 23 * 3600000);
});

test('范围过滤、响应去重、未来记录和未知耗时保持正确', () => {
  const now = Date.parse('2026-10-26T03:00:00Z');
  const record: UsageRecord = { key: 'r', start: now - 2000, end: now - 1000, input: 900, output: 90, model: '', cwd: '/project', session: 'a' };
  const unknown = { ...record, key: 'unknown', start: undefined, output: 1000 };
  const future = { ...record, key: 'future', end: now + 1 };
  const result = summarize([record, { ...record }, unknown, future, { ...record, key: 'other', cwd: '/project-other' }], 'today', 'Asia/Shanghai', { scope: 'workspace', workspaces: ['/project'] }, now);
  assert.equal(result.output, 1090); assert.equal(result.average, 90); assert.equal(result.responses, 2);
});

test('首次回填跨多天、重启恢复、追加用量和记录隐私', async () => temporary(async (home, storage) => {
  const now = Date.now(), file = path.join(home, 'sessions', 'usage.jsonl');
  await fs.writeFile(file, fixture('a', [now - 20 * 86400000, now - 6 * 86400000, now - 3600000, now - 1000]));
  const index = new UsageIndex(home, storage, () => now);
  await settle(index);
  assert.equal(index.query('30m', 'UTC', options(home)).output, 100);
  assert.equal(index.query('7d', 'UTC', options(home)).output, 300);
  assert.equal(index.query('30d', 'UTC', options(home)).output, 400);
  await index.dispose();
  const cacheFile = (await fs.readdir(storage)).find(name => name.endsWith('.json'))!;
  const cache = await fs.readFile(path.join(storage, cacheFile), 'utf8');
  assert.ok(!cache.includes('DO_NOT_CACHE_CONVERSATION'));
  const original = await fs.readFile(file, 'utf8');
  const restored = new UsageIndex(home, storage, () => now);
  await settle(restored);
  assert.equal(restored.query('30d', 'UTC', options(home)).responses, 4);
  await fs.appendFile(file, row(now - 500, 'event_msg', { type: 'user_message' }) + '\n' + row(now, 'token_usage_record', { response_id: 'new', usage: { output_tokens: 50, input_tokens: 20 } }) + '\n');
  await settle(restored);
  assert.equal(restored.query('30d', 'UTC', options(home)).output, 450);
  assert.equal((await fs.readFile(file, 'utf8')).startsWith(original), true);
  await restored.dispose();
}));

test('工作区切换及多个数据目录的缓存相互隔离', async () => temporary(async (home, storage) => {
  const now = Date.now();
  await fs.writeFile(path.join(home, 'sessions', 'a.jsonl'), fixture('a', [now - 1000], '/project'));
  await fs.writeFile(path.join(home, 'sessions', 'b.jsonl'), fixture('b', [now - 1000], '/other'));
  const index = new UsageIndex(home, storage, () => now);
  await settle(index);
  assert.equal(index.query('today', 'UTC', { ...options(home), scope: 'workspace', workspaces: ['/project'] }).output, 100);
  assert.equal(index.query('today', 'UTC', options(home)).output, 200);
  await index.dispose();
  const second = path.join(home, 'second'); await fs.mkdir(path.join(second, 'sessions'), { recursive: true });
  const other = new UsageIndex(second, storage, () => now); await settle(other);
  assert.equal(other.query('30d', 'UTC', options(second)).output, 0); await other.dispose();
}));

test('JSON 半行不写入缓存，重启后从完整行边界继续', async () => temporary(async (home, storage) => {
  const now = Date.now(), file = path.join(home, 'sessions', 'a.jsonl');
  const first = fixture('a', [now - 1000]);
  const line = row(now, 'token_usage_record', { response_id: 'partial', usage: { output_tokens: 30 } });
  await fs.writeFile(file, first + line.slice(0, 30));
  const index = new UsageIndex(home, storage, () => now); await index.refresh(true);
  assert.equal(index.query('today', 'UTC', options(home)).output, 100); await index.dispose();
  await fs.appendFile(file, line.slice(30) + '\n');
  const restored = new UsageIndex(home, storage, () => now); await settle(restored);
  assert.equal(restored.query('today', 'UTC', options(home)).output, 130); await restored.dispose();
}));

test('完整历史读取不会受实时一千条和八 MiB 尾读限制', async () => temporary(async (home, storage) => {
  const now = Math.floor(Date.now() / 86400000) * 86400000 + 12 * 3600000, file = path.join(home, 'sessions', 'large.jsonl');
  const lines = fixture('large', Array.from({ length: 1100 }, (_, index) => now - 3600000 + index * 2000));
  await fs.writeFile(file, 'x'.repeat(9 * 1024 * 1024) + '\n' + lines);
  const index = new UsageIndex(home, storage, () => now); await settle(index);
  assert.equal(index.query('today', 'UTC', options(home)).responses, 1100); await index.dispose();
}));

test('文件截断后重新增长可由哈希识别，不保留旧文件的计数', async () => temporary(async (home, storage) => {
  const now = Date.now(), file = path.join(home, 'sessions', 'a.jsonl');
  await fs.writeFile(file, fixture('a', [now - 3000, now - 2000]));
  const index = new UsageIndex(home, storage, () => now); await settle(index);
  await fs.writeFile(file, fixture('replacement', [now - 1000]) + ' '.repeat(1000) + '\n');
  await settle(index);
  assert.equal(index.query('today', 'UTC', options(home)).output, 100); await index.dispose();
}));

test('损坏缓存安全回填，多窗口只允许一个写入者', async () => temporary(async (home, storage) => {
  const now = Date.now(); await fs.writeFile(path.join(home, 'sessions', 'a.jsonl'), fixture('a', [now - 1000]));
  const writer = new UsageIndex(home, storage, () => now); await settle(writer);
  const follower = new UsageIndex(home, storage, () => now); await follower.refresh();
  assert.equal(follower.status.follower, true); assert.equal(follower.query('today', 'UTC', options(home)).output, 100);
  await writer.dispose(); await follower.refresh(true);
  assert.equal(follower.status.follower, false); await follower.dispose();
  const file = (await fs.readdir(storage)).find(name => name.endsWith('.json'))!;
  await fs.writeFile(path.join(storage, file), '{corrupt');
  const recovered = new UsageIndex(home, storage, () => now); await settle(recovered);
  assert.equal(recovered.status.cacheReset, true); assert.equal(recovered.query('today', 'UTC', options(home)).output, 100); await recovered.dispose();
}));

test('旧累计计数的断点包含前值，恢复后不会再次计入累计总量', async () => temporary(async (home, storage) => {
  const now = Date.now(), file = path.join(home, 'sessions', 'legacy.jsonl');
  await fs.writeFile(file, row(now - 3000, 'session_meta', { id: 'legacy', cwd: '/project' }) + '\n' + row(now - 2000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } } }) + '\n');
  const first = new UsageIndex(home, storage, () => now); await settle(first); await first.dispose();
  await fs.appendFile(file, row(now - 1000, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 150, total_tokens: 1350 } } }) + '\n');
  const restored = new UsageIndex(home, storage, () => now); await settle(restored);
  assert.equal(restored.query('today', 'UTC', options(home)).output, 150); await restored.dispose();
}));

test('预算中止后保留完整行断点，重复读取不重复累加', async () => temporary(async home => {
  const now = Date.now(), file = path.join(home, 'sessions', 'budget.jsonl');
  await fs.writeFile(file, fixture('budget', [now - 2000, now - 1000]));
  const state = emptyFile(file);
  await readHistoryFile(state, 150, now - 30 * 86400000, 100);
  for (let index = 0; index < 10 && state.offset < state.size; index++) await readHistoryFile(state, 65536, now - 30 * 86400000, 100);
  assert.equal(state.records.length, 2);
  const offset = state.offset; assert.equal(await readHistoryFile(state, 65536, now - 30 * 86400000, 100), 0);
  assert.equal(state.offset, offset); assert.equal(state.records.length, 2);
}));

test('初次回填中停用会保存不完整状态，恢复后读完其余文件', async () => temporary(async (home, storage) => {
  const now = Date.now();
  for (let index = 0; index < 100; index++) await fs.writeFile(path.join(home, 'sessions', `${index}.jsonl`), fixture(`s-${index}`, [now - 1000]));
  const index = new UsageIndex(home, storage, () => now);
  await index.refresh(true); assert.equal(index.status.indexing, true); await index.pause();
  const store = new HistoryCacheStore(storage, path.resolve(home)); await store.load();
  assert.equal(store.complete, false);
  index.resume(); await settle(index);
  assert.equal(index.query('30d', 'UTC', options(home)).responses, 100); await index.dispose();
}));

test('无法写入扩展缓存时仍可读取日志，明确标记结果仅在内存中', async () => temporary(async (home, storage) => {
  const now = Date.now(); await fs.writeFile(storage, 'not a directory');
  await fs.writeFile(path.join(home, 'sessions', 'a.jsonl'), fixture('a', [now - 1000]));
  const index = new UsageIndex(home, storage, () => now); await settle(index);
  assert.equal(index.query('30d', 'UTC', options(home)).output, 100); assert.equal(index.status.cacheError, true); await index.dispose();
}));

test('缓存中的来源路径越过 sessions 根目录时丢弃并重建', async () => temporary(async (home, storage) => {
  await fs.mkdir(storage);
  const store = new HistoryCacheStore(storage, path.resolve(home));
  await fs.writeFile(store.file, JSON.stringify({ version: 1, home: path.resolve(home), complete: true, files: [emptyFile(path.join(home, 'outside.jsonl'))] }));
  assert.deepEqual(await store.load(), []); assert.equal(store.reset, true);
}));

test('没有新增记录或游标变化时不重写历史缓存', async () => temporary(async (home, storage) => {
  let now = Date.now(); await fs.writeFile(path.join(home, 'sessions', 'a.jsonl'), fixture('a', [now - 1000]));
  const index = new UsageIndex(home, storage, () => now); await settle(index);
  const cache = new HistoryCacheStore(storage, path.resolve(home));
  await fs.utimes(cache.file, new Date(now - 3600000), new Date(now - 3600000));
  const before = (await fs.stat(cache.file)).mtimeMs;
  now += 60000; await index.refresh();
  assert.equal((await fs.stat(cache.file)).mtimeMs, before); await index.dispose();
}));

test('建立锁时崩溃留下的过期空锁可以自动恢复', async () => temporary(async (home, storage) => {
  await fs.mkdir(storage);
  const cache = new HistoryCacheStore(storage, path.resolve(home)), lock = `${cache.file}.lock`;
  await fs.writeFile(lock, ''); await fs.utimes(lock, new Date(Date.now() - 120000), new Date(Date.now() - 120000));
  await cache.open(); await cache.claim();
  assert.equal(cache.owner, true); await cache.release();
}));
