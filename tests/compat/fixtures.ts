import fs from 'node:fs';

/** 固定上游公开样例，仅作为数据回放，保留来源与 MIT 许可。 */
export function fixture(name: string): string[] { return fs.readFileSync(`tests/fixtures/codex/${name}.jsonl`, 'utf8').trimEnd().split('\n'); }
