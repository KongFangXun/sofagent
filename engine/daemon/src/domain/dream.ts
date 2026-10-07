// ============================================================
// domain/dream.ts · 知识循环域（dream-cycle 六阶段流水线 / 持续采样）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/dream），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/dream"。
// ============================================================
/* @public */ export { runDreamCycle, loadLedger, loadState } from '../dream-cycle/state-machine';
/* @public */ export { MockLLM } from '../dream-cycle/llm-mock';
/* @public */ export {
  RealLLM,
  createDefaultProvider,
  resolveActiveEndpoint,
} from '../dream-cycle/real-provider';
/* @public */ export type { ProviderStatus, ProviderResolution } from '../dream-cycle/real-provider';
/* @public */ export {
  validateKnowledgeQuality,
  mockExtractForDiff,
  mockSynthesizeForDiff,
} from '../dream-cycle/quality-gate';
/* @public */ export type { QualityGateResult } from '../dream-cycle/quality-gate';
/* @public */ export type {
  Stage,
  Ledger,
  AuditEntry,
  Fact,
  Atom,
  Pattern,
  Concept,
  Embedding,
  LLMProvider,
  DreamCycleState,
  DreamCycleResult,
} from '../dream-cycle/types';
/* @public */ export { DREAM_CYCLE_STAGES } from '../dream-cycle/types';
/* @public */ export {
  SAMPLE_TARGET_DAYS,
  collectDailySample,
  loadCursor,
  readAllSamples,
  summarizeSamples,
  readDailyEvalStats,
  countKnowledgeEntities,
  countCorrectionReflows,
  collectDailyDetails,
  evolutionDir,
  sampleFilePath,
  cursorFilePath,
} from '../dream-cycle/continuous-sampler';
/* @public */ export type {
  DailySample,
  SamplerCursor,
  SampleResult,
  CorrectionBackflow,
  LowScoreFeedback,
  RepeatFailure,
  ToolUsageStat,
} from '../dream-cycle/continuous-sampler';
