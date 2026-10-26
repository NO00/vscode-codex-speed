/** 解析器识别的会话状态；工具执行不计入模型生成耗时。 */
export type Phase = 'idle' | 'generating' | 'tools';

/** 一次有 token 计数的模型响应；时间取自服务器日志。 */
export interface Sample {
  /** 跨会话去重标识，优先采用服务端 response_id。 */
  key: string;
  /** 请求起点；截断日志无法确定起点时为空。 */
  start: number | undefined;
  /** 用量记录时间，单位为毫秒。 */
  end: number;
  /** 输出 token，已包含 reasoning，不能再次加上 reasoning。 */
  output: number;
  /** 输入 token，仅用于详情。 */
  input: number;
  /** 调用对应的模型名。 */
  model: string;
}

/** 供速度引擎消费的会话快照，不保存对话内容。 */
export interface Session {
  /** 当前日志文件的绝对路径。 */
  file: string;
  /** 会话身份，可用于识别复制历史和并行会话。 */
  id: string;
  /** 创建会话时的工作目录。 */
  cwd: string;
  /** 最近模型。 */
  model: string;
  /** 当前运行阶段。 */
  phase: Phase;
  /** 当前模型调用的起点。 */
  pendingStart: number | undefined;
  /** 最近有效事件的日志时间。 */
  lastEvent: number;
  /** 近半小时的已解析响应。 */
  samples: Sample[];
}

/** 远程扩展宿主使用的监控配置。 */
export interface MonitorOptions {
  /** Codex 数据目录，包含 sessions 子目录。 */
  home: string;
  /** 扫描日期范围。 */
  scanDays: number;
  /** 增量轮询周期。 */
  pollIntervalMs: number;
  /** 选择主机全部会话或当前工作区会话。 */
  scope: 'all' | 'workspace';
  /** 当前工作区的服务器路径。 */
  workspaces: string[];
  /** 是否在生成中估算尚未完成的区间，实测与估算始终分别保留。 */
  showEstimates: boolean;
}

/** UI 所需的测速结果，与 VS Code API 解耦以便回放验证。 */
export interface Snapshot {
  /** 采用三秒滑动窗口汇总的输出 token/s。 */
  rate: number;
  /** 状态栏数字的来源或等待状态。 */
  kind: 'measured' | 'estimated' | 'waiting' | 'tools' | 'idle';
  /** 最近三秒窗口内已完成计数贡献的速度。 */
  measuredRate: number;
  /** 最近三秒窗口内在途估算贡献的速度。 */
  estimatedRate: number;
  /** 估算速度占总速度的比例，范围为 0 到 1；零速度时为零。 */
  estimatedShare: number;
  /** 有效的正在生成会话数。 */
  active: number;
  /** 范围内已跟踪的会话数。 */
  sessions: number;
  /** 近半小时可用的去重响应数。 */
  responses: number;
  /** 近半小时有计数记录的输出 token 总和。 */
  output: number;
  /** 最近一条具备有效耗时的响应。 */
  latest: Sample | undefined;
}

/** 只允许写入操作信息和错误代码的诊断接口。 */
export type Log = (message: string) => void;
