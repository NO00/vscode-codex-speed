/** 每百万 token 的美元单价；长上下文规则作用于整个请求。 */
export interface ModelPrice {
  /** 普通输入、缓存读取、输出的标准单价。 */
  input: number; cachedInput: number; output: number;
  /** 超过阈值后的三项倍率；未提供时不额外加价。 */
  longContext?: { threshold: number; input: number; cachedInput: number; output: number };
}

/** 经过校验的离线价格表，签名用于使历史查询缓存失效。 */
export interface PriceBook {
  /** 自定义条目覆盖内置表，无效条目显式设为空。 */
  overrides: ReadonlyMap<string, ModelPrice | null>;
  /** 表内容的稳定身份。 */
  signature: string;
}

/** 一类已知 token 的费用，未计价计数另行记录，不能冒充零费用。 */
export interface CostPart {
  /** 已确定分类的 token 总数、成功计价的 token 数和美元金额。 */
  tokens: number; pricedTokens: number; usd: number;
}

/** 一个模型的合计，保留覆盖率及不完整原因供界面解释。 */
export interface ModelCost {
  /** 日志模型名；空字符串表示日志未记录。 */
  model: string;
  /** 价格来源和可选的单价。 */
  source: 'builtin' | 'custom' | 'unknown'; price?: ModelPrice;
  /** 普通输入、缓存读取及输出的已知分类。 */
  ordinary: CostPart; cached: CostPart; output: CostPart;
  /** 已知美元小计；完整响应数、全部响应数。 */
  usd: number; complete: number; responses: number;
  /** 分类未知的输入、无法确定输入总量的响应、被排除的写入数。 */
  unknownInput: number; missingInput: number; cacheWrites: number;
  /** 适用长上下文加价的响应数量。 */
  longContextResponses: number;
}

/** 与所选时间和工作区范围完全一致的费用汇总。 */
export interface CostSummary {
  /** 各模型分别计价后的明细。 */
  models: ModelCost[];
  /** 已知金额及三种费用分项。 */
  usd: number; ordinary: CostPart; cached: CostPart; output: CostPart;
  /** 完整计价的响应覆盖率及未知信息，完整零费用仍可明确显示零。 */
  complete: number; responses: number; unknownInput: number; missingInput: number; cacheWrites: number;
  /** 离线内置价格快照日期，不表示旧调用发生时的历史单价。 */
  priceDate: string;
}
