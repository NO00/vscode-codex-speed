/** 已规范化的非负 64 位序号以十进制字符串保存，缓存不依赖 BigInt 序列化。 */
export function validOrdinal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807');
}

/** 找到 JSON 字符串结尾，转义反斜杠或引号不会终止字符串。 */
function stringEnd(line: string, start: number): number {
  for (let index = start + 1; index < line.length; index++) {
    if (line[index] === '\\') index++;
    else if (line[index] === '"') return index + 1;
  }
  return line.length;
}

/** 跳过已经经 JSON.parse 验证的值；嵌套采用深度计数，避免递归栈溢出。 */
function valueEnd(line: string, start: number): number {
  if (line[start] === '"') return stringEnd(line, start);
  if (line[start] === '{' || line[start] === '[') {
    let depth = 0;
    for (let index = start; index < line.length; index++) {
      const char = line[index];
      if (char === '"') index = stringEnd(line, index) - 1;
      else if (char === '{' || char === '[') depth++;
      else if ((char === '}' || char === ']') && --depth === 0) return index + 1;
    }
    return line.length;
  }
  let end = start;
  while (end < line.length && !/[\s,}\]]/.test(line[end]!)) end++;
  return end;
}

/** 只查询指定对象的直接属性；重复键取最后一个，与 JSON.parse 的语义一致。 */
function property(line: string, start: number, name: string): number | undefined {
  if (line[start] !== '{') return undefined;
  let index = start + 1, found: number | undefined;
  while (index < line.length) {
    while (/[\s,]/.test(line[index] ?? '')) index++;
    if (line[index] !== '"') break;
    const end = stringEnd(line, index), key: unknown = JSON.parse(line.slice(index, end));
    index = end;
    while (/\s/.test(line[index] ?? '')) index++;
    if (line[index++] !== ':') break;
    while (/\s/.test(line[index] ?? '')) index++;
    if (key === name) found = index;
    index = valueEnd(line, index);
  }
  return found;
}

/** 读取原始序号字面量：小数、指数、字符串及越界值均不作为边界或行序号。 */
export function readOrdinal(line: string, field: 'ordinal' | 'subagent_history_start_ordinal'): string | undefined {
  const root = line.search(/\S/);
  const parent = field === 'ordinal' ? root : property(line, root, 'payload');
  if (parent === undefined) return undefined;
  const start = property(line, parent, field);
  if (start === undefined) return undefined;
  const token = line.slice(start, valueEnd(line, start));
  // JSON 的整数 -0 与 0 相等；其他负数不属于序号。
  const value = token === '-0' ? '0' : token;
  return validOrdinal(value) ? value : undefined;
}

/** 两个规范化序号按长度和字典序精确比较，不经过浮点数。 */
export function beforeOrdinal(value: string, boundary: string): boolean {
  return value.length < boundary.length || value.length === boundary.length && value < boundary;
}
