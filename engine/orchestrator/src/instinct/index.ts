// instinct/index.ts · instinct 域 barrel（v1.5.8 章三/四对外消费面）
//
// 子路径导出 ./instinct 的入口——既有 extractor/scorer 两域 + 本版新增
// store/exporter/examiner/exam-queue 从本 barrel 出；evolver/failure-log 不经
// 本 barrel（走根入口既有导出）。跨包消费（train 包 instinct-source /
// evolve 侧）走包名子路径，禁相对深引。

/* @public */ export { extractInstincts, normalizePattern, patternId } from './extractor';
/* @public */ export { examQueuePath, enqueueExamAction, readExamQueue } from './exam-queue';
/* @public */ export type { ExamQueueLogEntry } from './exam-queue';
/* @public */ export type { InstinctItem, ExtractOptions } from './extractor';
/* @public */ export {
  scoreInstinct,
  scoreInstincts,
  selectForInjection,
  renderInjectionBlock,
  applyExamStatusWeight,
  DEFAULT_CONFIDENCE_THRESHOLD,
  OCCURRENCE_SATURATION,
  VERIFIED_CONFIDENCE_MULTIPLIER,
  FAILED_CONFIDENCE_MULTIPLIER,
} from './scorer';
/* @public */ export type { ScoredInstinct } from './scorer';
/* @public */ export {
  instinctPoolPath,
  appendToPool,
  readPool,
  filterByTenant,
} from './store';
/* @public */ export type { StoredInstinct, ExamStatus } from './store';
/* @public */ export {
  exportInstinctRecords,
  buildLineageAnchor,
} from './exporter';
/* @public */ export type {
  ExportedTrainingRecord,
  ExportOptions,
  ExportResult,
  InstinctLineageAnchor,
  CrossTenantExportRecord,
  RejectedItem,
} from './exporter';
/* @public */ export {
  generateExamQuestion,
  assessExamination,
  decideSedimentation,
  checkDoNotCapture,
  checkCorroborationGate,
  applyExamResultToPoolItem,
} from './examiner';
/* @public */ export type {
  ExamQuestion,
  ExamVote,
  ExamResult,
  ExecuteExamInput,
  DoNotCaptureRecord,
  DoNotCaptureKind,
  CorroborationPendingRecord,
  ExamQueueAction,
} from './examiner';
