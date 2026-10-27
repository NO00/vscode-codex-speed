import fs from 'node:fs/promises';
import path from 'node:path';
import { Dir } from 'node:fs';
import { MonitorOptions, Session } from '../types';
import { HistoryCacheStore, MAX_FILES, MAX_RECORDS } from './cache';
import { emptyFile, readHistoryFile } from './reader';
import { summarize } from './ranges';
import { HistoryStatus, IndexedFile, UsageRange, UsageRecord, UsageSummary } from './types';
import { defaultPrices } from '../cost/catalog';
import { PriceBook } from '../cost/types';

/** 历史索引最多保留三十天，发现和读取均分批执行。 */
const RETENTION = 30 * 86400000;

/** 与实时测速独立的只读增量索引；已有轮询触发，不再增加常驻扫描计时器。 */
export class UsageIndex {
  /** 来源文件和已发现的候选文件。 */
  private files = new Map<string, IndexedFile>();
  private targets = new Map<string, { size: number; mtime: number }>();
  /** 缓存和单写入者协调。 */
  private readonly cache: HistoryCacheStore;
  /** 最近一次后台任务，避免同时扫描或保存游标。 */
  private running: Promise<void> | undefined;
  /** 正在执行时收到的显式重新扫描请求，在本轮结束后补做一次。 */
  private forcePending = false;
  /** 后台发现游标和下次扫描时间。 */
  private discovery: AsyncGenerator<{ file: string; size: number; mtime: number }> | undefined;
  private nextDiscovery = 0; private lastSave = 0; private lastFollowerRead = 0;
  /** 首次加载及退出状态。 */
  private loaded = false; private disposed = false;
  /** 监控停用后让出写入权，允许其他 VS Code 窗口接管。 */
  private paused = false;
  /** 查询结果修订，避免每次面板轮询重复扫描全部历史记录。 */
  private revision = 0;
  /** 没有新增断点或记录时不周期性重写整个历史缓存。 */
  private dirty = false;
  private memo: { key: string; value: UsageSummary } | undefined;
  /** 文件和记录容量提示。 */
  private limited = false; private readErrors = 0;
  /** 读取顺序轮转，损坏文件和超大文件不会阻止其他会话回填。 */
  private cursor = 0;

  /** 存储路径在远程扩展宿主，数据源目录仅用于读取。 */
  constructor(private readonly home: string, storage: string, private readonly clock: () => number = Date.now) {
    this.cache = new HistoryCacheStore(storage, path.resolve(home));
  }

  /** 后台刷新不阻塞实时状态栏；重复调用共享任务。 */
  refresh(force = false): Promise<void> {
    if (this.disposed || this.paused) return Promise.resolve();
    if (this.running && force) this.forcePending = true;
    if (!this.running) {
      const requested = force || this.forcePending; this.forcePending = false;
      this.running = (async () => {
        await this.update(requested);
        if (this.forcePending && !this.disposed && !this.paused) { this.forcePending = false; await this.update(true); }
      })().catch(() => { this.readErrors++; }).finally(() => { this.running = undefined; });
    }
    return this.running;
  }

  /** 当前完整性提示，不将初次回填当成完整的零用量。 */
  get status(): HistoryStatus {
    let scanned = 0;
    for (const [file, target] of this.targets) { const state = this.files.get(file); if (state?.costVersion === 1 && state.offset >= target.size && state.mtime === target.mtime) scanned++; }
    const follower = this.loaded && !this.cache.owner;
    if (follower) scanned = [...this.files.values()].filter(file => file.costVersion === 1 && file.offset >= file.size).length;
    return { indexing: !this.loaded || (follower ? !this.cache.complete : !!this.discovery || scanned < this.targets.size), scanned, total: follower ? this.files.size : this.targets.size,
      limited: this.limited, readErrors: this.readErrors, cacheError: this.cache.error, cacheReset: this.cache.reset, follower: !this.cache.owner };
  }

  /** 按响应 ID 合并实时尾部；首次索引尚未结束时也能显示已知的当前用量。 */
  query(range: UsageRange, timeZone: string, options: MonitorOptions, live: Session[] = [], prices: PriceBook = defaultPrices): UsageSummary {
    const now = this.clock();
    const liveSignature = live.map(session => `${session.id}:${session.cwd}:${session.samples.length}:${session.samples.at(-1)?.key ?? ''}`).join('|');
    const key = `${this.revision}:${Math.floor(now / 1000)}:${range}:${timeZone}:${options.scope}:${options.workspaces.join('|')}:${liveSignature}:${prices.signature}`;
    if (this.memo?.key === key) return this.memo.value;
    const files = this.files;
    /** 惰性遍历计数，不复制整个三十天数组。 */
    function* records(): Generator<UsageRecord> {
      for (const state of files.values()) yield* state.records;
      for (const session of live) for (const sample of session.samples) yield { ...sample, cwd: session.cwd, session: session.id };
    }
    const value = summarize(records(), range, timeZone, options, now, prices); this.memo = { key, value }; return value;
  }

