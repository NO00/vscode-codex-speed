import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { CodexParser } from '../parser';
import { IndexedFile } from './types';
import { measured } from '../engine';
import { enrichUsage } from '../cost/usage';

/** 与实时读取器相同的单行上限，历史读取从文件开头而非尾部开始。 */
const MAX_LINE = 2 * 1024 * 1024;

/** 创建只保存断点和计数的文件项。 */
export function emptyFile(file: string): IndexedFile {
  return { file, identity: '', mtime: 0, size: 0, offset: 0, skipping: false, anchor: '', costVersion: 1, parser: new CodexParser(file).checkpoint(), records: [] };
}

/** 读取偏移之前的短哈希，检测截断后在下一次扫描前又增长的日志。 */
async function anchor(handle: fs.FileHandle, offset: number): Promise<string> {
  const buffer = Buffer.alloc(Math.min(128, offset));
  await handle.read(buffer, 0, buffer.length, offset - buffer.length);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 每次受字节预算约束；只提交完整行，不将 JSON 半行或对话正文写入缓存。 */
export async function readHistoryFile(state: IndexedFile, budget: number, cutoff: number, room: number): Promise<number> {
  const handle = await fs.open(state.file, 'r');
  try {
    const stat = await handle.stat(), identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    if (state.identity !== identity || stat.size < state.offset || state.offset && state.anchor !== await anchor(handle, state.offset)) {
      Object.assign(state, emptyFile(state.file)); state.identity = identity;
    }
    if (state.costVersion !== 1) {
      // 旧版未保存模型和缓存命中数；保留原计数，分批重放后按响应身份原位补齐。
      state.offset = 0; state.anchor = ''; state.skipping = false; state.parser = new CodexParser(state.file).checkpoint(); state.costVersion = 1;
    }
    let parser: CodexParser;
    const keys = new Map(state.records.map((record, index) => [record.key, index]));
    parser = new CodexParser(state.file, sample => {
      if (sample.end >= cutoff) {
        const record = { ...sample, cwd: parser.cwd, session: parser.id }, existing = keys.get(sample.key);
        if (existing !== undefined) {
          const old = state.records[existing]!;
          // 旧缓存首次重放使用完整新元数据；之后的重复通知只补缺失项，不覆盖原耗时。
          state.records[existing] = old.inputKnown === undefined ? record : !measured(old) && measured(record) ? enrichUsage(record, old) : enrichUsage(old, record);
        }
        else { keys.set(sample.key, state.records.length); state.records.push(record); room--; }
      }
    });
    parser.restore(state.parser);
    let position = state.offset, pending = Buffer.alloc(0), consumed = 0;
    while (position < stat.size && consumed < budget && room > 0) {
      const buffer = Buffer.alloc(Math.min(65536, budget - consumed, stat.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      consumed += bytesRead;
      let begin = 0;
      for (let index = 0; index < bytesRead; index++) {
        if (buffer[index] !== 10) continue;
        const part = buffer.subarray(begin, index);
        if (!state.skipping && pending.length + part.length <= MAX_LINE) parser.consume((pending.length ? Buffer.concat([pending, part]) : part).toString('utf8'));
        state.skipping = false; pending = Buffer.alloc(0); begin = index + 1;
        state.offset = position + begin; state.parser = parser.checkpoint();
        if (room <= 0) break;
      }
      if (room <= 0) break;
      const rest = buffer.subarray(begin, bytesRead);
      if (!state.skipping) {
        if (pending.length + rest.length > MAX_LINE) { state.skipping = true; pending = Buffer.alloc(0); }
        else pending = pending.length ? Buffer.concat([pending, rest]) : Buffer.from(rest);
      }
      position += bytesRead;
      if (state.skipping) state.offset = position;
    }
    state.size = stat.size; state.mtime = stat.mtimeMs; state.anchor = await anchor(handle, state.offset);
    return consumed;
  } finally { await handle.close(); }
}
