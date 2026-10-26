import { Phase, Sample, Session } from './types';

/** 将未知 JSON 值收窄为对象，避免依赖具体 Codex 版本的未验证字段。 */
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** 用量字段必须为非负有限整数；缺失或格式错误时返回空值。 */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 把缺失字段映射为零，但不允许 NaN 或负值污染速率。 */
function tokens(value: unknown): number { return count(value) ?? 0; }

/** 解析现代及旧版 Codex rollout；仅保留计数、时间、模型和路径。 */
export class CodexParser implements Session {
  /** 会话日志绝对路径，作为无 session_meta 时的身份回退。 */
  readonly file: string;
  /** 日志中声明的会话 ID。 */
  id: string;
  /** 用于工作区过滤的工作目录。 */
  cwd = '';
  /** 最近已知模型名。 */
  model = '未知模型';
  /** 当前运行阶段。 */
  phase: Phase = 'idle';
  /** 模型请求起点，工具结果到达后重新计时。 */
  pendingStart: number | undefined;
  /** 最近日志事件时间，用于剔除失联会话的估算。 */
  lastEvent = 0;
  /** 有界保留的已解析用量记录。 */
  samples: Sample[] = [];
  /** 首个 session_meta 的时间，用于排除 fork 复制的旧历史。 */
  private created: number | undefined;
  /** 流式输出开始后不让后续输入覆盖请求起点。 */
  private streaming = false;
  /** 新日志同时写两种用量事件时，以现代记录为准。 */
  private modern = false;
  /** 上一条旧版累计用量，用来计算增量。 */
  private previous: Record<string, unknown> | undefined;
  /** 已保留响应的身份集合，防止重复通知二次计数。 */
  private keys = new Set<string>();

  /** 创建单文件状态机，不进行任何文件写入。 */
  constructor(file: string) { this.file = file; this.id = file; }

  /** 只读取大文件开头的元数据，不把早期用量混入尾部时间线。 */
  seedMetadata(line: string): void {
    try {
      const row = object(JSON.parse(line));
      if (row?.type === 'session_meta') this.consume(line);
    } catch { /* 半行或无效 JSON 不会中断后续日志读取。 */ }
  }

  /** 增量消费一条完整 JSONL；未知事件及坏行安全忽略。 */
  consume(line: string): void {
    let row: Record<string, unknown> | undefined;
    try { row = object(JSON.parse(line)); } catch { return; }
    if (!row || typeof row.timestamp !== 'string') return;
    const time = Date.parse(row.timestamp);
    const p = object(row.payload);
    if (!Number.isFinite(time) || !p) return;
    if (row.type === 'session_meta') {
      if (this.created !== undefined) return;
      this.created = time;
      if (typeof p.id === 'string') this.id = p.id;
      if (typeof p.cwd === 'string') this.cwd = p.cwd;
      return;
    }
    // fork 的旧记录仍带旧时间；不能用它们推断新会话的活跃状态。
    if (this.created !== undefined && time < this.created - 2000) return;
    this.lastEvent = Math.max(this.lastEvent, time);
    const type = p.type;
    if (row.type === 'turn_context') {
      if (typeof p.model === 'string') this.model = p.model;
      if (typeof p.cwd === 'string') this.cwd = p.cwd;
      return;
    }
    if (row.type === 'token_usage_record') { this.modernUsage(p, time); return; }
    if (row.type === 'event_msg') {
      if (type === 'task_complete' || type === 'turn_aborted') {
        this.phase = 'idle'; this.pendingStart = undefined; this.streaming = false;
      } else if (type === 'task_started' || type === 'user_message') this.input(time);
      else if (type === 'token_count') {
        if (!this.modern) this.legacyUsage(p, time);
        else if (this.streaming) this.endResponse(time);
      }
      return;
    }
    if (row.type !== 'response_item' || typeof type !== 'string') return;
    if (type.endsWith('_output') || (type === 'message' && ['user', 'system', 'developer'].includes(String(p.role)))) {
      this.input(time);
    } else if (type === 'reasoning' || type.endsWith('_call') || (type === 'message' && p.role === 'assistant')) {
      this.streaming = true;
      this.phase = 'generating';
      // 若尾部读取漏掉了请求输入，输出事件不能冒充请求起点。
    }
  }

  /** 输入代表新请求即将发出；从工具结果到下一次用量记录的间隔计入生成。 */
  private input(time: number): void {
    if (!this.streaming) this.pendingStart = time;
    this.phase = 'generating';
  }

  /** 现代计数只读取 usage，避免把 turn/thread 累计值重复累加。 */
  private modernUsage(p: Record<string, unknown>, time: number): void {
    const usage = object(p.usage);
    if (!usage || count(usage.output_tokens) === undefined) return;
    this.modern = true;
    const key = typeof p.response_id === 'string' ? p.response_id : `modern:${this.id}:${time}`;
    this.add(key, usage, time);
  }

  /** 旧版使用累计值差分；重复累计快照忽略，计数回退时采用 last_token_usage。 */
  private legacyUsage(p: Record<string, unknown>, time: number): void {
    const info = object(p.info);
    if (!info) return;
    const total = object(info.total_token_usage);
    const last = object(info.last_token_usage);
    let usage = last ?? total;
    if (total && this.previous) {
      const fields = ['input_tokens', 'output_tokens', 'total_tokens'];
      const delta = Object.fromEntries(fields.map(k => [k, tokens(total[k]) - tokens(this.previous?.[k])]));
      if (delta.total_tokens === 0 && delta.output_tokens === 0 && delta.input_tokens === 0) return;
      usage = Object.values(delta).some(n => n < 0) ? last : delta;
    }
    this.previous = total;
    if (!usage || count(usage.output_tokens) === undefined) return;
    const key = total ? `legacy:${this.id}:${tokens(total.total_tokens)}:${tokens(total.output_tokens)}` : `legacy:${this.id}:${time}`;
    this.add(key, usage, time);
  }

  /** 保存响应并维护容量上限；输出计数已经包含 reasoning，不再次相加。 */
  private add(key: string, usage: Record<string, unknown>, time: number): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.samples.push({ key, start: this.pendingStart, end: time, output: tokens(usage.output_tokens), input: tokens(usage.input_tokens), model: this.model });
    this.endResponse(time);
    while (this.samples.length > 1000 || (this.samples[0] && this.samples[0].end < time - 1800000)) {
      const old = this.samples.shift();
      if (old) this.keys.delete(old.key);
    }
  }

  /** 用量完成后进入工具阶段，等待工具结果或整轮完成事件。 */
  private endResponse(time: number): void {
    this.pendingStart = time; this.streaming = false; this.phase = 'tools';
  }
}
