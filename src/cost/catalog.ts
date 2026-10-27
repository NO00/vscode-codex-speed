import crypto from 'node:crypto';
import { ModelPrice, PriceBook } from './types';

/** 标准文本 API 价格快照，来源 https://developers.openai.com/api/docs/pricing 。 */
export const PRICE_DATE = '2026-10-27';
/** 模型文档确认的长上下文倍率；严格大于 272K 才适用。 */
const longContext = { threshold: 272000, input: 2, cachedInput: 2, output: 1.5 };
/** 只收录核对过的模型；不把相似名称自动映射到别的收费模型。 */
const builtin: Readonly<Record<string, ModelPrice>> = {
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50, cacheWrites: true, longContext },
  'gpt-6.1-sol': { input: 2, cachedInput: 0.1, output: 10, cacheWrites: true, longContext },
  'gpt-6.1-terra': { input: 1, cachedInput: 0.05, output: 5, cacheWrites: true, longContext },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5, cacheWrites: true, longContext },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20, cacheWrites: true, longContext },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14, cacheWrites: false }
};
/** 仅使用官方模型文档明确声明的别名，不剥除任意日期后缀猜价格。 */
const aliases: Readonly<Record<string, string>> = { 'gpt-5.6': 'gpt-5.6-sol' };

/** 只接受普通 JSON 对象，拒绝数组和空值。 */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** 零价格合法；负数、溢出、字符串以及缺失分项均不能进入计算。 */
function valid(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000; }

/** 校验用户的每百万 token 单价和可选长上下文规则。 */
function price(value: unknown): ModelPrice | null {
  const p = object(value);
  if (!p || !valid(p.input) || !valid(p.cachedInput) || !valid(p.output)) return null;
  const result: ModelPrice = { input: p.input, cachedInput: p.cachedInput, output: p.output };
  if (p.cacheWrites !== undefined) {
    if (typeof p.cacheWrites !== 'boolean') return null;
    result.cacheWrites = p.cacheWrites;
  }
  if (p.longContext !== undefined) {
    const rule = object(p.longContext);
    if (!rule || !valid(rule.threshold) || !Number.isSafeInteger(rule.threshold) || !valid(rule.input) || !valid(rule.cachedInput) || !valid(rule.output)) return null;
    result.longContext = { threshold: rule.threshold, input: rule.input, cachedInput: rule.cachedInput, output: rule.output };
  }
  return result;
}

/** 仅在配置变化时构建，稳定签名使已缓存历史按新单价重新计价。 */
export function createPriceBook(settings: unknown = {}): PriceBook {
  const entries = Object.entries(object(settings) ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([model, value]) => [model, price(value)] as const);
  return { overrides: new Map(entries), signature: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}

/** 默认查询共享同一个离线价格表，不增加任何联网请求。 */
export const defaultPrices = createPriceBook();

/** 优先精确匹配自定义条目，其次只匹配内置名及已核实的官方别名。 */
export function findPrice(model: string, book: PriceBook): { price?: ModelPrice; source: 'builtin' | 'custom' | 'unknown' } {
  const base = Object.hasOwn(aliases, model) ? aliases[model]! : model;
  const p = Object.hasOwn(builtin, base) ? builtin[base] : undefined;
  if (book.overrides.has(model)) {
    const custom = book.overrides.get(model);
    return custom ? { price: { ...custom, cacheWrites: custom.cacheWrites ?? p?.cacheWrites ?? true, longContext: custom.longContext ?? p?.longContext }, source: 'custom' } : { source: 'unknown' };
  }
  return p ? { price: p, source: 'builtin' } : { source: 'unknown' };
}
