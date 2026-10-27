import path from 'node:path';
import { calculateFrame, inWorkspace, measured, sampleDuration, SpeedPoint } from '../engine';
import { MonitorOptions, Sample, Session, Snapshot } from '../types';
import { HistoryStatus, UsageRange, UsageSummary } from '../history/types';
import { defaultPrices } from '../cost/catalog';
import { CostSummary, PriceBook } from '../cost/types';
import { estimateCost } from '../cost/estimate';
import { enrichUsage } from '../cost/usage';

/** 单个会话的计数摘要，仅传递元数据，不传递对话正文。 */
export interface SessionSummary {
  /** 合并镜像日志后的身份。 */
  id: string;
  /** 工作目录末级名称。 */
  name: string;
  /** 服务器工作目录。 */
  cwd: string;
  /** 最近模型，缺失时为空，由界面翻译占位文本。 */
  model: string;
  /** 当前阶段，超过五分钟未更新时显示空闲。 */
  phase: Session['phase'];
  /** 会话速度及其来源。 */
  rate: number;
  /** 估算结果需要明确标识，不回填历史调用速度。 */
  kind: Snapshot['kind'];
  /** 会话当前速率中的估算占比。 */
  estimatedShare: number;
  /** 最近半小时去重后的输出量。 */
  output: number;
  /** 最近半小时去重后的输入量。 */
  input: number;
  /** 最近半小时完成的响应数。 */
  responses: number;
  /** 最近事件时间，用于按活跃程度排序。 */
  lastEvent: number;
}

/** 仪表盘唯一数据结构；每秒重建测速曲线与所选历史用量窗口分别计算。 */
export interface DashboardData {
  /** 本次快照的宿主时间。 */
  now: number;
  /** 当前测速快照。 */
  snapshot: Snapshot;
  /** 最近三百个一秒桶，实测与估算部分独立并可在完成后校正。 */
  points: SpeedPoint[];
  /** 过滤和合并后的会话列表。 */
  sessions: SessionSummary[];
  /** 可用记录的全局去重计数及加权平均速度。 */
  usage: { input: number; output: number; responses: number; average: number; peak: number; range: UsageRange; from: number; timeZone: string };
  /** 已完成响应的 API 等值费用，与当前速度估算分开计算。 */
  cost: CostSummary;
  /** 历史索引进度和完整性，与实时监控错误分开显示。 */
  history: HistoryStatus;
}

/** 从已有解析结果重建三百秒曲线，不另开日志扫描、模型请求或计时器。 */
export class DashboardHistory {
  /** 只有面板可见时构造会话及用量，常规状态栏轮询不重复汇总。 */
  data(sessions: Session[], options: MonitorOptions, snapshot: Snapshot, now: number, historical?: UsageSummary, status?: HistoryStatus, prices: PriceBook = defaultPrices): DashboardData {
    const frame = calculateFrame(sessions, options, now, true);
    const selected = sessions.filter(session => options.scope === 'all' || inWorkspace(session.cwd, options.workspaces));
    const grouped = new Map<string, Session[]>();
    for (const session of selected) grouped.set(session.id, [...(grouped.get(session.id) ?? []), session]);
    const unique = new Map<string, Sample>();
    const rows: SessionSummary[] = [];
    for (const [id, group] of grouped) {
      const current = [...group].sort((a, b) => b.lastEvent - a.lastEvent)[0]!;
      const own = new Map<string, Sample>();
      for (const session of group) for (const sample of session.samples) {
        if (sample.end < now - 1800000 || sample.end > now) continue;
        for (const map of [own, unique]) {
          const old = map.get(sample.key);
          if (!old) map.set(sample.key, sample);
          else map.set(sample.key, !measured(old) && measured(sample) ? enrichUsage(sample, old) : enrichUsage(old, sample));
        }
      }
      const active = current.lastEvent >= now - 300000 && current.lastEvent <= now;
      const rate = frame.agents.get(id)!;
      rows.push({ id, name: path.basename(current.cwd.replace(/\\/g, '/')) || '', cwd: current.cwd,
        model: current.model === '未知模型' ? '' : current.model, phase: active ? current.phase : 'idle',
        rate: rate.rate, kind: rate.kind, estimatedShare: rate.estimatedShare, input: [...own.values()].reduce((sum, sample) => sum + sample.input, 0),
        output: rate.output, responses: rate.responses, lastEvent: current.lastEvent });
      const totals = historical?.bySession.get(id);
      if (historical) Object.assign(rows.at(-1)!, totals ?? { input: 0, output: 0, responses: 0 });
    }
    const samples = [...unique.values()];
    const timed = samples.filter(measured);
    const duration = timed.reduce((sum, sample) => sum + sampleDuration(sample), 0);
    const points = frame.points;
    // 峰值采用每秒桶的三秒平均，并包含当前窗口读数，估算会随完成记录一起校正。
    let previous1 = 0, previous2 = 0, peak = snapshot.rate;
    for (const point of points) { peak = Math.max(peak, (previous2 + previous1 + point.rate) / 3); previous2 = previous1; previous1 = point.rate; }
    return { now, snapshot, points, sessions: rows.sort((a, b) => Number(b.phase !== 'idle') - Number(a.phase !== 'idle') || b.lastEvent - a.lastEvent),
      usage: { input: historical?.input ?? samples.reduce((sum, sample) => sum + sample.input, 0), output: historical?.output ?? samples.reduce((sum, sample) => sum + sample.output, 0),
        responses: historical?.responses ?? samples.length, average: historical?.average ?? (duration ? timed.reduce((sum, sample) => sum + sample.output, 0) * 1000 / duration : 0),
        peak, range: historical?.range ?? '30m', from: historical?.from ?? now - 1800000, timeZone: historical?.timeZone ?? 'UTC' },
      cost: historical?.cost ?? estimateCost(samples, prices),
      history: status ?? { indexing: false, scanned: 0, total: 0, limited: false, readErrors: 0, cacheError: false, cacheReset: false, follower: false } };
  }
}
