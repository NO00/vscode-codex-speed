import { Sample } from '../types';

/** 同一响应镜像补全元数据；明确输入优先于缺失占位，但不拼接相互冲突的真实计数。 */
export function enrichUsage<T extends Sample>(primary: T, other: Sample): T {
  if (primary.output !== other.output) return primary;
  const primaryKnown = primary.inputKnown ?? primary.cachedInput !== undefined;
  const otherKnown = other.inputKnown ?? other.cachedInput !== undefined;
  if (primaryKnown && otherKnown && primary.input !== other.input) return primary;
  const input = !primaryKnown && otherKnown ? other : primary;
  const fallback = input === primary ? other : primary;
  const match = primary.input === other.input;
  return { ...primary, model: !primary.model || primary.model === '未知模型' ? other.model : primary.model,
    input: input.input, inputKnown: primaryKnown || otherKnown,
    cachedInput: match ? input.cachedInput ?? fallback.cachedInput : input.cachedInput,
    cacheWriteInput: match ? input.cacheWriteInput ?? fallback.cacheWriteInput : input.cacheWriteInput };
}
