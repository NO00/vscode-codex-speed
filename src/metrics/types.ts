/** 订阅周期只来自 Codex 的 rate_limits，不推测套餐的金额上限。 */
export interface QuotaWindow {
  /** 五小时、每周或厂商另行报告的周期。 */
  kind: 'fiveHour' | 'sevenDay' | 'other';
  /** 规范化后的周期分钟数。 */
  minutes: number;
  /** 厂商记录的已用百分比；界面绘制时限制到 0–100。 */
  usedPercent: number;
  /** 日志提供的重置时间，缺失时保持未知。 */
  resetsAt?: number;
}

/** 一个日志目录里最近一次账户额度快照，不包含登录凭证或账户标识。 */
export interface QuotaSnapshot {
  /** 额度记录的服务器时间，单位毫秒。 */
  observed: number;
  /** 日志明确报告的套餐名称，缺失时不猜测。 */
  plan?: string;
  /** 该账户实际拥有的有效周期，最多两个。 */
  windows: QuotaWindow[];
}

/** 全主机账户快照独立于工作区过滤和用量时间范围。 */
export interface QuotaSummary {
  /** 超过一小时标记为旧快照；缺失时明确显示不可用。 */
  state: 'fresh' | 'stale' | 'unavailable';
  /** 未对已用百分比进行外推，也不会因本机时钟到点而假定归零。 */
  snapshot?: QuotaSnapshot;
}

/** 当前首段等待和最近已完成调用的等待使用不同状态，不能混作精确首 token 遥测。 */
export interface LatencySummary {
  /** 等待中取最久请求，已观测取活跃请求均值，空闲时取最近调用。 */
  state: 'waiting' | 'observed' | 'last' | 'unavailable';
  /** 等待毫秒数；缺少请求起点或首段事件时不编造完成值。 */
  ms?: number;
  /** 参与当前读数的请求数。 */
  requests: number;
  /** 已完成调用的完成时间，用于提示读数来源。 */
  at?: number;
}

/** 和主读数同一次计算得到的按模型三秒速度。 */
export interface ModelSpeed {
  /** 日志中的模型原名；空字符串由前端翻译为未知模型。 */
  model: string;
  /** 三秒窗口的总速度及已完成、估算两部分。 */
  rate: number; measuredRate: number; estimatedRate: number; estimatedShare: number;
  /** 当前模型的生成、工具阶段和关联会话数。 */
  active: number; tools: number; sessions: number;
}
