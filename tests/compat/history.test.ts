import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageIndex } from '../../src/history';
import { HistoryCacheStore } from '../../src/history/cache';
import { emptyFile, readHistoryFile } from '../../src/history/reader';
import { IndexedFile } from '../../src/history/types';
import { MonitorOptions } from '../../src/types';
import { fixture } from './fixtures';
import { TranscriptTailer } from '../../src/tailer';

/** 固定查询时钟，样例始终落在三十天窗口内，不依赖测试运行日期。 */
const now = Date.parse('2026-10-21T00:00:00Z');
/** 每例只创建并清理自身临时目录。 */
async function temporary(run: (home: string, storage: string, file: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-compat-'));
  const home = path.join(root, 'codex'), storage = path.join(root, 'cache'), file = path.join(home, 'sessions', 'test.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await run(home, storage, file); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
/** 最小完整监控配置。 */
function options(home: string): MonitorOptions { return { home, scope: 'all', workspaces: [], scanDays: 3, pollIntervalMs: 500, showEstimates: true }; }
/** 在已有文件断点上构造旧版误计的四条响应，不执行旧版程序。 */
function oldCounts(state: IndexedFile): void {
  Reflect.deleteProperty(state, 'analysisVersion');
  Reflect.deleteProperty(state.parser, 'subagentStartOrdinal'); Reflect.deleteProperty(state.parser, 'agentPath');
  state.records = [200, 330, 90, 40].map((output, index) => ({ key: `legacy-cache-${index}`, start: now - 10000, end: now - 9000 + index,
    input: 1000, inputKnown: true, cachedInput: 800, output, model: 'gpt-6.1-sol', cwd: '/project', session: 'thread-pag' }));
}
/** 模拟旧版本退出时已经写入一份追上 EOF 的缓存。 */
async function saveOld(home: string, storage: string, state: IndexedFile): Promise<void> {
  const store = new HistoryCacheStore(storage, path.resolve(home));
  await store.open(); try { await store.save([state], true); } finally { await store.release(); }
}
/** 推进现有后台预算，防止错误实现造成无限测试。 */
async function settle(index: UsageIndex): Promise<void> {
  await index.refresh(true);
  for (let step = 0; index.status.indexing && step < 20; step++) await index.refresh();
  assert.equal(index.status.indexing, false);
}

test('追上 EOF 的旧分页缓存重新核算并删除继承记录，重启不重复计入', async () => temporary(async (home, storage, file) => {
  await fs.writeFile(file, fixture('paginated').join('\n') + '\n');
  const state = emptyFile(file); await readHistoryFile(state, 65536, 0, 1000); oldCounts(state); await saveOld(home, storage, state);
  const index = new UsageIndex(home, storage, () => now);
  try {
    await settle(index); const totals = index.query('30d', 'UTC', options(home));
    assert.equal(totals.responses, 2); assert.equal(totals.output, 130); assert.equal(totals.input, 14300);
  } finally { await index.dispose(); }
  const store = new HistoryCacheStore(storage, path.resolve(home)), saved = (await store.load())[0]!;
  assert.equal(Reflect.get(saved, 'analysisVersion'), 2); assert.equal(saved.records.length, 2);
  const restored = new UsageIndex(home, storage, () => now);
  try { await settle(restored); assert.equal(restored.query('30d', 'UTC', options(home)).output, 130); }
  finally { await restored.dispose(); }
}));

test('旧费用缓存回填原生写入数，明确零值恢复普通输入费用', async () => temporary(async (home, storage, file) => {
  await fs.writeFile(file, fixture('modern').join('\n') + '\n');
  const state = emptyFile(file); await readHistoryFile(state, 65536, 0, 1000);
  Reflect.deleteProperty(state, 'analysisVersion'); for (const record of state.records) delete record.cacheWriteInput;
  await saveOld(home, storage, state);
  const index = new UsageIndex(home, storage, () => now);
  try { await settle(index); const totals = index.query('30d', 'UTC', options(home)); assert.equal(totals.cost.complete, 2); assert.ok(Math.abs(totals.cost.usd - .0119) < 1e-10); }
  finally { await index.dispose(); }
}));

test('重算大文件遵守字节预算，暂停并恢复仍保留序号边界', async () => temporary(async (home, storage, file) => {
  await fs.writeFile(file, 'x'.repeat(9 * 1024 * 1024) + '\n' + fixture('paginated').join('\n') + '\n');
  const state = emptyFile(file); await readHistoryFile(state, 16 * 1024 * 1024, 0, 1000); oldCounts(state); await saveOld(home, storage, state);
  const first = new UsageIndex(home, storage, () => now);
  await first.refresh(true); assert.equal(first.status.indexing, true); await first.pause(); await first.dispose();
  const restored = new UsageIndex(home, storage, () => now);
  try { await settle(restored); assert.equal(restored.query('30d', 'UTC', options(home)).output, 130); }
  finally { await restored.dispose(); }
}));

test('已删除源日志的旧缓存保留计数，并明确提示无法确认已重算', async () => temporary(async (home, storage, file) => {
  await fs.writeFile(file, fixture('paginated').join('\n') + '\n');
  const state = emptyFile(file); await readHistoryFile(state, 65536, 0, 1000); oldCounts(state); await saveOld(home, storage, state); await fs.unlink(file);
  const index = new UsageIndex(home, storage, () => now);
  try { await settle(index); assert.equal(index.query('30d', 'UTC', options(home)).output, 660); assert.equal(Reflect.get(index.status, 'unverifiedFiles'), 1); }
  finally { await index.dispose(); }
}));

test('回填已满的旧文件时先释放其旧计数容量，不因剩余空间零而跳过重算', async () => temporary(async (_home, _storage, file) => {
  await fs.writeFile(file, fixture('paginated').join('\n') + '\n');
  const state = emptyFile(file); await readHistoryFile(state, 65536, 0, 1000); oldCounts(state);
  await readHistoryFile(state, 65536, 0, 0);
  assert.equal(state.records.length, 2); assert.equal(state.records.reduce((sum, record) => sum + record.output, 0), 130);
}));

test('大文件尾读由文件头恢复分页边界，跳过截断区间内的复制用量', async () => temporary(async (_home, _storage, file) => {
  const lines = fixture('paginated');
  await fs.writeFile(file, lines[0] + '\n' + 'x'.repeat(9 * 1024 * 1024) + '\n' + lines.slice(1).join('\n') + '\n');
  const tailer = new TranscriptTailer(file); await tailer.poll();
  assert.equal(tailer.parser.samples.length, 2); assert.equal(tailer.parser.samples.reduce((sum, sample) => sum + sample.output, 0), 130);
}));
