#!/usr/bin/env bash
TASK_NAME=inspect
source "$(dirname "$0")/common.sh"
node <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex');
const dir = path.join(home, 'sessions', '2026', '10', '26');
const file = fs.readdirSync(dir).find(f => f.endsWith('.jsonl'));
const counts = {};
const schemas = {};
for (const line of fs.readFileSync(path.join(dir,file),'utf8').split('\n')) {
  try {
    const row = JSON.parse(line);
    const kind = row.type + '/' + (row.payload?.type || '');
    counts[kind] = (counts[kind] || 0) + 1;
    if (row.type === 'token_usage_record') schemas.modern = row.payload;
    if (row.type === 'event_msg' && row.payload?.type === 'token_count') schemas.legacy = row.payload.info;
  } catch {}
}
// 只输出事件类型和用量结构，不输出会话文本、身份或文件路径。
console.log(JSON.stringify({counts,schemas},null,2));
JS
