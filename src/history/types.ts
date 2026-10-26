import { ParserCheckpoint } from '../parser';
import { Sample } from '../types';

/** 用量时间范围，今天以仪表盘所在客户端的 IANA 时区划分。 */
export type UsageRange = '30m' | 'today' | '7d' | '30d';

/** 可持久化的响应计数，空 model 占位不会存储模型输出或原始行。 */
export interface UsageRecord extends Sample {
  /** 响应发生时的目录，用于切换工作区范围。 */
  cwd: string;
  /** 会话身份，用于与实时会话列表关联。 */
  session: string;
}

/** 单个文件的完整行断点和计数，游标与记录在同一份缓存中原子提交。 */
export interface IndexedFile {
  /** 只读来源路径。 */
  file: string;
  /** 文件身份及最近扫描状态。 */
  identity: string; mtime: number; size: number;
  /** 完整行末尾字节偏移；跳过超长行时可以处于行中。 */
  offset: number; skipping: boolean;
  /** 偏移前一小段字节的哈希，用于发现截断后快速重新增长的文件。 */
  anchor: string;
  /** 最后一条完整事件后的解析状态。 */
  parser: ParserCheckpoint;
  /** 近三十天的已解析用量。 */
  records: UsageRecord[];
}

/** 缓存结构包含数据来源，禁止混用不同 Codex Home。 */
export interface HistoryCache {
  /** 缓存协议版本。 */
  version: 1;
  /** 规范化的宿主数据目录。 */
  home: string;
  /** 写入者上次提交时是否已经追上全部可发现日志。 */
  complete: boolean;
  /** 已保存的文件断点和计数。 */
  files: IndexedFile[];
}

/** 供界面明确显示初次回填、不完整及缓存故障。 */
export interface HistoryStatus {
  /** 尚有发现或读取工作。 */
  indexing: boolean;
  /** 已追上当前文件末尾的文件数和总文件数。 */
  scanned: number; total: number;
  /** 是否到达目录、文件或记录容量上限。 */
  limited: boolean;
  /** 最近发现或读取失败的数量。 */
  readErrors: number;
  /** 无法写入缓存，当前仍可使用内存结果。 */
  cacheError: boolean;
  /** 损坏缓存已经被丢弃并从可用日志重建。 */
  cacheReset: boolean;
  /** 其他窗口负责写入，本窗口只读取已提交缓存。 */
  follower: boolean;
}

/** 查询后的总量以及供当前列表使用的会话计数。 */
export interface UsageSummary {
  /** 当前时间范围和边界，结束边界包含当前宿主时间。 */
  range: UsageRange; from: number; until: number; timeZone: string;
  /** 去重计数和基于已知耗时的平均输出速度。 */
  input: number; output: number; responses: number; average: number;
  /** 只在宿主内部使用，不直接传入 Webview。 */
  bySession: Map<string, { input: number; output: number; responses: number }>;
}
