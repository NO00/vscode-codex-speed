import { CodexParser } from '../src/parser';

/** 构造完全虚拟的 JSONL，不依赖或复制任何真实对话内容。 */
export function row(time: number, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date(time).toISOString(), type, payload });
}

/** 创建带身份元数据的虚拟会话。 */
export function session(id = 'a', time = 1000000): CodexParser {
  const parser = new CodexParser(`/tmp/${id}.jsonl`);
  parser.consume(row(time, 'session_meta', { id, cwd: '/project' }));
  return parser;
}

/** 向虚拟会话追加一次现代用量响应。 */
export function response(parser: CodexParser, start: number, end: number, output: number, id = `r-${start}`): void {
  parser.consume(row(start, 'event_msg', { type: 'user_message' }));
  parser.consume(row(end, 'token_usage_record', { response_id: id, usage: { input_tokens: 1000, output_tokens: output, reasoning_output_tokens: 25 } }));
}