  /** 每次最多推进一批目录项和四 MiB 日志，保存时游标与计数一致。 */
  private async update(force: boolean): Promise<void> {
    const now = this.clock();
    if (!this.loaded) { this.files = new Map((await this.cache.open()).map(file => [file.file, file])); this.loaded = true; this.revision++; }
    if (!this.cache.owner) {
      if (force || now - this.lastFollowerRead > 5000) {
        await this.cache.claim(); this.files = new Map((await this.cache.load()).map(file => [file.file, file])); this.lastFollowerRead = now; this.revision++;
      }
      if (!this.cache.owner) return;
    }
    if (!this.discovery && (force || now >= this.nextDiscovery)) {
      this.targets.clear(); this.discovery = this.discover(now); this.nextDiscovery = now + 30000; this.readErrors = 0; this.limited = false;
      for (const [file, state] of this.files) {
        const before = state.records.length;
        state.records = state.records.filter(record => record.end >= now - RETENTION);
        if (state.records.length !== before) this.dirty = true;
        if (!state.records.length && state.mtime < now - RETENTION) { this.files.delete(file); this.dirty = true; }
      }
      this.revision++;
    }
    for (let index = 0; this.discovery && index < 96 && !this.disposed && !this.paused; index++) {
      try {
        const next = await this.discovery.next();
        if (next.done) this.discovery = undefined;
        else this.targets.set(next.value.file, { size: next.value.size, mtime: next.value.mtime });
      } catch { this.readErrors++; this.discovery = undefined; }
    }
    let budget = 4 * 1024 * 1024, visited = 0;
    let records = [...this.files.values()].reduce((sum, file) => sum + file.records.length, 0);
    const targets = [...this.targets];
    for (let index = 0; index < targets.length; index++) {
      if (this.disposed || this.paused || budget <= 0 || visited >= 12) break;
      const [file, target] = targets[this.cursor++ % targets.length]!;
      if (records >= MAX_RECORDS || this.files.size >= MAX_FILES && !this.files.has(file)) { this.limited = true; break; }
      let state = this.files.get(file);
      if (state?.costVersion === 1 && state.offset >= target.size && state.mtime === target.mtime) continue;
      visited++;
      if (!state) { state = emptyFile(file); this.files.set(file, state); }
      const before = state.records.length;
      const cursor = `${state.offset}:${state.size}:${state.mtime}:${state.identity}:${state.costVersion}`;
      try {
        budget -= await readHistoryFile(state, budget, now - RETENTION, MAX_RECORDS - records);
        this.targets.set(file, { size: state.size, mtime: state.mtime });
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.targets.delete(file);
        else this.readErrors++;
      }
      records += state.records.length - before; this.revision++;
      if (before !== state.records.length || cursor !== `${state.offset}:${state.size}:${state.mtime}:${state.identity}:${state.costVersion}`) this.dirty = true;
    }
    const complete = !this.status.indexing && !this.limited && !this.readErrors;
    if (complete !== this.cache.complete) this.dirty = true;
    if (this.dirty && (force || now - this.lastSave >= 10000 || !this.status.indexing && visited > 0)) {
      await this.cache.save([...this.files.values()], complete); this.lastSave = now;
      if (!this.cache.error) this.dirty = false;
    }
  }

  /** 有界目录发现，不跟随符号链接；旧会话只要近期更新仍然会被回填。 */
  private async *discover(now: number): AsyncGenerator<{ file: string; size: number; mtime: number }> {
    const queue = [{ file: path.join(this.home, 'sessions'), depth: 0 }];
    let visited = 0;
    while (queue.length && !this.disposed) {
      const current = queue.shift()!;
      let directory: Dir;
      try { directory = await fs.opendir(current.file); } catch { this.readErrors++; continue; }
      for await (const entry of directory) {
        if (this.disposed) return;
        if (++visited > 20000) { this.limited = true; return; }
        const file = path.join(current.file, entry.name);
        if (entry.isDirectory() && current.depth < 6) queue.push({ file, depth: current.depth + 1 });
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        try { const stat = await fs.stat(file); if (stat.mtimeMs >= now - RETENTION) yield { file, size: stat.size, mtime: stat.mtimeMs }; }
        catch { this.readErrors++; }
      }
      // Codex 日期目录按新到旧处理，达到发现上限时优先保留近期记录。
      queue.sort((a, b) => b.file.localeCompare(a.file));
    }
  }

  /** 等待正在进行的只读任务后提交并释放锁，配置切换不丢失已回填结果。 */
  async dispose(): Promise<void> {
    this.disposed = true; await this.running;
    const complete = !this.status.indexing && !this.limited && !this.readErrors;
    await this.discovery?.return(undefined); this.discovery = undefined;
    if (this.loaded) await this.cache.save([...this.files.values()], complete);
    await this.cache.release();
  }

  /** 停用时保存结果并释放锁，保留内存查询能力。 */
  async pause(): Promise<void> {
    this.paused = true; await this.running;
    const complete = !this.status.indexing && !this.limited && !this.readErrors;
    await this.discovery?.return(undefined); this.discovery = undefined;
    if (this.loaded) await this.cache.save([...this.files.values()], complete);
    await this.cache.release();
  }

  /** 重新启用时由现有轮询接管或读取其他窗口提交的缓存。 */
  resume(): void { this.paused = false; this.lastFollowerRead = 0; this.nextDiscovery = 0; }
}
