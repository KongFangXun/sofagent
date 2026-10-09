// ============================================================
// domain/fde.ts · FDE 域（fde/fde-compose/fde-session/fde-session-mgr/refine-agent）——域级 barrel（v1.5.8 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/fde），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/fde"。
// ============================================================
/* @public */ export { runRefineLoop, createRefineOnConvergedCallback } from '../refine-agent/refine-driver';
/* @public */ export type { RefineDriverOptions, RefineLoopResult, RefineTriggerConfig, OnboardConvergedContext } from '../refine-agent/refine-driver';
/* @public */ export { judgeQuality, qualityFeedbackText, QUALITY_TARGET_FIELDS } from '../refine-agent/quality-judge';
/* @public */ export type { QualityJudgeOptions } from '../refine-agent/quality-judge';
/* @public */ export {
  loadQualityRuleSet,
  builtinQualityRules,
  parseFdeDeliveryReport,
  fdeFeedbacksToRules,
  teamFeedbacksToRules,
  matchQualityRules,
  evaluateRule,
  summarizeQualityResults,
} from '../refine-agent/quality-rule-set';
/* @public */ export type {
  QualityRule,
  QualityRuleSet,
  QualityCheckType,
  QualitySeverity,
  QualityRuleParams,
  QualityCheckResult,
  FdeQualityFeedback,
  TeamFeedbackEntry,
  NodeOutputFields,
  LoadRuleSetOptions,
} from '../refine-agent/quality-rule-set';
/* @internal */ export { runOptimizationLoop } from '../refine-agent/optimization-loop';
/* @internal */ export type {
  OptimizationLoopOptions,
  OptimizationIteration,
  OptimizationLoopResult,
} from '../refine-agent/optimization-loop';
/* @public */ export {
  readAgentVersion,
  writeAgentVersion,
  takeSnapshot,
  rollbackToSnapshot,
  advanceVersion,
  verifyVersionMonotonic,
  EXPERIENCE_LAYER_PATTERNS,
} from '../refine-agent/snapshot-manager';
/* @public */ export type {
  AgentVersion,
  AgentVersionEntry,
} from '../refine-agent/snapshot-manager';
/* @public */ export {
  checkContamination,
  assertNoContamination,
} from '../refine-agent/contamination-guard';
/* @public */ export type {
  ContaminationCheckInput,
  ContaminationResult,
  ContaminationType,
} from '../refine-agent/contamination-guard';
/* @public */ export { ContaminationError } from '../refine-agent/contamination-guard';
/* @public */ export {
  classifyAutomation,
  validateFiveElements,
  deriveOntologyDraft,
} from '../fde/compose-interview';
/* @public */ export type {
  FiveElements,
  ThreeQuestions,
  NodeInterview,
  ComposeSession,
  OntologyDraftResult,
  AutomationTag,
} from '../fde/compose-interview';
/* @public */ export { generateWorkflowDraft, validateDraftDag } from '../fde/workflow-draft';
/* @public */ export type { WorkflowDraft } from '../fde/workflow-draft';
/* @public */ export {
  fdeWorkbenchDir,
  fdeWorkbenchPaths,
  emitFdeAudit,
  readFdeAudit,
  recordInterview,
  classifyNodes,
  sixStepDecomposition,
  interviewPrompts,
} from '../fde/fde-workbench';
/* @public */ export type {
  FdeAuditEventType,
  FdeAuditEntry,
  InterviewRecord,
  NodePlan,
  NodesPlanFile,
} from '../fde/fde-workbench';
/* @public */ export {
  quantifyNodes,
  deriveOntology,
  distillDeliverables,
  deployWorkflow,
} from '../fde/fde-quantify';
/* @public */ export type {
  NodeQuantifyInput,
  NodeQuantification,
  QuantificationFile,
  DeriveResult,
  ThreeLayerDeliverables,
  DistillResult,
  DeployResult,
} from '../fde/fde-quantify';
/* @public */ export {
  generateOntologyDraft,
  saveOntologyDraft,
  validateOntologyDraft,
} from '../fde/ontology-draft';
/* @public */ export type { OntologyDraftJson } from '../fde/ontology-draft';
// v1.5.7 章二：浏览器实现底座退役——BrowserSession 等四符号不再导出；
// 三件图像能力（dsh-vision 视觉降级本体）改自 image-meta.ts 导出
/* @public */ export { analyzeScreenshot, degradeImageToText, readImageMeta } from '../refine-agent/image-meta';
/* @public */ export {
  captureFDESession,
  restoreFDESession,
  listFDESessions,
  renderContextMd,
  parseContextMd,
  fdeSessionsDir,
  fdeSessionDir,
  fdeContextPath,
  fdeCurrentSessionPath,
} from '../fde-session';
/* @public */ export type { FDESessionContext, FDESessionMeta } from '../fde-session';
/* @public */ export {
  FDE_SESSION_TEN_FILES,
  initFDEClientSession,
  captureFDEClientSession,
  restoreFDEClientSession,
  isFDEClientInitialized,
  listFDEClients,
  fdeClientSessionsRoot,
  fdeClientSessionDir,
  parseFDEClientContext,
} from '../fde-session-mgr';
/* @public */ export type {
  FDEClientMeta,
  FDEClientContext,
  FDESessionState,
  FDERestoreResult,
} from '../fde-session-mgr';
/* @public */ export {
  computeQuantification,
} from '../fde/quantify-core';
/* @public */ export type {
  QuantificationMetrics,
  QuantifyInput,
} from '../fde/quantify-core';
