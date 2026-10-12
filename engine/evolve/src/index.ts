// ── API 分级契约（v1.5.9 四）────────────────────────────
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
  createCoreDecisionWriter,
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

// ── v1.5.9 章二：能力基线版本线（四层状态快照 + 版本链 + 基线回滚）──
// 标 @internal：仓内治理契约（快照/版本链/回滚复用既有 snapshot-restore），不进 @public 基线。
/* @internal */ export {
  BASELINE_LAYERS,
  CAPABILITY_CHANGE_KINDS,
  resolveBaselineChainPath,
  resolveWeightsManifestRef,
  collectFourLayerState,
  computeStateHash,
  createBaselineSnapshot,
  loadBaselineChain,
  getBaselineById,
  resolveBaselineAt,
  verifySnapshotIntegrity,
  verifyBaselineChain,
  buildRestorePlan,
  rollbackToBaseline,
  citeBaseline,
  reconcileMemoryAnchors,
  advisoryBaselineRestorer,
  createCoreSnapshotRestorer,
  BaselineIntegrityError,
  BaselineNotFoundError,
} from './baseline-snapshot';
/* @internal */ export type {
  BaselineLayer,
  CapabilityChangeKind,
  CapabilityChangeEvent,
  CapabilityChangeEventInput,
  MemoryAnchor,
  PromptLayerState,
  SkillLayerState,
  WeightsLayerState,
  FourLayerState,
  BaselineSnapshot,
  SnapshotIntegrity,
  ChainIntegrity,
  FourLayerCollectorOptions,
  CreateBaselineSnapshotOptions,
  BaselineRestoreDirective,
  BaselineRestorePlan,
  BaselineRestoreOutcome,
  BaselineRestorer,
  BaselineRollbackRecord,
  RollbackToBaselineOptions,
  BaselineCitation,
  MemoryAnchorReconcile,
} from './baseline-snapshot';

// ── v1.5.9 章四：验证器自身老化检测（元验证——老化度/对照组/漂移三态/告警/复检/
//    评估器解耦三级精判/判定件三边界/验证者链三机制）──
// 标 @internal：仓内治理契约（验证器自身健康度 + 裁判资格判定），不进 @public 基线。
/* @internal */ export {
  resolveValidatorHealthDir,
  resolveEvalSetUsagePath,
  resolveRecheckLogPath,
  resolveControlGroupPath,
  resolveControlRotationPath,
  computeEvalSetHealth,
  evaluateAgingAlert,
  applyAgingAlertToPromotion,
  computeAllEvalSetHealth,
  collectAgingAlerts,
  recordEvalSetRecheck,
  readEvalSetRecheckLog,
  recordEvalSetUsage,
  readEvalSetUsage,
  freezeControlGroup,
  readControlGroup,
  saveControlGroup,
  shouldRotateControlGroup,
  rotateControlGroup,
  readControlRotationLog,
  computeNetContribution,
  classifyValidationFailure,
  assertEvaluatorDecoupled,
  buildThreeTierPrecision,
  routeJudgeTier,
  assertJudgeArtifactCanJudgeNotAuthor,
  judgeCrossSurface,
  judgeArtifactTier,
  assertFreshInstance,
  assertRejectHasReason,
  placeInvariant,
  EvaluatorDecouplingError,
  AGING_CONSUMPTION_SATURATION,
  AGING_CONSUMPTION_ALERT_THRESHOLD,
  AGING_STALE_RECHECK_DAYS,
  AGING_TREND_RISE_WINDOW,
  AGING_TREND_SATURATION,
  AGING_DEGREE_ALERT_THRESHOLD,
  CONTROL_GROUP_ROTATION_DAYS,
  MIN_FAILURE_EVIDENCE_SAMPLES,
  JUDGE_ARTIFACT_TIER,
  RECHECK_ACTIONS,
  VALIDATION_FAILURE_STATES,
  JUDGE_TIERS,
  VERIFIER_CHAIN_MECHANISMS,
  BENEFIT_METRIC_DIRECTIONS,
} from './validator-health';
/* @internal */ export type {
  EvalSetUsageRecord,
  EvalSetAgingDimensions,
  AgingAlert,
  EvalSetHealth,
  EvalSetHealthOptions,
  AgingAdvisoryOnPromotion,
  RecheckActionKind,
  EvalSetRecheckAction,
  EvalSetRecheckInput,
  ControlGroupFrozenConfig,
  ControlGroupState,
  ControlGroupRotationRecord,
  MetricNetContribution,
  RotateControlGroupOptions,
  ValidationFailureState,
  FailureEvidence,
  DriftVerdict,
  ModelRoleRef,
  DecouplingVerdict,
  JudgeTier,
  ThreeTierPrecisionConfig,
  JudgeSample,
  JudgeRouting,
  JudgeArtifact,
  JudgeArtifactBoundary,
  CrossSurfaceDeclaration,
  CrossSurfaceVerdict,
  VerifierChainMechanism,
  VerificationRequest,
  VerdictFeedback,
  InvariantPlacement,
} from './validator-health';
