import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TranscriptTailer } from '../src/tailer';
import { CodexMonitor } from '../src/monitor';
import { MonitorOptions } from '../src/types';
import { row } from './helpers';

/** 每个文件回放使用独立临时目录，测试结束只删除该明确目录。 */
async function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-speed-test-'));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

/** 生成与真实格式一致、内容完全虚拟的日志。 */
function fixture(now: number, id = 'a', output = 100): string {
  return [row(now - 3000, 'session_meta', { id, cwd: '/project' }), row(now - 2000, 'event_msg', { type: 'task_started' }), row(now, 'token_usage_record', { response_id: id, usage: { output_tokens: output } })].join('\n') + '\n';
}

test('追加 JSON 半行和跨字节中文正确合并，重复轮询不会重复计数', async () => temporary(async dir => {
  const file = path.join(dir, 'a.jsonl');
  const line = Buffer.from(row(1000000, 'session_meta', { id: 'a', cwd: '/项目' }) + '\n');
  const split = line.indexOf(Buffer.from('项')) + 1;
  await fs.writeFile(file, line.subarray(0, split));
  const tailer = new TranscriptTailer(file);
  await tailer.poll();
  assert.equal(tailer.parser.cwd, '');
  await fs.appendFile(file, line.subarray(split));
  await tailer.poll();
  assert.equal(tailer.parser.cwd, '/项目');
  await fs.appendFile(file, row(1001000, 'event_msg', { type: 'user_message' }) + '\n' + row(1002000, 'token_usage_record', { response_id: 'a', usage: { output_tokens: 80 } }) + '\n');
  await tailer.poll(); await tailer.poll();
  assert.equal(tailer.parser.samples.length, 1);
}));

test('文件截断和原子替换会丢弃旧状态并重读', async () => temporary(async dir => {
  const file = path.join(dir, 'a.jsonl');
  await fs.writeFile(file, fixture(1000000) + ' '.repeat(1000));
  const tailer = new TranscriptTailer(file);
  await tailer.poll();
  await fs.writeFile(file, fixture(1001000, 'b', 20));
  await tailer.poll();
  assert.equal(tailer.parser.id, 'b');
  assert.equal(tailer.parser.samples[0]?.output, 20);
  const other = path.join(dir, 'replacement.jsonl');
  await fs.writeFile(other, fixture(1002000, 'c', 30));
  await fs.rename(other, file);
  await tailer.poll();
  assert.equal(tailer.parser.id, 'c');
}));

test('超大单行被跳过，但后续用量仍被解析', async () => temporary(async dir => {
  const file = path.join(dir, 'a.jsonl');
  await fs.writeFile(file, 'x'.repeat(3 * 1024 * 1024) + '\n' + fixture(1000000));
  const tailer = new TranscriptTailer(file);
  await tailer.poll();
  assert.equal(tailer.parser.samples[0]?.output, 100);
}));

test('大文件从有界尾部启动且保留头部身份元数据', async () => temporary(async dir => {
  const file = path.join(dir, 'a.jsonl');
  const metadata = row(900000, 'session_meta', { id: 'large', cwd: '/project' }) + '\n';
  await fs.writeFile(file, metadata + 'x'.repeat(9 * 1024 * 1024) + '\n' + fixture(1000000, 'tail'));
  const tailer = new TranscriptTailer(file);
  await tailer.poll();
  assert.equal(tailer.parser.id, 'large');
  assert.equal(tailer.parser.samples[0]?.output, 100);
}));

test('监控集成：目录缺失后自动恢复、发现旧目录中的近期会话、读取追加、删除与停止', async () => temporary(async home => {
  let now = Date.now();
  const options: MonitorOptions = { home, scanDays: 3, scope: 'all', workspaces: [], showEstimates: true, pollIntervalMs: 500 };
  const logs: string[] = [];
  const monitor = new CodexMonitor(options, message => logs.push(message), () => now);
  assert.equal((await monitor.tick()).error, true);
  const directory = path.join(home, 'sessions', '2020', '01', '01');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'a.jsonl');
  await fs.writeFile(file, fixture(now));
  let state = await monitor.tick(true);
  assert.equal(state.error, false);
  assert.equal(state.snapshot.output, 100);
  assert.ok(Math.abs(state.snapshot.rate - 100 / 3) < 0.001);
  now += 5000;
  await fs.appendFile(file, row(now, 'response_item', { type: 'function_call_output' }) + '\n');
  state = await monitor.tick();
  assert.equal(state.snapshot.active, 1);
  now += 3000;
  assert.equal((await monitor.tick()).snapshot.kind, 'estimated');
  await fs.unlink(file);
  assert.equal((await monitor.tick()).snapshot.sessions, 0);
  monitor.dispose();
  await monitor.tick(true);
  assert.ok(logs.length > 0);
}));

test('默认不跟随目录符号链接，避免重复读取或越过扫描根目录', async t => temporary(async home => {
  const root = path.join(home, 'sessions');
  const outside = path.join(home, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'a.jsonl'), fixture(Date.now()));
  try { await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('当前用户无法创建符号链接'); return; }
  const monitor = new CodexMonitor({ home, scanDays: 3, scope: 'all', workspaces: [], showEstimates: true, pollIntervalMs: 1000 }, () => {});
  assert.equal((await monitor.tick()).snapshot.sessions, 0);
  monitor.dispose();
}));
