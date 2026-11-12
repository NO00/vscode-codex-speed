import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readQuota, summarizeQuota } from '../../src/metrics/quota';
import { DashboardHistory } from '../../src/dashboard/model';
import { calculate } from '../../src/engine';
import { CodexParser } from '../../src/parser';
import { row, session } from '../helpers';

/** 完全虚拟的账户窗口，不读取用户凭证或真实日志。 */
const windows = { plan_type: 'pro', primary: { used_percent: 23.2, window_minutes: 299, resets_in_seconds: 120 }, secondary: { used_percent: 103, window_minutes: 10080, resets_at: 2000 } };

test('额度兼容旧重置字段和 299 分钟窗口，保存厂商百分比与明确零值', () => {
  const quota = readQuota({ ...windows, limit_id: 'codex' }, 1000000)!;
  assert.equal(quota.plan, 'pro');
  assert.deepEqual(quota.windows, [
    { kind: 'fiveHour', minutes: 300, usedPercent: 23.2, resetsAt: 1120000 },
    { kind: 'sevenDay', minutes: 10080, usedPercent: 103, resetsAt: 2000000 }
  ]);
  const zero = readQuota({ primary: { used_percent: 0, window_minutes: 1500, resets_at: 0 } }, 1000000)!;
  assert.deepEqual(zero.windows[0], { kind: 'other', minutes: 1500, usedPercent: 0, resetsAt: 0 });
});

test('空周期、其他额度桶和格式错误不替换快照，同类周期优先 primary', () => {
  for (const value of [null, [], {}, { limit_id: 'premium', ...windows }, { primary: { used_percent: '20', window_minutes: 300 } },
    { primary: { used_percent: Infinity, window_minutes: 300 } }, { primary: { used_percent: 20, window_minutes: 0 } }]) assert.equal(readQuota(value, 1000000), undefined);
  const quota = readQuota({ primary: windows.primary, secondary: { used_percent: 90, window_minutes: 300 } }, 1000000)!;
  assert.equal(quota.windows.length, 1); assert.equal(quota.windows[0]!.usedPercent, 23.2);
  assert.equal(readQuota({ primary: { used_percent: 20, window_minutes: 300, resets_at: 1e100 } }, 1000000)!.windows[0]!.resetsAt, undefined);
});

test('重复或缺少用量的 token_count 仍更新额度，坏行和旧快照不会覆盖', () => {
  const parser = session();
  parser.consume(row(1000100, 'event_msg', { type: 'token_count', rate_limits: windows }));
  assert.equal(parser.quota!.observed, 1000100); assert.equal(parser.samples.length, 0);
  parser.consume(row(1000200, 'token_usage_record', { response_id: 'one', usage: { output_tokens: 12 } }));
  parser.consume(row(1000300, 'event_msg', { type: 'token_count', rate_limits: { ...windows, plan_type: 'plus' } }));
  parser.consume(row(1000250, 'event_msg', { type: 'token_count', rate_limits: windows }));
  parser.consume(row(1000400, 'event_msg', { type: 'token_count', rate_limits: { primary: null, secondary: null } }));
  parser.consume('{bad json');
  assert.equal(parser.quota!.observed, 1000300); assert.equal(parser.quota!.plan, 'plus'); assert.equal(parser.samples.length, 1);
});

test('分页及时间戳继承的额度事件不进入子会话', () => {
  const parser = session();
  parser.consume(row(990000, 'event_msg', { type: 'token_count', rate_limits: windows }));
  assert.equal(parser.quota, undefined);
  // 使用全新解析器让第一个 session_meta 的序号边界真正生效。
  const paginated = new CodexParser('/virtual/child');
  paginated.consume(JSON.stringify({ timestamp: new Date(1000000).toISOString(), type: 'session_meta', payload: { id: 'child', subagent_history_start_ordinal: 5 } }));
  paginated.consume(JSON.stringify({ timestamp: new Date(1000100).toISOString(), ordinal: 1, type: 'event_msg', payload: { type: 'token_count', rate_limits: windows } }));
  assert.equal(paginated.quota, undefined);
});

test('账户额度选择全目录最近快照，不受工作区或用量周期影响，也不累计百分比', () => {
  const a = session('a'), b = session('b'); b.cwd = '/other';
  a.consume(row(1001000, 'event_msg', { type: 'token_count', rate_limits: windows }));
  b.consume(row(1002000, 'event_msg', { type: 'token_count', rate_limits: { ...windows, plan_type: 'plus' } }));
  const options = { home: '/virtual', scanDays: 3, pollIntervalMs: 500, scope: 'workspace' as const, workspaces: ['/project'], showEstimates: true };
  const data = new DashboardHistory().data([a, b], options, calculate([a, b], options, 1003000), 1003000);
  assert.equal(data.sessions.length, 1); assert.equal(data.quota.snapshot!.plan, 'plus');
  assert.equal(data.quota.snapshot!.windows[0]!.usedPercent, 23.2);
  assert.equal(summarizeQuota([a, b], 1001500).snapshot!.observed, 1001000, '未来快照不能抢占当前值');
});

test('旧快照保留并标记过期，跨越重置时刻不凭时钟猜测零用量', () => {
  const parser = session(); parser.consume(row(1001000, 'event_msg', { type: 'token_count', rate_limits: windows }));
  const summary = summarizeQuota([parser], 5000000);
  assert.equal(summary.state, 'stale'); assert.equal(summary.snapshot!.windows[0]!.usedPercent, 23.2);
  assert.deepEqual(summarizeQuota([], 5000000), { state: 'unavailable' });
});
