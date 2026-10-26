import path from 'node:path';
import { MonitorOptions, Sample, Session, Snapshot } from './types';

/** 过滤耗时缺失、倒序时间及不可用输出的记录。 */
export function measured(sample: Sample): sample is Sample & { start: number } {
  return sample.start !== undefined && sample.end > sample.start && sample.output >= 0;
}

/** 计算单次请求平均输出速度；包括首 token 等待时间，不含此前工具执行。 */
export function sampleRate(sample: Sample): number {
  return measured(sample) ? sample.output * 1000 / (sample.end - sample.start) : 0;
}

/** 使用路径边界匹配工作区，防止 /project 错误匹配 /project-other。 */
export function inWorkspace(cwd: string, roots: string[]): boolean {
  if (!cwd) return false;
  return roots.some(root => {
    const relative = path.relative(root, cwd);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
}

/** 使用最近三次调用的加权平均作为单个 agent 的估算参考。 */
function reference(samples: Sample[], now: number): number | undefined {
  const recent = samples.filter(s => measured(s) && s.end >= now - 600000 && s.end <= now).sort((a, b) => b.end - a.end).slice(0, 3);
  const duration = recent.reduce((sum, s) => sum + (s.end - s.start!), 0);
  return duration > 0 ? recent.reduce((sum, s) => sum + s.output, 0) * 1000 / duration : undefined;
}

/** 计算两个时间区间的交集长度。 */
function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

/** 基于显式时钟回放日志；并行 agent 加总，重复响应全局去重。 */
export function calculate(sessions: Session[], options: Pick<MonitorOptions, 'scope' | 'workspaces' | 'showEstimates'>, now: number): Snapshot {
  const selected = sessions.filter(s => options.scope === 'all' || inWorkspace(s.cwd, options.workspaces));
  const unique = new Map<string, Sample>();
  for (const session of selected) for (const sample of session.samples) {
    if (sample.end >= now - 1800000 && sample.end <= now) {
      const existing = unique.get(sample.key);
      if (!existing || (!measured(existing) && measured(sample))) unique.set(sample.key, sample);
    }
  }
  const samples = [...unique.values()];
  const latest = samples.filter(measured).sort((a, b) => b.end - a.end)[0];
  const active = selected.filter(s => s.phase === 'generating' && s.lastEvent >= now - 300000 && s.lastEvent <= now);
  let rate = 0;
  let estimated = false;
  const windowStart = now - 3000;
  for (const sample of samples) {
    if (measured(sample)) rate += sampleRate(sample) * overlap(windowStart, now, sample.start, sample.end) / 3000;
  }
  if (options.showEstimates) {
    const estimatedSessions = new Set<string>();
    for (const session of active) {
      if (session.pendingStart === undefined) continue;
      // 同一个会话的复制文件不重复估算；不同子 agent 仍保持独立。
      if (estimatedSessions.has(session.id)) continue;
      estimatedSessions.add(session.id);
      const speed = reference(session.samples, now);
      if (speed === undefined) continue;
      const lastEnd = session.samples.reduce((end, sample) => Math.max(end, sample.end), 0);
      rate += speed * overlap(windowStart, now, Math.max(session.pendingStart!, lastEnd), now) / 3000;
      estimated = true;
    }
  }
  let kind: Snapshot['kind'] = estimated ? 'estimated' : rate > 0 ? 'measured' : active.length > 0 ? 'waiting' : 'idle';
  // 不让上次速度冒充当前速度；短暂保留时必须明确显示“上次”。
  if (kind === 'idle' && latest && latest.end >= now - 15000) { kind = 'last'; rate = sampleRate(latest); }
  if (kind === 'idle' && selected.some(s => s.phase === 'tools' && s.lastEvent >= now - 300000)) kind = 'tools';
  return { rate, kind, active: new Set(active.map(s => s.id)).size, sessions: selected.length, responses: samples.length, output: samples.reduce((sum, s) => sum + s.output, 0), latest };
}
