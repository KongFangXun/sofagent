// ============================================================
// rule-promote.ts · 评估体系第三步：晋升到 builtin（v1.3.4 交付 5）
//
// 业务方批准的规则晋升到 builtinQualityRules，source 从 team_feedback → builtin。
// 下次 Refine Agent 循环自动加载新规则——质量规则从生产中长出来，又回到生产。
//
// 晋升记录写 decision-log：kind=EVOLUTION，evidence=[Benchmark hash, 业务方签字, 调用量]。
//
// 复用机制（不重写）：
//   - builtinQualityRules：晋升目标
//   - emitDecision：审计记录（kind=EVOLUTION）
//   - QualityRule.source：team_feedback → builtin
// ============================================================

import {
  builtinQualityRules,
  type QualityRule,
} from '../refine-agent/quality-rule-set';
import { emitDecision } from '@sofagent/audit';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 晋升入参 */
export interface PromoteInput {
  /** 业务方批准的规则列表（来自第二步 jury 的 recommended + approved） */
  approvedRules: QualityRule[];
  /** 对应的 Benchmark 证据（hash） */
  benchmarks: Array<{ ruleId: string; benchmarkHash: string; scoreDelta: number }>;
  /** 业务方签字 */
  approvals: Array<{ ruleId: string; signedBy?: string }>;
  /** 市场调用量数据（证据三件套之一） */
  invokeStats?: Array<{ capabilityId: string; invokeCount: number }>;
  /** Agent ID（审计用） */
  agentId?: string;
}

/** 晋升结果 */
export interface PromoteResult {
  /** 晋升的规则列表（source 已改为 builtin） */
  promoted: QualityRule[];
  /** 晋升后的完整 builtin 规则集 */
  builtinSet: QualityRule[];
  /** 晋升记录的 decision-log 条目数 */
  loggedCount: number;
}

// ────────────────────────────────────────────────────────────
// 晋升核心
// ────────────────────────────────────────────────────────────

/**
 * 把一条规则从 team_feedback 晋升为 builtin。
 *
 * - source: 'team_feedback' → 'builtin'
 * - id: 保留原 id 前缀，加 'builtin-' 前缀防冲突
 * - 其余字段不变
 *
 * @param rule 待晋升规则
 * @returns 晋升后的规则（source=builtin）
 */
export function promoteRule(rule: QualityRule): QualityRule {
  return {
    ...rule,
    source: 'builtin',
    id: rule.id.startsWith('builtin-') ? rule.id : `builtin-promoted-${rule.id}`,
  };
}

/**
 * 检查规则是否已在 builtin 集合中（去重——防重复晋升）。
 *
 * @param rule 待检查规则
 * @param builtinSet 当前 builtin 集合
 * @returns 是否已存在（check + targetField 相同视为重复）
 */
export function isAlreadyBuiltin(rule: QualityRule, builtinSet: QualityRule[]): boolean {
  return builtinSet.some(
    (b) => b.check === rule.check && b.targetField === rule.targetField,
  );
}

// ────────────────────────────────────────────────────────────
// 主入口：批量晋升 + 审计
// ────────────────────────────────────────────────────────────

/**
 * 评估体系第三步——晋升到 builtin 规则集。
 *
 * 流程：
 *   1. 去重：已在 builtin 的规则跳过（防重复晋升）
 *   2. 晋升：source team_feedback → builtin
 *   3. 审计：每条晋升记录 kind=EVOLUTION，evidence=[Benchmark hash, 业务方签字, 调用量]
 *
 * @param input 晋升入参
 * @returns 晋升结果
 */
export function promoteRules(input: PromoteInput): PromoteResult {
  const currentBuiltin = builtinQualityRules();
  const promoted: QualityRule[] = [];
  let loggedCount = 0;

  // 签字 + Benchmark 证据索引
  const approvalMap = new Map(input.approvals.map((a) => [a.ruleId, a.signedBy ?? 'unknown']));
  const benchmarkMap = new Map(input.benchmarks.map((b) => [b.ruleId, b]));
  const invokeMap = new Map((input.invokeStats ?? []).map((s) => [s.capabilityId, s.invokeCount]));

  for (const rule of input.approvedRules) {
    // 去重
    if (isAlreadyBuiltin(rule, currentBuiltin)) {
      continue;
    }

    const promotedRule = promoteRule(rule);
    promoted.push(promotedRule);
    currentBuiltin.push(promotedRule);

    // 审计（kind=EVOLUTION——晋升是经验层进化）
    const benchmark = benchmarkMap.get(rule.id);
    const signedBy = approvalMap.get(rule.id) ?? 'unknown';
    const invokeCount = invokeMap.get(rule.id) ?? 0;

    try {
      emitDecision({
        agentId: input.agentId ?? 'market-rule-promote',
        sessionId: `market-promote-${rule.id}`,
        kind: 'EVOLUTION',
        moment: 'EVOLVE',
        why: {
          text: `质量规则「${rule.description}」晋升到 builtin（team_feedback → builtin）`,
          tags: ['market', 'rule-promote', 'evolution'],
          confidence: 'high',
        },
        artifactRef: rule.id,
        evidence: [
          `benchmark-hash: ${benchmark?.benchmarkHash ?? 'n/a'}`,
          `score-delta: ${benchmark?.scoreDelta ?? 'n/a'}`,
          `business-signoff: ${signedBy}`,
          `invoke-count: ${invokeCount}`,
        ],
      });
      loggedCount++;
    } catch (err) {
      process.stderr.write(
        `[rule-promote] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return {
    promoted,
    builtinSet: currentBuiltin,
    loggedCount,
  };
}
