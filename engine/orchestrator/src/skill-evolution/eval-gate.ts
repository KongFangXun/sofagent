// ============================================================
// skill-evolution/eval-gate.ts · 技能进化 eval 门控
// v1.4.5 第七章四新增（WikiSkill 机制收编）
// ============================================================
//
// 门控量化：技能变更须过 eval 验证集、分数超历史最优才收编——
// 进化模块「过验证才发布」的最后一块。接通 orchestrator 既有
// eval 闭环（benchmark/evaluation-log 的 appendEvaluationRecord /
// readEvaluationLog——HMAC 链防篡改），不重复实现评分。
//
// 裁决语义（不超历史最优即回滚）：
//   - evalScore > historicalBest（或无历史）→ passed（可收编）
//   - evalScore ≤ historicalBest → rolled-back（拒绝 + 台账落账带原因）
//   - eval 不可跑（无验证集）→ fail-safe 拒绝（无验证不收编）
// ============================================================

import { appendEvaluationRecord, readEvaluationLog } from '../benchmark/evaluation-log';
import {
  appendSkillImpactEntry,
  historicalBestScore,
} from './skill-impact-ledger';
import type { SkillImpactEntry } from './skill-impact-ledger';

/** 门控输入 */
export interface EvalGateInput {
  /** 数据根目录 */
  dataDir: string;
  /** 目标技能路径 */
  skillPath: string;
  /** 技能 slug */
  slug: string;
  /** 回链 pattern（solves: 同源值） */
  solvesPattern: string;
  /** unified diff 全文（程序化生成） */
  unifiedDiff: string;
  /** eval 验证集 benchmark ID（门控跑分的对象） */
  benchmarkId: string;
  /** 各 case 得分（0-100——调用方经 evalCase 评分产出） */
  caseScores: Array<{ caseId: string; score: number }>;
  /** 操作者标识 */
  actor?: string;
}

/** 门控裁决结果 */
export interface EvalGateResult {
  /** 是否通过门控（true = 可收编） */
  passed: boolean;
  /** 本轮验证分（各 case 均分，0-100） */
  evalScore: number;
  /** 历史最优对照线（无历史 null） */
  historicalBest: number | null;
  /** 裁决说明 */
  reason: string;
  /** 台账落账的提案 ID */
  proposalId: string;
}

/** 生成提案 ID（proposal-<ISO 紧凑>-<随机 4 位>） */
function makeProposalId(): string {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `proposal-${ts}-${seq}`;
}

/**
 * 跑 eval 门控——评分写入 evaluation-log（既有闭环），裁决写入
 * skill-impact 台账（accepted/rejected 都落账）。
 *
 * 复用边界：本函数不做 case 级评分（agentFn/scoreFn 由调用方先跑，
 * caseScores 传入）——本函数只做「记 eval 分 + 对照历史最优 + 裁决
 * 落账」的确定性环节。
 */
export function runEvalGate(input: EvalGateInput): EvalGateResult {
  const proposalId = makeProposalId();
  const ts = new Date().toISOString();

  // 一、case 得分写入 evaluation-log（既有 eval 闭环——HMAC 链防篡改）
  let totalScore = 0;
  for (const c of input.caseScores) {
    appendEvaluationRecord(
      {
        benchmarkId: input.benchmarkId,
        caseId: c.caseId,
        revision: 1,
        score: c.score,
        failureCode: null,
        durationMs: 0,
        agentId: input.actor,
      },
      input.dataDir,
    );
    totalScore += c.score;
  }
  const evalScore =
    input.caseScores.length > 0 ? Math.round(totalScore / input.caseScores.length) : 0;

  // 二、对照历史最优（台账 accepted 记录的最大分）
  const historicalBest = historicalBestScore(input.dataDir, input.skillPath);

  // 三、裁决（不超历史最优即回滚——fail-safe：无 case 不收编）
  let passed: boolean;
  let reason: string;
  let verdict: SkillImpactEntry['verdict'];
  let rejectReason: string | undefined;
  if (input.caseScores.length === 0) {
    passed = false;
    verdict = 'rejected';
    rejectReason = 'eval 验证集为空——无验证不收编（fail-safe）';
    reason = rejectReason;
  } else if (historicalBest === null) {
    passed = true;
    verdict = 'accepted';
    reason = `首提案（无历史对照线）：eval=${evalScore}，过门控收编`;
  } else if (evalScore > historicalBest) {
    passed = true;
    verdict = 'accepted';
    reason = `eval=${evalScore} 超历史最优 ${historicalBest}，过门控收编`;
  } else {
    passed = false;
    verdict = 'rejected';
    rejectReason = `eval=${evalScore} 未超历史最优 ${historicalBest}——回滚（不超最优不收编）`;
    reason = rejectReason;
  }

  // 四、台账落账（accepted/rejected 都落——被拒提案不丢教训）
  appendSkillImpactEntry(input.dataDir, {
    proposalId,
    ts,
    skillPath: input.skillPath,
    slug: input.slug,
    solvesPattern: input.solvesPattern,
    unifiedDiff: input.unifiedDiff,
    evalScore,
    historicalBest,
    verdict,
    ...(rejectReason ? { rejectReason } : {}),
    actor: input.actor ?? 'skill-evolution:eval-gate',
  });

  return { passed, evalScore, historicalBest, reason, proposalId };
}

/**
 * 回读验证（报告/审计用）：某 proposal 的 eval 记录可回溯路径。
 * 证据树：结论（台账条目）→ 样本文件 → 原始 eval 记录（本函数返回路径）。
 */
export function evalRecordsForProposal(
  dataDir: string,
  benchmarkId: string,
  agentId: string,
): ReturnType<typeof readEvaluationLog> {
  return readEvaluationLog({ benchmarkId, agentId }, dataDir);
}
