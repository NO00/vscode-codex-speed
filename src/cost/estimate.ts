import { Sample } from '../types';
import { defaultPrices, findPrice, PRICE_DATE } from './catalog';
import { CostPart, CostSummary, ModelCost, PriceBook } from './types';

/** 独立创建各分项，避免对象引用复用导致三类费用互相污染。 */
function part(): CostPart { return { tokens: 0, pricedTokens: 0, usd: 0 }; }

/** 在最终显示前不舍入；未知单价保留 token，但不伪造已计价金额。 */
function add(target: CostPart, tokens: number, price: number | undefined): void {
  target.tokens += tokens;
  if (price !== undefined) { target.pricedTokens += tokens; target.usd += tokens * price / 1000000; }
}

/** 对已按响应身份去重的记录计价；输入分类未知时只计算确定的分项。 */
export function estimateCost(samples: Iterable<Sample>, book: PriceBook = defaultPrices): CostSummary {
  const models = new Map<string, ModelCost>();
  for (const sample of samples) {
    const model = sample.model === '未知模型' ? '' : sample.model;
    let row = models.get(model);
    if (!row) {
      const found = findPrice(model, book);
      row = { model, ...found, ordinary: part(), cached: part(), output: part(), usd: 0, complete: 0, responses: 0,
        unknownInput: 0, missingInput: 0, missingWrites: 0, cacheWrites: 0, longContextResponses: 0 };
      models.set(model, row);
    }
    row.responses++;
    // 旧记录缺少 inputKnown，但若具有缓存拆分即可确认输入元数据已回填。
    const inputKnown = sample.inputKnown ?? sample.cachedInput !== undefined;
    const rule = row.price?.longContext;
    const long = inputKnown && !!rule && sample.input > rule.threshold;
    const rateKnown = !rule || inputKnown;
    const price = rateKnown ? row.price : undefined;
    if (long) row.longContextResponses++;
    add(row.output, sample.output, price ? price.output * (long ? rule!.output : 1) : undefined);
    const cached = sample.cachedInput ?? (inputKnown && sample.input === 0 ? 0 : undefined);
    // 全输入均为缓存命中或模型没有写入价时，可由上下界确定零写入；其余缺失保持未知。
    const writes = sample.cacheWriteInput ?? (inputKnown && cached === sample.input || row.price?.cacheWrites === false ? 0 : undefined);
    const cachedValid = inputKnown && cached !== undefined && cached <= sample.input;
    const validSplit = cachedValid && writes !== undefined && cached + writes <= sample.input;
    if (validSplit) {
      add(row.ordinary, sample.input - cached - writes, price ? price.input * (long ? rule!.input : 1) : undefined);
      add(row.cached, cached, price ? price.cachedInput * (long ? rule!.cachedInput : 1) : undefined);
      row.cacheWrites += writes;
    } else if (cachedValid && writes === undefined) {
      // 缓存读取与输出仍可计价；剩余输入可能是写入，不能按普通输入单价冒充已知费用。
      add(row.cached, cached, price ? price.cachedInput * (long ? rule!.cachedInput : 1) : undefined);
      row.unknownInput += sample.input - cached; row.missingWrites++;
    } else {
      if (inputKnown) row.unknownInput += sample.input;
      else row.missingInput++;
      if (sample.cacheWriteInput !== undefined) row.cacheWrites += sample.cacheWriteInput;
    }
    if (price && validSplit && writes === 0) row.complete++;
    row.usd = row.ordinary.usd + row.cached.usd + row.output.usd;
  }
  const result: CostSummary = { models: [...models.values()].sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model)),
    ordinary: part(), cached: part(), output: part(), usd: 0, complete: 0, responses: 0, unknownInput: 0, missingInput: 0, missingWrites: 0, cacheWrites: 0, priceDate: PRICE_DATE };
  for (const row of result.models) {
    for (const key of ['ordinary', 'cached', 'output'] as const) for (const field of ['tokens', 'pricedTokens', 'usd'] as const) result[key][field] += row[key][field];
    for (const key of ['usd', 'complete', 'responses', 'unknownInput', 'missingInput', 'missingWrites', 'cacheWrites'] as const) result[key] += row[key];
  }
  return result;
}
