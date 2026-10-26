import path from 'node:path';
import { MonitorOptions, Sample, Session, Snapshot } from './types';

/** 一秒桶分别保存日志计数与在途估算，完成记录到达后整条序列重新计算。 */
export interface SpeedPoint {
  /** 桶起点的服务器时间，单位为毫秒。 */
  time: number;
  /** 一秒内分配的已完成输出 token，数值口径为 token/s。 */
  measured: number;
  /** 一秒内分配的在途估算输出 token。 */
  estimated: number;
  /** 两部分的合计，便于图表与峰值使用相同口径。 */
  rate: number;
}

/** 一次计算同时产出主读数、会话读数和可选历史，避免各视图使用不同估算参考。 */
export interface SpeedFrame {
  /** 聚合主机或工作区的三秒快照。 */
  snapshot: Snapshot;
  /** 全局参考计算后的各独立会话快照。 */
  agents: Map<string, Snapshot>;
  /** 最近三百个一秒桶；状态栏计算时省略。 */
  points: SpeedPoint[];
}

/** 与 Agent Speed 的响应计时规则一致：最多十五分钟，最少按五百毫秒计速。 */
export function measured(sample: Sample): sample is Sample & { start: number } {
  return sample.start !== undefined && Number.isFinite(sample.start) && Number.isFinite(sample.end)
    && sample.end >= sample.start && sample.end - sample.start <= 900000 && Number.isFinite(sample.output) && sample.output >= 0;
}

/** 有效测速耗时，短响应扩展到五百毫秒；不可测速的记录返回零。 */
export function sampleDuration(sample: Sample): number { return measured(sample) ? Math.max(500, sample.end - sample.start) : 0; }

/** 单次响应平均速度包含首 token 等待，不能解释为逐 token 流式速度。 */
export function sampleRate(sample: Sample): number { const duration = sampleDuration(sample); return duration ? sample.output * 1000 / duration : 0; }

