// ============================================================
// engine.ts · RulesEngine 纯函数入口
// v1.3.0：P3 编排引擎内嵌——规则引擎核心
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from './types';

/**
 * 规则引擎——注册 N 条规则，对 tool call 做批量检查并聚合结果
 *
 * 聚合规则：
 * - 任一 FAIL → FAIL
 * - 否则任一 WARN → WARN
 * - 否则 PASS
 */
export class RulesEngine {
  private readonly rules: ToolRule[];

  constructor(rules: ToolRule[]) {
    this.rules = rules;
  }

  /**
   * 对单个 tool call 执行所有已注册规则的检查
   * @param ctx tool call 上下文
   * @returns 每条规则的判定结果数组
   */
  check(ctx: ToolCallContext): InterceptVerdict[] {
    return this.rules.map((rule) => {
      try {
        return rule.check(ctx);
      } catch (err) {
        // 单条规则异常不应中断整批检查——降级为该规则 FAIL，
        // 让编排层 tool-gate 看到明确违规而非进程崩溃(修复）
        return {
          status: 'FAIL',
          ruleName: rule.name ?? 'unknown-rule',
          ruleNumber: rule.number ?? 0,
          details: [`规则执行异常: ${err instanceof Error ? err.message : String(err)}`],
          suggestion: '请检查该规则实现或上报此异常',
        };
      }
    });
  }

  /**
   * 聚合多条规则判定为单一决策
   * @param verdicts 规则判定结果数组
   * @returns 聚合后的单一判定（取最严重状态）
   */
  aggregate(verdicts: InterceptVerdict[]): InterceptVerdict {
    const hasFail = verdicts.some((v) => v.status === 'FAIL');
    const hasWarn = verdicts.some((v) => v.status === 'WARN');

    if (hasFail) {
      const failed = verdicts.filter((v) => v.status === 'FAIL');
      return {
        status: 'FAIL',
        ruleName: failed.map((v) => v.ruleName).join(', '),
        ruleNumber: 0,
        details: failed.flatMap((v) => v.details),
        suggestion: failed.map((v) => v.suggestion).join('; '),
      };
    }

    if (hasWarn) {
      const warned = verdicts.filter((v) => v.status === 'WARN');
      return {
        status: 'WARN',
        ruleName: warned.map((v) => v.ruleName).join(', '),
        ruleNumber: 0,
        details: warned.flatMap((v) => v.details),
        suggestion: warned.map((v) => v.suggestion).join('; '),
      };
    }

    return {
      status: 'PASS',
      ruleName: '',
      ruleNumber: 0,
      details: [],
      suggestion: '',
    };
  }
}
