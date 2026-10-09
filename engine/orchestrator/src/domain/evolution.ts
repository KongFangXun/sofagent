// ============================================================
// domain/evolution.ts · 进化域（evolution/skill-evolution/instinct/benchmark/acceptance/commons）——域级 barrel（v1.5.8 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/evolution），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/evolution"。
// ============================================================
/* @public */ export {
  createBenchmark,
  addCase,
  calibrateCase,
  freezeBenchmark,
  writeBenchmarkLayout,
  readBenchmarkLayout,
  benchmarksRoot,
  serializeBenchmarkConfig,
  parseBenchmarkConfig,
} from '../benchmark/benchmark-designer';
/* @public */ export type {
  BenchmarkDefinition,
  BenchmarkCase,
  CalibrationRecord,
  CreateBenchmarkOptions,
  Difficulty,
  ParsedBenchmarkConfig,
} from '../benchmark/benchmark-designer';
/* @public */ export { evaluateCase, defaultScoringFn, evalBridgeScoringFn, DEFAULT_EVALUATE_TIMEOUT_MS } from '../benchmark/case-evaluator';
/* @public */ export { logBenchmarkToMlflow, buildMetrics, llmAsJudge } from '../benchmark/mlflow-exporter';
/* @public */ export type { MlflowMetrics, MlflowRunResult } from '../benchmark/mlflow-exporter';
/* @public */ export type {
  EvaluateCaseInput,
  AgentExecutionContext,
  CaseEvaluation,
  EvaluationFailureCode,
} from '../benchmark/case-evaluator';
/* @public */ export {
  appendEvaluationRecord,
  readEvaluationLog,
  verifyEvaluationChain,
  getEvaluationLogPath,
} from '../benchmark/evaluation-log';
/* @public */ export type {
  EvaluationLogInput,
  EvaluationLogRecord,
} from '../benchmark/evaluation-log';
/* @public */ export { publishCapability, validateMetadata } from '../commons/publisher';
/* @public */ export type { CapabilityKind, CapabilityMetadata, PublishResult } from '../commons/publisher';
/* @public */ export {
  readCatalog,
  searchCatalog,
  searchByTag,
  searchByKind,
  getCapability,
} from '../commons/catalog';
/* @public */ export type { CatalogEntry, CatalogSearchResult } from '../commons/catalog';
/* @public */ export { scanForPublish, scanForInstall, mapSafetyResult } from '../commons/skill-scan';
/* @public */ export type { ScanResult, ScanVerdict } from '../commons/skill-scan';
/* @public */ export { invokeCapability, readInvokeLog } from '../commons/invoker';
/* @public */ export type { InvokeInput, InvokeResult, InvokeOutcome, CapabilityExecutor, InvokeLogEntry } from '../commons/invoker';
/* @public */ export {
  addRating,
  readRatings,
  readRatingsForCapability,
  aggregateRating,
  computeRankScore,
  coldStartFactor,
  rankCapabilities,
  getTrustStub,
  getTrustForRating,
  readInvokeCounts,
  appendInvokeCount,
  COLD_START_THRESHOLD,
} from '../commons/rating';
/* @public */ export type { RatingRecord, AggregatedRating } from '../commons/rating';
/* @public */ export {
  declareOwner,
  getTrust,
  getOwner,
  updateTrustOnRating,
  penalizeOnRetire,
  clampTrust,
  classifyTrust,
  readOwners,
  TRUST_INITIAL,
  TRUST_GOOD_THRESHOLD,
  TRUST_BAD_THRESHOLD,
  TRUST_UPVOTE_COUNT,
} from '../commons/owner';
/* @public */ export type { OwnerRecord } from '../commons/owner';
/* @public */ export {
  markRetired,
  restoreCapability,
  getCapabilityStatus,
  scanRetireCandidates,
  LOW_INVOKE_THRESHOLD,
  LOW_RATING_THRESHOLD,
} from '../commons/retire';
/* @public */ export type { RetireReason, RetireCandidate } from '../commons/retire';
/* @public */ export {
  harvestRules,
  collectLowScoreRatings,
  collectRepeatFailCases,
  harvestFromLowScore,
  harvestFromRepeatFail,
  harvestFromCaseTexts,
  LOW_SCORE_THRESHOLD,
  REPEAT_FAIL_THRESHOLD,
} from '../commons/rule-harvest';
/* @public */ export type { HarvestInput, HarvestResult } from '../commons/rule-harvest';
/* @public */ export {
  juryRules,
  benchmarkRule,
  requestBusinessApproval,
  SCORE_DELTA_THRESHOLD,
} from '../commons/rule-jury';
/* @public */ export type { JuryInput, JuryResult, RuleBenchmarkResult } from '../commons/rule-jury';
/* @public */ export {
  promoteRules,
  promoteRule,
  isAlreadyBuiltin,
} from '../commons/rule-promote';
/* @public */ export type { PromoteInput, PromoteResult } from '../commons/rule-promote';
/* @public */ export {
  readEvolutionSamples,
  readLatestEvolutionSample,
  correctionBackflowToRatings,
  repeatFailuresToCases,
  toolCandidatesFromSamples,
  logPromotionsToSkillImpact,
  resolveEvolutionSamplesDir,
} from '../evolution/evolution-samples';
/* @public */ export type {
  EvolutionSampleFile,
  EvalCurvePoint,
  CorrectionBackflow,
  LowScoreFeedback,
  RepeatFailure,
  ToolUsageStat,
  ToolCandidate,
} from '../evolution/evolution-samples';
/* @public */ export {
  nominateToolCandidate,
  reviewToolCandidate,
  registerApprovedTool,
  getApprovedEvolvedTools,
  listToolEvolutionLedger,
  resolveToolEvolutionLedgerPath,
  TOOL_STATUS_FLOW,
} from '../evolution/tool-evolution';
/* @public */ export type {
  ToolEvolutionEntry,
  ToolCandidateStatus,
  EvolvedToolRuntime,
  NominateInput,
  NominateResult,
  ReviewInput,
  ReviewResult,
  RegisterInput,
  RegisterResult,
} from '../evolution/tool-evolution';
/* @public */ export {
  extractInstincts,
  parseThinkSections,
  normalizePattern,
  patternId,
} from '../instinct/extractor';
/* @public */ export type { InstinctItem, ExtractOptions } from '../instinct/extractor';
/* @public */ export {
  scoreInstinct,
  scoreInstincts,
  selectForInjection,
  renderInjectionBlock,
  DEFAULT_CONFIDENCE_THRESHOLD,
  OCCURRENCE_SATURATION,
} from '../instinct/scorer';
/* @public */ export type { ScoredInstinct } from '../instinct/scorer';
/* @public */ export {
  evolveInstincts,
  resolveCustomSkillDir,
} from '../instinct/evolver';
/* @public */ export type { EvolveOptions, EvolveResult, EvolvedSkill } from '../instinct/evolver';
/* @public */ export {
  appendFailure,
  readFailureLog,
  aggregateFailurePatterns,
  failureLogPath,
} from '../instinct/failure-log';
/* @public */ export type { FailureLogEntry } from '../instinct/failure-log';
/* @public */ export {
  AcceptanceCriterionSchema,
  validateAcceptanceDefinition,
  saveAcceptanceDefinition,
  loadAcceptanceDefinition,
  checkAcceptance,
} from '../acceptance/acceptance';
/* @public */ export type {
  AcceptanceCriterion,
  AcceptanceDefinition,
  CriterionResult,
  AcceptanceCheckResult,
} from '../acceptance/acceptance';
/* @public */ export {
  skillEvolutionDir,
  skillImpactLedgerPath,
  appendSkillImpactEntry,
  readSkillImpactLedger,
  historicalBestScore,
  readRejectedProposals,
} from '../skill-evolution/skill-impact-ledger';
/* @public */ export type { SkillImpactEntry, ProposalVerdict } from '../skill-evolution/skill-impact-ledger';
/* @public */ export {
  runEvalGate,
  evalRecordsForProposal,
} from '../skill-evolution/eval-gate';
/* @public */ export type { EvalGateInput, EvalGateResult } from '../skill-evolution/eval-gate';
/* @public */ export {
  isolationViolationsPath,
  isEvolutionKnowledgePath,
  guardKnowledgeAccess,
  readIsolationViolations,
} from '../skill-evolution/isolation-guard';
/* @public */ export type { ContextRole, IsolationViolation } from '../skill-evolution/isolation-guard';
/* @public */ export {
  SOLVES_FIELD,
  parseSolvesField,
  ensureSolvesField,
} from '../skill-evolution/solves-frontmatter';
/* @public */ export type { FrontmatterSolves } from '../skill-evolution/solves-frontmatter';
