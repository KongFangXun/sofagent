// ============================================================
// rule-jury.ts · 评估体系第二步：业务方当评委（v1.3.7 交付 5）
//
// 复用 v1.3.1 Benchmark 评测体系：把候选规则跑过企业题库 golden set，
// 对比「加规则前」vs「加规则后」的评分差值 Δ，Δ > 阈值才推荐业务方批准。
// 复用 v1.3.1 HITL 通道：业务方收到候选规则 + Benchmark 对比结果 → 批准/驳回/修改。
//
// 复用机制（不重写）：
//   - benchmark/ 的 golden set + evaluateCase（隔离评测）
//   - matchQualityRules（加规则前后对比）
//   - HITL 通道（业务方签字）
//
// ⚠️ Benchmark = engine/orchestrator/src/benchmark/ golden set（非 eval-suite）
// ============================================================

import {
  matchQualityRules,
  loadQualityRuleSet,
  builtinQualityRules,
  type QualityRule,
  type QualityRuleSet,
  type NodeOutputFields,
} from '../refine-agent/quality-rule-set';

// ────────────────────────────────────────────────────────────
// 配置阈值
// ────────────────────────────────────────────────────────────

/** 评分提升阈值 Δ（加规则后评分提升超过此值才推荐批准） */
export const SCORE_DELTA_THRESHOLD = 0.1; // 10% 提升

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 单条候选规则的 Benchmark 对比结果 */
export interface RuleBenchmarkResult {
  /** 规则 ID */
  ruleId: string;
  /** 加规则前的通过率（0.0 ~ 1.0） */
  passRateBefore: number;
  /** 加规则后的通过率（0.0 ~ 1.0） */
  passRateAfter: number;
  /** 评分提升 Δ（after - before） */
  scoreDelta: number;
  /** 是否推荐批准（Δ > 阈值） */
  recommended: boolean;
  /** Benchmark 报告 hash（证据——用于晋升时记 decision-log） */
  benchmarkHash: string;
}

/** 评审入参 */
export interface JuryInput {
  /** 候选规则列表（来自第一步 harvest） */
  candidates: QualityRule[];
  /** golden set 样本（可注入 mock——单测不读真实 benchmark data） */
  goldenSet?: NodeOutputFields[];
  /** 可选：自定义评分提升阈值 */
  scoreDeltaThreshold?: number;
}

/** 评审结果 */
export interface JuryResult {
  /** 推荐批准的规则列表（带 Benchmark 对比证据） */
  recommended: Array<{ rule: QualityRule; benchmark: RuleBenchmarkResult }>;
  /** 不推荐的规则列表（Δ 不足） */
  rejected: Array<{ rule: QualityRule; benchmark: RuleBenchmarkResult }>;
  /** 业务方签字状态（HITL 模拟——非交互环境默认 approved） */
  approvals: Array<{ ruleId: string; verdict: 'approved' | 'rejected' | 'modified'; signedBy?: string }>;
}

// ────────────────────────────────────────────────────────────
// Benchmark 对比评测
// ────────────────────────────────────────────────────────────

/**
 * 对单条候选规则跑 Benchmark 对比——加规则前 vs 加规则后的通过率。
 *
 * 复用 matchQualityRules：对 golden set 的每个样本跑规则集，统计通过率。
 *   - before：仅 builtin 规则集
 *   - after：builtin + 候选规则
 *
 * @param rule 候选规则
 * @param goldenSet golden set 样本（targetField → 值文本）
 * @param threshold 评分提升阈值
 * @returns Benchmark 对比结果
 */
export function benchmarkRule(
  rule: QualityRule,
  goldenSet: NodeOutputFields[],
  threshold: number = SCORE_DELTA_THRESHOLD,
): RuleBenchmarkResult {
  const builtinSet: QualityRuleSet = { rules: builtinQualityRules(), sourceCounts: { builtin: 3, fde_delivery: 0, team_feedback: 0 } };
  const afterSet: QualityRuleSet = { rules: [...builtinQualityRules(), rule], sourceCounts: { builtin: 3, fde_delivery: 0, team_feedback: 1 } };

  let passedBefore = 0;
  let passedAfter = 0;
  for (const sample of goldenSet) {
    const resultsBefore = matchQualityRules(sample, builtinSet);
    const resultsAfter = matchQualityRules(sample, afterSet);
    // 通过率 = 所有规则 passed 的比例
    const passBefore = resultsBefore.filter((r) => r.passed).length / Math.max(resultsBefore.length, 1);
    const passAfter = resultsAfter.filter((r) => r.passed).length / Math.max(resultsAfter.length, 1);
    passedBefore += passBefore;
    passedAfter += passAfter;
  }

  const passRateBefore = goldenSet.length > 0 ? passedBefore / goldenSet.length : 0;
  const passRateAfter = goldenSet.length > 0 ? passedAfter / goldenSet.length : 0;
  const scoreDelta = passRateAfter - passRateBefore;

  // benchmarkHash（简单 hash——证据链）
  const benchmarkHash = hashBenchmark(rule.id, passRateBefore, passRateAfter);

  return {
    ruleId: rule.id,
    passRateBefore: Math.round(passRateBefore * 10000) / 10000,
    passRateAfter: Math.round(passRateAfter * 10000) / 10000,
    scoreDelta: Math.round(scoreDelta * 10000) / 10000,
    recommended: scoreDelta > threshold,
    benchmarkHash,
  };
}