/** 使用路径边界匹配工作区，防止 /project 错误匹配 /project-other。 */
export function inWorkspace(cwd: string, roots: string[]): boolean {
  if (!cwd) return false;
  return roots.some(root => {
    const relative = path.relative(root, cwd);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
}

/** 计算半开区间的重叠长度，窗口与历史桶使用同一公式。 */
function overlap(a: number, b: number, c: number, d: number): number { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }

/** 测速记录携带所属会话；全局重复响应只归属一个会话。 */
interface OwnedSample { sample: Sample; owner: string; }

/** 按总输出除以总有效耗时求加权参考，不平均单条速率。 */
function reference(records: OwnedSample[], count: number): number | undefined {
  const recent = records.slice(0, count);
  const duration = recent.reduce((sum, record) => sum + sampleDuration(record.sample), 0);
  return duration ? recent.reduce((sum, record) => sum + record.sample.output, 0) * 1000 / duration : undefined;
}

/** 用差分数组把区间均匀分配到三百个一秒桶，避免每条记录逐桶遍历。 */
class BucketSeries {
  /** 每秒桶及完整秒区间的差分增量，规模固定。 */
  private values = new Float64Array(300);
  private changes = new Float64Array(301);
  /** 第一个一秒桶的 Unix 秒。 */
  private firstSecond: number;

  /** 桶窗口与 Agent Speed 一样，包含当前尚未结束的一秒。 */
  constructor(now: number) { this.firstSecond = Math.floor(now / 1000) - 299; }

  /** 首尾秒只计交集，中间完整秒用差分累加；不扩展到请求区间之外。 */
  add(start: number, end: number, rate: number): void {
    const from = Math.max(start, this.firstSecond * 1000), until = Math.min(end, (this.firstSecond + 300) * 1000);
    if (until <= from || rate <= 0) return;
    const first = Math.floor(from / 1000) - this.firstSecond, last = Math.ceil(until / 1000) - 1 - this.firstSecond;
    if (first === last) { this.values[first]! += rate * (until - from) / 1000; return; }
    this.values[first]! += rate * ((this.firstSecond + first + 1) * 1000 - from) / 1000;
    this.values[last]! += rate * (until - (this.firstSecond + last) * 1000) / 1000;
    this.changes[first + 1]! += rate; this.changes[last]! -= rate;
  }

  /** 求差分前缀和，浮点舍入产生的微小负值归零。 */
  result(): number[] {
    let running = 0;
    return Array.from(this.values, (value, index) => { running += this.changes[index]!; const result = value + running; return Math.abs(result) < .000000001 ? 0 : Math.max(0, result); });
  }
}

/** 先合并会话镜像，再按响应身份全局去重，保留最近状态和可用耗时。 */
function select(sessions: Session[], options: Pick<MonitorOptions, 'scope' | 'workspaces'>, now: number): { agents: Session[]; samples: OwnedSample[] } {
  const agents = new Map<string, Session>();
  const ownSamples = new Map<string, Map<string, Sample>>();
  for (const session of sessions) {
    if (options.scope === 'workspace' && !inWorkspace(session.cwd, options.workspaces)) continue;
    const old = agents.get(session.id);
    if (!old || session.lastEvent > old.lastEvent) agents.set(session.id, session);
    const own = ownSamples.get(session.id) ?? new Map<string, Sample>();
    for (const sample of session.samples) {
      if (sample.end < now - 1800000 || sample.end > now) continue;
      const previous = own.get(sample.key);
      if (!previous || !measured(previous) && measured(sample)) own.set(sample.key, sample);
    }
    ownSamples.set(session.id, own);
  }
  const unique = new Map<string, OwnedSample>();
  const merged = [...agents.values()].map(agent => ({ ...agent, samples: [...ownSamples.get(agent.id)!.values()] }));
  for (const agent of merged) for (const sample of agent.samples) {
    const previous = unique.get(sample.key);
    if (!previous || !measured(previous.sample) && measured(sample)) unique.set(sample.key, { sample, owner: agent.id });
  }
  return { agents: merged, samples: [...unique.values()] };
}

/** 按 Agent Speed 规范 6.2、6.3、6.5 计算 Codex：三秒窗口、参考回退和一秒历史重建。 */
export function calculateFrame(sessions: Session[], options: Pick<MonitorOptions, 'scope' | 'workspaces' | 'showEstimates'>, now: number, includeHistory = false): SpeedFrame {
  const selected = select(sessions, options, now);
  const timed = selected.samples.filter(record => measured(record.sample)).sort((a, b) => b.sample.end - a.sample.end || (a.sample.key < b.sample.key ? -1 : a.sample.key > b.sample.key ? 1 : 0));
  const live = new Map<string, { measured: number; estimated: number }>();
  // 建立单次索引，避免每个活跃会话反复过滤、排序整个主机的所有响应。
  const owned = new Map<string, OwnedSample[]>(), ownReferences = new Map<string, OwnedSample[]>(), modelReferences = new Map<string, OwnedSample[]>();
  const latestByOwner = new Map<string, Sample>();
  for (const record of selected.samples) { const records = owned.get(record.owner) ?? []; records.push(record); owned.set(record.owner, records); }
  for (const agent of selected.agents) live.set(agent.id, { measured: 0, estimated: 0 });
  const counted = includeHistory ? new BucketSeries(now) : undefined, predicted = includeHistory ? new BucketSeries(now) : undefined;
  const windowStart = now - 3000;
  for (const record of timed) {
    const { sample, owner } = record;
    if (!latestByOwner.has(owner)) latestByOwner.set(owner, sample);
    const own = ownReferences.get(owner) ?? [];
    if (sample.end >= now - 600000 && own.length < 3) { own.push(record); ownReferences.set(owner, own); }
    const model = modelReferences.get(sample.model) ?? [];
    if (model.length < 10) { model.push(record); modelReferences.set(sample.model, model); }
    const start = sample.end - sampleDuration(sample), rate = sampleRate(sample);
    live.get(owner)!.measured += rate * overlap(windowStart, now, start, sample.end) / 3000;
    counted?.add(start, sample.end, rate);
  }
  const sourceReference = reference(timed, 10);
  let activeCount = 0, tools = 0;
  for (const agent of selected.agents) {
    const fresh = agent.lastEvent >= now - 300000 && agent.lastEvent <= now;
    if (fresh && agent.phase === 'tools') tools++;
    if (!fresh || agent.phase !== 'generating') continue;
    activeCount++;
    if (!options.showEstimates || agent.pendingStart === undefined || agent.pendingStart > now) continue;
    // 优先取本会话近十分钟最后三条，否则取同模型、同来源近半小时最后十条。
    const own = ownReferences.get(agent.id) ?? [];
    const model = agent.model && agent.model !== '未知模型' ? modelReferences.get(agent.model) ?? [] : [];
    const speed = reference(own, 3) ?? reference(model, 10) ?? sourceReference;
    if (speed === undefined) continue;
    const lastEnd = agent.samples.reduce((end, sample) => Math.max(end, sample.end), -Infinity);
    const start = Math.max(agent.pendingStart, lastEnd);
    const estimate = speed * overlap(windowStart, now, start, now) / 3000;
    live.get(agent.id)!.estimated += estimate;
    predicted?.add(start, now, speed);
  }
  /** 根据实际数值给出来源与占比；零贡献估算不能覆盖实测状态。 */
  function snapshot(measuredRate: number, estimatedRate: number, active: number, toolCount: number, records: OwnedSample[], sessionCount: number, latest: Sample | undefined): Snapshot {
    const rate = measuredRate + estimatedRate;
    const kind = estimatedRate > 0 ? 'estimated' : measuredRate > 0 ? 'measured' : active > 0 ? 'waiting' : toolCount > 0 ? 'tools' : 'idle';
    return { rate, kind, measuredRate, estimatedRate, estimatedShare: rate > 0 ? estimatedRate / rate : 0, active, sessions: sessionCount, responses: records.length, output: records.reduce((sum, record) => sum + record.sample.output, 0), latest };
  }
  const agents = new Map<string, Snapshot>();
  for (const agent of selected.agents) {
    const value = live.get(agent.id)!, fresh = agent.lastEvent >= now - 300000 && agent.lastEvent <= now;
    agents.set(agent.id, snapshot(value.measured, value.estimated, Number(fresh && agent.phase === 'generating'), Number(fresh && agent.phase === 'tools'), owned.get(agent.id) ?? [], 1, latestByOwner.get(agent.id)));
  }
  const values = [...live.values()];
  const aggregate = snapshot(values.reduce((sum, value) => sum + value.measured, 0), values.reduce((sum, value) => sum + value.estimated, 0), activeCount, tools, selected.samples, selected.agents.length, timed[0]?.sample);
  const measuredBuckets = counted?.result() ?? [], estimatedBuckets = predicted?.result() ?? [];
  const firstSecond = Math.floor(now / 1000) - 299;
  const points = measuredBuckets.map((value, index) => ({ time: (firstSecond + index) * 1000, measured: value, estimated: estimatedBuckets[index]!, rate: value + estimatedBuckets[index]! }));
  return { snapshot: aggregate, agents, points };
}

/** 状态栏不构造历史桶；主读数与仪表盘仍共用完整计算口径。 */
export function calculate(sessions: Session[], options: Pick<MonitorOptions, 'scope' | 'workspaces' | 'showEstimates'>, now: number): Snapshot {
  return calculateFrame(sessions, options, now).snapshot;
}
