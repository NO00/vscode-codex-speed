import { Sample } from '../types';

/** 同一响应的镜像记录可补全元数据；计数冲突时保持主记录，不拼接不同用量。 */
export function enrichUsage<T extends Sample>(primary: T, other: Sample): T {
  if (primary.input !== other.input || primary.output !== other.output) return primary;
  return { ...primary, model: !primary.model || primary.model === '未知模型' ? other.model : primary.model,
    inputKnown: primary.inputKnown ?? other.inputKnown,
    cachedInput: primary.cachedInput ?? other.cachedInput, cacheWriteInput: primary.cacheWriteInput ?? other.cacheWriteInput };
}
