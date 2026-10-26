import fs from 'node:fs/promises';
import { CodexParser } from './parser';

/** 限制单次读取和半行缓存，避免长会话或大工具输出拖慢扩展宿主。 */
const CHUNK = 256 * 1024;
const MAX_LINE = 2 * 1024 * 1024;
const INITIAL_TAIL = 8 * 1024 * 1024;
const POLL_BUDGET = 4 * 1024 * 1024;

/** 有界 JSONL 增量读取器，兼容多字节半行、文件截断和原子替换。 */
export class TranscriptTailer {
  /** 当前文件状态机；日志轮换时整体重建。 */
  parser: CodexParser;
  /** 文件路径，始终只读。 */
  readonly file: string;
  /** 上次读到的字节偏移，不能按 JavaScript 字符数计数。 */
  private offset = 0;
  /** 文件设备及 inode 身份，用来识别原子替换。 */
  private identity = '';
  /** 未完成行的原始字节，等到换行后才进行 UTF-8 解码。 */
  private pending = Buffer.alloc(0);
  /** 启动尾部从半行开始或行过大时跳到下一个换行。 */
  private skipping = false;
  /** 大文件初始化尾部范围的结束位置。 */
  private initialEnd = 0;

  /** 创建尚未打开文件的增量读取器。 */
  constructor(file: string) { this.file = file; this.parser = new CodexParser(file); }

  /** 单次轮询读取有限数据；返回是否已经追上文件当前末尾。 */
  async poll(): Promise<boolean> {
    const handle = await fs.open(this.file, 'r');
    try {
      const stat = await handle.stat();
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      if (identity !== this.identity || stat.size < this.offset) {
        this.identity = identity;
        this.offset = 0;
        this.pending = Buffer.alloc(0);
        this.skipping = false;
        this.parser = new CodexParser(this.file);
        this.initialEnd = stat.size;
        if (stat.size > INITIAL_TAIL) {
          const head = Buffer.alloc(65536);
          const read = await handle.read(head, 0, head.length, 0);
          const lines = head.subarray(0, read.bytesRead).toString('utf8').split('\n');
          for (const line of lines.slice(0, -1)) this.parser.seedMetadata(line);
          this.offset = stat.size - INITIAL_TAIL;
          this.skipping = true;
        }
      }
      const limit = Math.min(stat.size, this.offset + (this.offset < this.initialEnd ? INITIAL_TAIL : POLL_BUDGET));
      while (this.offset < limit) {
        const chunk = Buffer.alloc(Math.min(CHUNK, limit - this.offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        this.consume(chunk.subarray(0, bytesRead));
      }
      return this.offset >= stat.size;
    } finally { await handle.close(); }
  }

  /** 按换行分割原始字节；损坏或过大的单行不影响下一条事件。 */
  private consume(chunk: Buffer): void {
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 10) continue;
      const segment = chunk.subarray(start, index);
      if (!this.skipping && this.pending.length + segment.length <= MAX_LINE) {
        const line = this.pending.length ? Buffer.concat([this.pending, segment]) : segment;
        this.parser.consume(line.toString('utf8'));
      }
      this.pending = Buffer.alloc(0);
      this.skipping = false;
      start = index + 1;
    }
    if (start < chunk.length && !this.skipping) {
      const rest = chunk.subarray(start);
      if (this.pending.length + rest.length > MAX_LINE) {
        this.pending = Buffer.alloc(0); this.skipping = true;
      } else this.pending = Buffer.concat([this.pending, rest]);
    }
  }
}
