import path from 'node:path';
import { calculate, inWorkspace, measured } from '../engine';
import { MonitorOptions, Sample, Session, Snapshot } from '../types';

/** 曲线采样点；估算与实测保持不同来源，不能将上次调用当作实时曲线。 */
export interface SpeedPoint {
  /** 扩展宿主采样时刻。 */
  time: number;
  /** 当前输出速度；空闲、等待及上次调用时为零。 */
  rate: number;
  /** 数字的来源。 */
  kind: Snapshot['kind'];
}

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
  /** 估算或上次结果需要明确标识。 */
  kind: Snapshot['kind'];
  /** 最近半小时去重后的输出量。 */
  output: number;
  /** 最近半小时去重后的输入量。 */
  input: number;
  /** 最近半小时完成的响应数。 */
  responses: number;
  /** 最近事件时间，用于按活跃程度排序。 */
  lastEvent: number;
}

/** 仪表盘唯一数据结构；所有统计窗口均明确限制为可用的近半小时记录。 */
export interface DashboardData {
  /** 本次快照的宿主时间。 */
  now: number;
  /** 当前测速快照。 */
  snapshot: Snapshot;
  /** 最近五分钟的有界采样；关闭面板时仍由已有状态栏轮询积累。 */
  points: SpeedPoint[];
  /** 过滤和合并后的会话列表。 */
  sessions: SessionSummary[];
  /** 可用记录的全局去重计数及加权平均速度。 */
  usage: { input: number; output: number; responses: number; average: number; peak: number };
}

/** 只积累小型速度采样，不另开日志扫描、模型请求或计时器。 */
export class DashboardHistory {
  /** 半秒粒度最多保留五分钟，另限制数量防止频繁手动刷新增长。 */
  private points: SpeedPoint[] = [];

  /** 保存当前真实监控状态；同一个半秒内的重复刷新覆盖最后一点。 */
  record(snapshot: Snapshot, now: number, error = false): void {
    let last = this.points.at(-1);
    if (last && now < last.time) { this.points = []; last = undefined; }
    const point = { time: now, rate: !error && ['measured', 'estimated'].includes(snapshot.kind) ? snapshot.rate : 0, kind: snapshot.kind };
    if (last && Math.floor(now / 500) === Math.floor(last.time / 500)) this.points[this.points.length - 1] = point;
    else this.points.push(point);
    this.points = this.points.filter(item => item.time >= now - 300000).slice(-601);
  }

  /** 只有面板可见时构造会话及用量，常规状态栏轮询不重复汇总。 */
  data(sessions: Session[], options: MonitorOptions, snapshot: Snapshot, now: number): DashboardData {
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
          if (!old || !measured(old) && measured(sample)) map.set(sample.key, sample);
        }
      }
      const active = current.lastEvent >= now - 300000 && current.lastEvent <= now;
      const rate = calculate(group, { ...options, scope: 'all' }, now);
      rows.push({ id, name: path.basename(current.cwd.replace(/\\/g, '/')) || '', cwd: current.cwd,
        model: current.model === '未知模型' ? '' : current.model, phase: active ? current.phase : 'idle',
        rate: rate.rate, kind: rate.kind, input: [...own.values()].reduce((sum, sample) => sum + sample.input, 0),
        output: rate.output, responses: rate.responses, lastEvent: current.lastEvent });
    }
    const samples = [...unique.values()];
    const timed = samples.filter(measured);
    const duration = timed.reduce((sum, sample) => sum + sample.end - sample.start, 0);
    const points = this.points.filter(point => point.time >= now - 300000 && point.time <= now);
    return { now, snapshot, points, sessions: rows.sort((a, b) => Number(b.phase !== 'idle') - Number(a.phase !== 'idle') || b.lastEvent - a.lastEvent),
      usage: { input: samples.reduce((sum, sample) => sum + sample.input, 0), output: samples.reduce((sum, sample) => sum + sample.output, 0),
        responses: samples.length, average: duration ? timed.reduce((sum, sample) => sum + sample.output, 0) * 1000 / duration : 0,
        peak: points.reduce((peak, point) => Math.max(peak, point.rate), 0) } };
  }
}
