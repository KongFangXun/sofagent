// ── API 分级契约（v1.5.7 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/evolve
 *
 * Skill 优化 — Skill 质量分析 / 优化建议 / 自动重构
 */

// ── Skill 安全审查 ──
/* @public */ export {
  scanSkillSafety,
  main as skillSafetyCheckMain,
} from './skill-safety-check';
/* @public */ export {
  findFiles,
  scanFile,
} from '@sofagent/audit';
/* @public */ export type {
  SafetyHit,
  SafetyRule,
  SafetyResult,
} from '@sofagent/audit';

// ── Evolve 集成 ──
/* @public */ export {
  runEvolve,
  validateCandidate,
  isEvolveAvailable,
} from './evolve-integration';
/* @public */ export type {
  EvolveResult,
  ValidationResult,
} from './evolve-integration';

// ── Dream Cycle backfill 钩子（v1.1.6 新增）──
/* @public */ export { backfill, getBackfillQueue, clearBackfillQueue } from './backfill';
/* @public */ export type { BackfillConcept, BackfillEntry } from './backfill';

// ── v1.2.4 P1：失败清单 + 自动触发 + optimize() API ──
/* @public */ export {
  recordFailure,
  getFailurePatterns,
  getFailurePatternsBySkill,
  getRepeatedFailures,
  resolveFailureLedgerPath,
  clearFailureCache,
} from './failure-ledger';
/* @public */ export type { FailureRecord, FailurePattern } from './failure-ledger';
/* @public */ export {
  optimize,
  autoTriggerAll,
  getPendingTriggerCount,
  AUTO_TRIGGER_THRESHOLD,
} from './auto-trigger';
/* @public */ export type { OptimizeInput, OptimizeResult } from './auto-trigger';

// ============================================================
// v1.4.8 ⑩/⑩-2：自研 gate 验证器 + Skill Proposer（四角色合拢）
// ============================================================
/* @public */ export { runNativeGate } from './native-gate';
/* ── v1.5.8 章一：域验证器三档 + 评测集谱系 ── */
/* @public */ export {
  judgeAdmission,
  defaultTierForUnregistered,
  gateStrengthOf,
  isGateStrengthNonDecreasing,
  detectStagnation,
  loadRegistry,
  initializeRegistryProtected,
  computeContentHash,
  MODEL_JUDGE_REVIEW_SAMPLE_RATE,
  STAGNATION_ROUNDS,
  STAGNATION_IMPROVEMENT_THRESHOLD,
} from './domain-verifier-registry';
/* @public */ export type {
  VerifierTier,
  DomainVerifierEntry,
  DomainVerifierRegistryFile,
  AdmissionVerdict,
  GateStrength,
  EvalRoundReading,
  StagnationVerdict,
  RegistryLoad,
} from './domain-verifier-registry';
/* @public */ export {
  registerEvalSetProvenance,
  succeedEvalSet,
  stripAnswerKey,
  verifyContaminationSelfReport,
  safetySuiteVerdict,
  computeEvalSetHash,
} from './eval-provenance';
/* @public */ export type { EvalSetProvenance, ProvenanceLedger, EvalSetItem } from './eval-provenance';
/* ── v1.5.8 章二：三层晋级判据 ── */
/* @public */ export {
  judgePromotion,
  judgeDemotion,
  judgeEvidenceGates,
  recordPromotionDecision,
  recordBenefitMetrics,
  evolutionCostGate,
  noopDecisionWriter,
  PROMOTION_FREQUENCY_THRESHOLD,
  PROMOTION_PERSISTENCE_DAYS,
  PROMOTION_VERIFICATION_PASSRATE,
  PROMOTION_TRAIN_PASSRATE,
  FREQUENCY_WINDOW_DAYS,
  CALIBRATION_EPSILON,
} from './promotion-policy';
/* @public */ export type {
  PromotionInput,
  PromotionVerdict,
  EvidenceGatesInput,
  EvidenceGatesVerdict,
  EvolutionBenefitMetrics,
  BenefitMetricsRecord,
  PromotionLedgerEntry,
  DecisionWriter,
} from './promotion-policy';
/* ── v1.5.8 章五：RL 训练治理 ── */
/* @public */ export {
  emptyTrainingPolicySet,
  judgePolicyHits,
  combineGates,
} from './training-policy';
/* @public */ export type {
  TrainingPolicySet,
  TrajectoryRuleHit,
  PolicyHitVerdict,
} from './training-policy';
/* @public */ export { shapeRewardPenalty, recordShaping } from './reward-shaping';
/* ── v1.5.8 章二补强：四指标取数器（既有台账——零新数据源）── */
/* @public */ export {
  passRateTrendFromAbHistory,
  recurrenceRateFromFailureLedger,
  skillReuseRateFromImpactLedger,
  interventionRateFromDecisionLog,
  collectBenefitMetrics,
} from './benefit-metrics';
/* @public */ export type { OptionalMetric } from './benefit-metrics';
/* @public */ export type { PenaltySignal, RewardShapingResult, ShapingLedgerEntry } from './reward-shaping';
/* @public */ export type { GateHistory, GateVerdict, NativeGateOptions } from './native-gate';
/* @public */ export { buildProposerPrompt, parseProposalWithSafety, loadImpactLedger, loadFailureLedger } from './proposer';
/* @public */ export type { ProposerInput, SkillProposal, ProposalWithSafety } from './proposer';

// ── v1.5.7 章四：五维技能健康度 + 退役候选（SkillOps）──
/* @public */ export {
  recordSkillUsage,
  readSkillUsage,
  generateHealthReport,
  renderHealthReport,
  archiveSkill,
  archiveSkillWithScore,
  restoreSkill,
  resolveSkillRoot,
  resolveSkillArchiveDir,
  resolveArchiveLedgerPath,
  resolveSkillDebtPath,
  resolveSkillUsagePath,
  USAGE_SATURATION,
  REFERENCE_SATURATION,
  STALE_DAYS,
  RETIREMENT_THRESHOLD,
  RETIREMENT_USAGE_FLOOR,
} from './skill-health';
/* @public */ export type {
  SkillUsageRecord,
  SkillHealthDimensions,
  SkillHealthReport,
  ArchiveLedgerEntry,
} from './skill-health';