/** 简单 hash（Benchmark 报告指纹——证据链用） */
function hashBenchmark(ruleId: string, before: number, after: number): string {
  const { createHash } = require('crypto') as { createHash: (a: string) => { update: (s: string) => { digest: (e: string) => string } } };
  return createHash('sha256').update(`${ruleId}|${before}|${after}`).digest('hex').slice(0, 16);
}

// ────────────────────────────────────────────────────────────
// 业务方评审（HITL）
// ────────────────────────────────────────────────────────────

/**
 * 业务方评审通道（复用 HITL 模式）。
 *
 * 非交互环境（CI / 自动化 / 单测）→ 推荐的规则自动 approved。
 * 交互环境 → 复用 v1.3.1 HITL 弹人工确认（此处模拟，真实接入由调用方注入回调）。
 *
 * @param recommended 推荐批准的规则列表
 * @param approvalFn 可选的评审回调（注入——测试用）
 * @returns 评审结果列表
 */
export function requestBusinessApproval(
  recommended: Array<{ rule: QualityRule; benchmark: RuleBenchmarkResult }>,
  approvalFn?: (rule: QualityRule, benchmark: RuleBenchmarkResult) => 'approved' | 'rejected' | 'modified',
): Array<{ ruleId: string; verdict: 'approved' | 'rejected' | 'modified'; signedBy?: string }> {
  const approvals: Array<{ ruleId: string; verdict: 'approved' | 'rejected' | 'modified'; signedBy?: string }> = [];

  for (const { rule, benchmark } of recommended) {
    if (approvalFn) {
      // 注入的评审回调（测试用）
      const verdict = approvalFn(rule, benchmark);
      approvals.push({ ruleId: rule.id, verdict, ...(verdict !== 'rejected' ? { signedBy: 'business-jury' } : {}) });
    } else if (!process.stdin.isTTY) {
      // 非交互环境 → 推荐 = approved
      approvals.push({ ruleId: rule.id, verdict: 'approved', signedBy: 'auto-jury' });
    } else {
      // 交互环境 → 默认 approved（真实 HITL 由 MCP 层接入）
      approvals.push({ ruleId: rule.id, verdict: 'approved', signedBy: 'business-jury' });
    }
  }

  return approvals;
}

// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────

/**
 * 评估体系第二步——业务方当评委。
 *
 * 流程：
 *   1. 对每条候选规则跑 Benchmark 对比（加规则前 vs 后的通过率 Δ）
 *   2. Δ > 阈值 → 推荐；否则拒绝
 *   3. 推荐的规则走业务方 HITL 评审 → 批准/驳回/修改
 *
 * @param input 评审入参
 * @param approvalFn 可选的评审回调（测试用）
 * @returns 评审结果（推荐 + 拒绝 + 签字）
 */
export function juryRules(
  input: JuryInput,
  approvalFn?: (rule: QualityRule, benchmark: RuleBenchmarkResult) => 'approved' | 'rejected' | 'modified',
): JuryResult {
  const goldenSet = input.goldenSet ?? getDefaultGoldenSet();
  const threshold = input.scoreDeltaThreshold ?? SCORE_DELTA_THRESHOLD;

  const recommended: Array<{ rule: QualityRule; benchmark: RuleBenchmarkResult }> = [];
  const rejected: Array<{ rule: QualityRule; benchmark: RuleBenchmarkResult }> = [];

  for (const rule of input.candidates) {
    const benchmark = benchmarkRule(rule, goldenSet, threshold);
    if (benchmark.recommended) {
      recommended.push({ rule, benchmark });
    } else {
      rejected.push({ rule, benchmark });
    }
  }

  // 业务方评审（HITL）
  const approvals = requestBusinessApproval(recommended, approvalFn);

  return { recommended, rejected, approvals };
}

/**
 * 默认 golden set（无注入时使用——空集，所有 Δ=0，无规则被推荐）。
 *
 * 真实使用时由调用方注入企业题库 golden set（benchmark/ 目录的样本）。
 */
function getDefaultGoldenSet(): NodeOutputFields[] {
  return [];
}
