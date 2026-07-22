/**
 * @sofagent/core · security/trust-grading —— 知识可信分级（层 5）
 * v1.1.9 新增
 *
 * trust 与 sensitivity 正交：
 *   - sensitivity 管"谁能看"（public ≤ internal ≤ restricted）
 *   - trust 管"多可信"（official > internal > user > web）
 *
 * 本模块提供 RAG 召回链路的三个判定：
 *   1. isTrustEntryUsable() —— web + restricted 组合直接丢弃（低可信+高敏感=高风险）
 *   2. sortByTrust() —— 召回结果按 trust 降序（official 优先，web 垫底）
 *   3. prepareForPrompt() —— 进 prompt 前的一站式处理：
 *      脱敏（层 4）→ trust 需要包裹则 <untrusted> 包裹（层 1）
 */

import {
  TRUST_ORDER,
  type Sensitivity,
  type Trust,
} from '../memory-contract';
import {
  needsUntrustedWrap,
  redactForPrompt,
  wrapUntrusted,
  type UntrustedSource,
} from './prompt-sanitizer';

/** 带 trust/sensitivity 标注的召回条目（泛型 T 携带业务字段） */
export interface TrustTagged {
  trust: Trust;
  sensitivity: Sensitivity;
}

/**
 * 层 5 可用性判定：web + restricted 组合直接丢弃。
 * 其余组合全部可用（trust 与 sensitivity 正交，各自独立生效）。
 *
 * @param entry 带 trust/sensitivity 的条目
 * @returns true = 可进召回链；false = 丢弃
 */
export function isTrustEntryUsable(entry: TrustTagged): boolean {
  return !(entry.trust === 'web' && entry.sensitivity === 'restricted');
}

/**
 * RAG 召回排序：按 trust 降序（official > internal > user > web）。
 * 同 trust 级别保持原相对顺序（稳定排序）。
 *
 * @param entries 召回条目数组
 * @returns 新数组（原数组不被修改）
 */
export function sortByTrust<T extends TrustTagged>(entries: T[]): T[] {
  return [...entries].sort((a, b) => TRUST_ORDER[b.trust] - TRUST_ORDER[a.trust]);
}

/**
 * 进 prompt 前的一站式处理（层 4 脱敏 → 层 1 包裹）。
 *
 * 流程：
 *   1. redactForPrompt(content, sensitivity) —— restricted 得占位串，其余脱敏
 *   2. trust 为 user/web → <untrusted> 包裹（source 取 trust；
 *      外部传入 source 覆盖时优先——如 federation peer 内容 trust=user 但来源是联邦）
 *   3. official/internal → 不包裹，直接返回脱敏结果
 *
 * @param content 条目内容
 * @param entry 条目的 trust/sensitivity
 * @param source 可选来源覆盖（默认按 trust 映射）
 * @returns 可安全拼进 prompt 的字符串
 */
export function prepareForPrompt(
  content: string,
  entry: TrustTagged,
  source?: UntrustedSource,
): string {
  const redacted = redactForPrompt(content, entry.sensitivity);
  if (!needsUntrustedWrap(entry.trust)) return redacted;
  // trust=user → source='user'；trust=web → source='web'（除非调用方覆盖）
  const resolvedSource: UntrustedSource = source ?? (entry.trust === 'web' ? 'web' : 'user');
  return wrapUntrusted(redacted, resolvedSource);
}
