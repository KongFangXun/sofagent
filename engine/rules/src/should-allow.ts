// ============================================================
// should-allow.ts · tool-gate 便捷 API（v1.3.3 交付 2）
//
// shouldAllow()——编排层/运行时 wrapper 判定「本次工具调用是否放行」。
// 聚合 RulesEngine.check + aggregate，并额外暴露 requireApproval：
// 任一规则判定 requireApproval=true 时挂起人工批准（交付 3 HITL 消费）。
// ============================================================

import type { RulesEngine } from './engine';
import type { ToolCallContext } from './types';

/** shouldAllow 判定结果 */
export interface ShouldAllowResult {
  /** 是否放行（FAIL → false；WARN/PASS → true） */
  allow: boolean;
  /** 判定理由（聚合 details） */
  reason: string;
  /** 是否需要人工批准（任一规则 requireApproval=true） */
  requireApproval: boolean;
}

/**
 * 判定工具调用是否应放行。
 *
 * @param engine 规则引擎实例
 * @param ctx tool call 上下文
 * @returns ShouldAllowResult
 */
export function shouldAllow(
  engine: RulesEngine,
  ctx: ToolCallContext
): ShouldAllowResult {
  const verdicts = engine.check(ctx);
  const agg = engine.aggregate(verdicts);
  const needApproval = verdicts.some((v) => v.requireApproval === true);
  return {
    allow: agg.status !== 'FAIL',
    reason: agg.details.join('; '),
    requireApproval: needApproval,
  };
}
