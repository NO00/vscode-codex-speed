import fs from 'node:fs/promises';
import path from 'node:path';
import { calculate } from './engine';
import { TranscriptTailer } from './tailer';
import { Log, MonitorOptions, Snapshot } from './types';

/** 扫描文件及目录总量的硬上限，防止异常数据目录造成无界遍历。 */
const DISCOVERY_LIMIT = 20000;
/** 同时跟踪最新会话文件的上限。 */
const TRACK_LIMIT = 128;

/** 只展示操作系统错误代码，避免错误对象带出日志内容。 */
export function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
}

/** 监控状态，明确区分无目录、无日志、读取异常和正常运行。 */
export interface MonitorState {
  /** 与时钟对应的速率快照。 */
  snapshot: Snapshot;
  /** 人可读的运行提示；无问题时为空。 */
  notice: string;
  /** 是否存在权限或输入路径错误。 */
  error: boolean;
  /** 本轮发现的日志总量是否超过资源上限。 */
  limited: boolean;
}

/** 运行在 workspace 扩展宿主的只读监视器，不需要独立 SSH 凭证。 */
export class CodexMonitor {
  /** 当前跟踪文件，路径即状态身份。 */
  readonly tailers = new Map<string, TranscriptTailer>();
  /** 下一次目录发现的时间；已知文件每次轮询仍会增量读取。 */
  private nextDiscovery = 0;
  /** 路径或读取问题的最近提示。 */
  private notice = '';
  /** 最近一轮扫描是否正常。 */
  private error = false;
  /** 限额提示，不把部分扫描误报为完整统计。 */
  private limited = false;
  /** 防止并行刷新重复读取同一文件。 */
  private running: Promise<MonitorState> | undefined;
  /** 配置变更或退出后停止剩余异步工作。 */
  private disposed = false;

  /** 注入配置、诊断接口和确定性时钟，便于文件追加回放。 */
  constructor(readonly options: MonitorOptions, private readonly log: Log, private readonly clock: () => number = Date.now) {}

  /** 串行刷新，目录缺失时继续重试，允许 Codex 之后首次启动。 */
  tick(force = false): Promise<MonitorState> {
    if (this.running) return this.running;
    this.running = this.update(force).finally(() => { this.running = undefined; });
    return this.running;
  }

  /** 停止计时器之外的文件遍历与增量读取。 */
  dispose(): void { this.disposed = true; }

  /** 读取新日志后计算快照；单个坏文件不会中断其他 agent。 */
  private async update(force: boolean): Promise<MonitorState> {
    const now = this.clock();
    if (!this.disposed && (force || now >= this.nextDiscovery)) {
      this.nextDiscovery = now + 5000;
      await this.discover(now);
    }
    let readErrors = 0;
    for (const [file, tailer] of this.tailers) {
      if (this.disposed) break;
      try { await tailer.poll(); }
      catch (error) {
        if (errorCode(error) === 'ENOENT') this.tailers.delete(file);
        else { readErrors++; this.log(`读取会话失败：${errorCode(error)}`); }
      }
    }
    const snapshot = calculate([...this.tailers.values()].map(t => t.parser), this.options, this.clock());
    return { snapshot, notice: readErrors ? `${readErrors} 个日志无法读取，请检查服务器权限` : this.notice, error: this.error || readErrors > 0, limited: this.limited };
  }

  /** 不跟随符号链接的有界发现；按 mtime 选择，因此恢复旧会话也可被发现。 */
  private async discover(now: number): Promise<void> {
    const root = path.join(this.options.home, 'sessions');
    const candidates: { file: string; mtime: number }[] = [];
    const queue = [{ directory: root, depth: 0 }];
    let visited = 0;
    let failures = 0;
    this.limited = false;
    try {
      // 先探测根目录，避免把不存在或无权限误报为“暂无会话”。
      await fs.access(root, fs.constants.R_OK);
      while (queue.length && visited < DISCOVERY_LIMIT && !this.disposed) {
        const current = queue.shift()!;
        let entries;
        try { entries = await fs.readdir(current.directory, { withFileTypes: true }); }
        catch (error) {
          if (current.directory === root) throw error;
          if (errorCode(error) !== 'ENOENT') failures++;
          continue;
        }
        // 最近日期先入队，达到扫描上限时也优先保留近期记录。
        entries.sort((a, b) => b.name.localeCompare(a.name));
        for (const entry of entries) {
          if (++visited > DISCOVERY_LIMIT) { this.limited = true; break; }
          const file = path.join(current.directory, entry.name);
          if (entry.isDirectory() && current.depth < 6) queue.push({ directory: file, depth: current.depth + 1 });
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          try {
            const stat = await fs.stat(file);
            if (stat.mtimeMs >= now - this.options.scanDays * 86400000 || this.tailers.has(file)) candidates.push({ file, mtime: stat.mtimeMs });
          } catch (error) { if (errorCode(error) !== 'ENOENT') failures++; }
        }
      }
      if (queue.length) this.limited = true;
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (candidates.length > TRACK_LIMIT) this.limited = true;
      const selected = new Set(candidates.slice(0, TRACK_LIMIT).map(c => c.file));
      for (const file of this.tailers.keys()) if (!selected.has(file)) this.tailers.delete(file);
      for (const file of selected) if (!this.tailers.has(file)) this.tailers.set(file, new TranscriptTailer(file));
      this.error = failures > 0;
      this.setNotice(failures ? `${failures} 个目录或文件无法扫描，请检查权限` : candidates.length ? '' : '暂无近期 Codex 日志；请在此服务器运行 Codex');
    } catch (error) {
      this.error = true;
      this.tailers.clear();
      this.setNotice(errorCode(error) === 'ENOENT' ? '未找到 sessions 目录，请设置服务器上的 Codex Home' : `无法扫描 Codex 目录：${errorCode(error)}`);
    }
  }

  /** 只在运行提示发生变化时写日志，避免持续轮询刷屏。 */
  private setNotice(notice: string): void {
    if (notice !== this.notice) this.log(notice || `已发现 ${this.tailers.size} 个会话日志`);
    this.notice = notice;
  }
}
