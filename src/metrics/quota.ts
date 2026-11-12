import type { Session } from '../types';
import { QuotaSnapshot, QuotaSummary, QuotaWindow } from './types';

/** 不接受字符串数字、无限值或数组作为厂商元数据。 */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Unix 毫秒必须能被 Date 精确表示；异常重置时间不污染有效百分比。 */
function date(value: number): number | undefined { return Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000 ? value : undefined; }

/** 独立解析 token_count 的额度，即使用量缺失或重复也可以更新账户快照。 */
export function readQuota(value: unknown, observed: number): QuotaSnapshot | undefined {
  const limits = object(value);
  if (!limits || !Number.isFinite(observed) || limits.limit_id != null && limits.limit_id !== 'codex') return;
  const windows: QuotaWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const raw = object(limits[key]);
    if (!raw || typeof raw.used_percent !== 'number' || !Number.isFinite(raw.used_percent)
      || typeof raw.window_minutes !== 'number' || !Number.isFinite(raw.window_minutes) || raw.window_minutes <= 0) continue;
    const minutes = raw.window_minutes;
    const kind = minutes >= 290 && minutes <= 310 ? 'fiveHour' : minutes >= 10000 && minutes <= 10160 ? 'sevenDay' : 'other';
    // 同类周期优先 primary；其他长度只在分钟数相同时视为重复。
    if (windows.some(window => window.kind === kind && (kind !== 'other' || window.minutes === minutes))) continue;
    const resetsAt = typeof raw.resets_at === 'number' && Number.isFinite(raw.resets_at) ? date(Math.trunc(raw.resets_at * 1000))
      : typeof raw.resets_in_seconds === 'number' && Number.isFinite(raw.resets_in_seconds) ? date(Math.trunc(observed + raw.resets_in_seconds * 1000)) : undefined;
    windows.push({ kind, minutes: kind === 'fiveHour' ? 300 : kind === 'sevenDay' ? 10080 : minutes, usedPercent: raw.used_percent, resetsAt });
  }
  if (!windows.length) return;
  const plan = typeof limits.plan_type === 'string' ? limits.plan_type.trim().slice(0, 64) : undefined;
  return { observed, plan: plan || undefined, windows: windows.sort((a, b) => a.minutes - b.minutes) };
}

/** 账户额度不随工作区改变；只选最近有效快照，不把多个会话的百分比相加。 */
export function summarizeQuota(sessions: Session[], now: number): QuotaSummary {
  let snapshot: QuotaSnapshot | undefined;
  for (const session of sessions) {
    const quota = session.quota;
    if (quota && quota.observed <= now && (!snapshot || quota.observed > snapshot.observed)) snapshot = quota;
  }
  return snapshot ? { state: now - snapshot.observed > 3600000 ? 'stale' : 'fresh', snapshot } : { state: 'unavailable' };
}
