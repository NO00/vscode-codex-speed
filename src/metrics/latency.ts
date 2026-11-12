import type { Sample, Session } from '../types';
import { inWorkspace } from '../engine';
import { LatencySummary } from './types';

/** 只对起点和首段时间均已知的调用计算等待，沿用测速十五分钟的合理区间。 */
export function contentWait(sample: Pick<Sample, 'start' | 'end' | 'firstContent'>): number | undefined {
  const { start, end, firstContent } = sample;
  return start !== undefined && firstContent !== undefined && [start, end, firstContent].every(Number.isFinite)
    && end >= start && end - start <= 900000 && firstContent >= start && firstContent <= end ? firstContent - start : undefined;
}

/** 合并会话镜像后优先展示当前等待；没有生成请求时回退最近半小时的已观测调用。 */
export function summarizeLatency(sessions: Session[], scope: 'all' | 'workspace', roots: string[], now: number): LatencySummary {
  const unique = new Map<string, Session>();
  for (const session of sessions) {
    if (scope === 'workspace' && !inWorkspace(session.cwd, roots)) continue;
    const previous = unique.get(session.id);
    if (!previous || session.lastEvent > previous.lastEvent) unique.set(session.id, session);
  }
  const waiting: number[] = [], observed: number[] = [];
  let last: { ms: number; at: number } | undefined;
  // 样本仍从所有镜像读取，避免最新镜像的尾读缺少旧响应；每条响应只选择一个有效等待值。
  const samples = new Map<string, Sample>();
  for (const session of sessions) {
    if (scope === 'workspace' && !inWorkspace(session.cwd, roots)) continue;
    for (const sample of session.samples) if (sample.end <= now && sample.end >= now - 1800000 && contentWait(sample) !== undefined && !samples.has(sample.key)) samples.set(sample.key, sample);
  }
  for (const sample of samples.values()) if (!last || sample.end > last.at) last = { ms: contentWait(sample)!, at: sample.end };
  for (const session of unique.values()) {
    if (session.phase !== 'generating' || session.lastEvent < now - 300000 || session.lastEvent > now
      || session.pendingStart === undefined || !Number.isFinite(session.pendingStart) || session.pendingStart > now || now - session.pendingStart > 900000) continue;
    const wait = contentWait({ start: session.pendingStart, end: now, firstContent: session.firstContent });
    if (wait === undefined) waiting.push(now - session.pendingStart); else observed.push(wait);
  }
  if (waiting.length) return { state: 'waiting', ms: Math.max(...waiting), requests: waiting.length };
  if (observed.length) return { state: 'observed', ms: observed.reduce((sum, ms) => sum + ms, 0) / observed.length, requests: observed.length };
  return last ? { state: 'last', ms: last.ms, requests: 1, at: last.at } : { state: 'unavailable', requests: 0 };
}
