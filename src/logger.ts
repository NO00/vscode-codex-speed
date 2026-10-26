import fs from 'node:fs/promises';
import path from 'node:path';

/** 输出通道与有界文件日志的组合；诊断日志从不接收原始会话行。 */
export class FileLogger {
  /** 串行文件写入队列，避免轮转和追加竞争。 */
  private queue: Promise<unknown> = Promise.resolve();
  /** 累计运行写入量，用来限制文件大小。 */
  private bytes = 0;
  /** 实际诊断文件路径。 */
  readonly file: string;

  /** 日志目录位于 VS Code 管理的日志区域中的 logs 子目录。 */
  constructor(directory: string, private readonly output: (message: string) => void) {
    this.file = path.join(directory, 'codex-speed.log');
    this.queue = fs.mkdir(directory, { recursive: true }).then(async () => {
      this.bytes = (await fs.stat(this.file).catch(() => undefined))?.size ?? 0;
    }).catch(() => undefined);
  }

  /** 同时写入输出通道和文件；文件写入失败不会影响测速。 */
  write(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`;
    this.output(line.trimEnd());
    this.queue = this.queue.then(async () => {
      if (this.bytes > 1024 * 1024) {
        await fs.rename(this.file, `${this.file}.previous`).catch(() => undefined);
        this.bytes = 0;
      }
      await fs.appendFile(this.file, line, 'utf8');
      this.bytes += Buffer.byteLength(line);
    }).catch(() => undefined);
  }

  /** 为退出和集成测试提供等待写入完成的接口。 */
  flush(): Promise<unknown> { return this.queue; }
}
