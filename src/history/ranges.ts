import { inWorkspace, measured, sampleDuration } from '../engine';
import { MonitorOptions } from '../types';
import { UsageRange, UsageRecord, UsageSummary } from './types';

/** 配置和 Webview 消息都只能选择既定时间范围。 */
export function usageRange(value: unknown): UsageRange { return value === '30m' || value === '7d' || value === '30d' ? value : 'today'; }

/** 校验客户端时区，拒绝任意路径或不可识别字符串，使用显式 UTC 回退。 */
export function validTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) return 'UTC';
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; } catch { return 'UTC'; }
}

/** 查找客户端今天的第一毫秒；按日历比较可正确处理夏令时和零点跳变。 */
export function rangeStart(range: UsageRange, now: number, timeZone: string): number {
  if (range !== 'today') return now - ({ '30m': 1800000, '7d': 7 * 86400000, '30d': 30 * 86400000 })[range];
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: validTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' });
  /** 使用显式年月日顺序，不依赖 locale 对日期分隔符的选择。 */
  const day = (time: number): string => {
    const parts = formatter.formatToParts(time);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('');
  };
  const today = day(now);
  let low = now - 48 * 3600000, high = now;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (day(middle) < today) low = middle + 1; else high = middle; }
  return low;
}

/** 合并缓存和实时尾部的响应身份，避免回填完成前缺少当前用量或重复累加。 */
export function summarize(records: Iterable<UsageRecord>, range: UsageRange, timeZone: string,
  options: Pick<MonitorOptions, 'scope' | 'workspaces'>, now: number): UsageSummary {
  const zone = validTimeZone(timeZone), from = rangeStart(range, now, zone);
  const unique = new Map<string, UsageRecord>();
  for (const record of records) {
    if (record.end < from || record.end > now || options.scope === 'workspace' && !inWorkspace(record.cwd, options.workspaces)) continue;
    const old = unique.get(record.key);
    if (!old || !measured(old) && measured(record)) unique.set(record.key, record);
  }
  const bySession: UsageSummary['bySession'] = new Map();
  let input = 0, output = 0, timedOutput = 0, duration = 0;
  for (const record of unique.values()) {
    input += record.input; output += record.output;
    if (measured(record)) { duration += sampleDuration(record); timedOutput += record.output; }
    const totals = bySession.get(record.session) ?? { input: 0, output: 0, responses: 0 };
    totals.input += record.input; totals.output += record.output; totals.responses++; bySession.set(record.session, totals);
  }
  return { range, from, until: now, timeZone: zone, input, output, responses: unique.size, average: duration ? timedOutput * 1000 / duration : 0, bySession };
}
