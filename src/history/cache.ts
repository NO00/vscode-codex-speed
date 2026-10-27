import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { HistoryCache, IndexedFile } from './types';

/** 限制持久化文件及记录数，超过上限时明确显示统计不完整。 */
export const MAX_RECORDS = 250000;
export const MAX_FILES = 12000;
const MAX_BYTES = 64 * 1024 * 1024;

/** 检查数字及解析断点，损坏缓存不能产生伪造速度或任意来源路径。 */
function validate(cache: HistoryCache, home: string): void {
  if (cache.version !== 1 || cache.home !== home || typeof cache.complete !== 'boolean' || !Array.isArray(cache.files) || cache.files.length > MAX_FILES) throw new Error('INVALID_CACHE');
  let count = 0;
  const numeric = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
  const tokens = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  for (const file of cache.files) {
    const relative = path.relative(path.join(home, 'sessions'), file.file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !file.file.endsWith('.jsonl')) throw new Error('INVALID_PATH');
    if (!tokens(file.offset) || !tokens(file.size) || !numeric(file.mtime) || typeof file.identity !== 'string' || typeof file.anchor !== 'string' || typeof file.skipping !== 'boolean'
      || file.costVersion !== undefined && file.costVersion !== 1) throw new Error('INVALID_CURSOR');
    const parser = file.parser;
    if (!parser || !['id', 'cwd', 'model'].every(key => typeof parser[key as 'id'] === 'string') || !['idle', 'tools', 'generating'].includes(parser.phase)
      || !numeric(parser.lastEvent) || [parser.pendingStart, parser.created].some(value => value !== undefined && !numeric(value))
      || typeof parser.modern !== 'boolean' || typeof parser.streaming !== 'boolean' || parser.previous && !Object.values(parser.previous).every(tokens)) throw new Error('INVALID_PARSER');
    if (!Array.isArray(file.records) || (count += file.records.length) > MAX_RECORDS) throw new Error('INVALID_RECORDS');
    for (const record of file.records) {
      if (!record || !['key', 'cwd', 'session', 'model'].every(key => typeof record[key as 'key'] === 'string') || !numeric(record.end)
        || record.start !== undefined && !numeric(record.start) || !tokens(record.input) || !tokens(record.output)
        || record.inputKnown !== undefined && typeof record.inputKnown !== 'boolean'
        || [record.cachedInput, record.cacheWriteInput].some(value => value !== undefined && !tokens(value))) throw new Error('INVALID_RECORD');
    }
  }
}

/** 一个宿主数据目录只有一个缓存写入者，其余窗口读取原子提交的结果。 */
export class HistoryCacheStore {
  /** 缓存路径只来自扩展存储目录和 Codex Home 的摘要。 */
  readonly file: string;
  /** 与缓存对应的写入锁。 */
  private readonly lock: string;
  /** 本实例的写入身份，防止旧实例释放新实例的锁。 */
  private readonly token = crypto.randomBytes(16).toString('hex');
  /** 当前是否有写入权；不可持久化时仍可使用独立内存索引。 */
  owner = false;
  /** 持久化故障和重建标识。 */
  error = false; reset = false;
  /** 只读窗口沿用写入者提交的完整性，不能把部分缓存当作完整统计。 */
  complete = false;
  /** 存储目录不可写时不重复尝试写入。 */
  private memoryOnly = false;

  /** home 必须为由扩展入口解析的绝对路径。 */
  constructor(private readonly root: string, readonly home: string) {
    const digest = crypto.createHash('sha256').update(home).digest('hex').slice(0, 24);
    this.file = path.join(root, `usage-${digest}.json`); this.lock = `${this.file}.lock`;
  }

  /** 加载前先准备扩展自己的目录，不向 Codex Home 写入任何文件。 */
  async open(): Promise<IndexedFile[]> {
    try { await fs.mkdir(this.root, { recursive: true }); await this.claim(); }
    catch { this.error = true; this.memoryOnly = true; this.owner = true; }
    return this.load();
  }

  /** 有效缓存只包含计数和断点；损坏时保留空结果并让调用方重建。 */
  async load(): Promise<IndexedFile[]> {
    try {
      if ((await fs.stat(this.file)).size > MAX_BYTES) throw new Error('CACHE_TOO_LARGE');
      const cache: HistoryCache = JSON.parse(await fs.readFile(this.file, 'utf8'));
      validate(cache, this.home); this.complete = cache.complete; return cache.files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reset = true;
      return [];
    }
  }

  /** 正常运行中的其他窗口保留写入权；退出或崩溃后可接管断点。 */
  async claim(): Promise<void> {
    if (this.owner) return;
    try {
      const handle = await fs.open(this.lock, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.token })); this.owner = true; }
      finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const observed = JSON.parse(await fs.readFile(this.lock, 'utf8'));
        if (!Number.isSafeInteger(observed.pid) || observed.pid <= 0) throw new Error('INVALID_LOCK');
        try { process.kill(observed.pid, 0); return; } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') return; }
        const current = JSON.parse(await fs.readFile(this.lock, 'utf8'));
        if (current.token === observed.token) await fs.unlink(this.lock);
      } catch {
        // 建锁时崩溃可能留下空文件；只清理超过一分钟仍无有效 PID 的旧锁。
        try {
          if (Date.now() - (await fs.stat(this.lock)).mtimeMs > 60000) {
            const lock = await fs.readFile(this.lock, 'utf8');
            let valid = false;
            try { const state = JSON.parse(lock); valid = Number.isSafeInteger(state.pid) && state.pid > 0; } catch { /* 空锁或损坏锁。 */ }
            if (!valid) await fs.unlink(this.lock);
          }
        } catch { /* 其他窗口已经释放或修复锁时等待下一轮。 */ }
      }
    }
  }

  /** 游标、解析状态和记录在同一个 JSON 中原子替换，崩溃后可重复回放而不重复计数。 */
  async save(files: IndexedFile[], complete = false): Promise<void> {
    if (!this.owner || this.memoryOnly) return;
    const temporary = `${this.file}.${this.token}.tmp`;
    try {
      const lock = JSON.parse(await fs.readFile(this.lock, 'utf8'));
      if (lock.token !== this.token) { this.owner = false; return; }
      const data = JSON.stringify({ version: 1, home: this.home, complete, files } satisfies HistoryCache);
      if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('CACHE_TOO_LARGE');
      await fs.writeFile(temporary, data, { mode: 0o600 }); await fs.rename(temporary, this.file); this.error = false; this.complete = complete;
    } catch { this.error = true; await fs.unlink(temporary).catch(() => undefined); }
  }

  /** 只删除本实例创建的确切锁文件，不递归清理任何目录。 */
  async release(): Promise<void> {
    if (!this.owner || this.memoryOnly) return;
    try { const lock = JSON.parse(await fs.readFile(this.lock, 'utf8')); if (lock.token === this.token) await fs.unlink(this.lock); } catch { /* 宿主退出时锁已不存在可忽略。 */ }
    this.owner = false;
  }
}
