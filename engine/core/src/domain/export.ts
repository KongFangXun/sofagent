// ============================================================
// domain/export.ts · 训练语料导出域（方法论 / 脱敏 / 敏感识别三层检测器 / 敏感度分类 / 样本聚合）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/export），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/export"。
// ============================================================
/* @public */ export {
  METHODOLOGY_KEYS,
  parseMethodologySections,
  exportMethodology,
} from '../export/methodology';
/* @public */ export type {
  MethodologyKey,
  MethodologySection,
  MethodologyCorpus,
} from '../export/methodology';
/* @public */ export { redact, verifyNoLeak, loadRedactRules } from '../export/redactor';
/* @public */ export type { RedactRulesConfig, RedactResult } from '../export/redactor';
/* @public */ export {
  DetectorRegistry,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  tierOf,
  aggregateSpans,
  toPresidioResults,
  applySpans,
  toPresidioType,
} from '../export/detector-registry';
/* @public */ export type {
  DetectorLayer,
  SensitiveSpan,
  Detector,
  ConfidenceThresholds,
  ConfidenceTier,
  PipelineResult,
  AggregatedSpan,
} from '../export/detector-registry';
/* @public */ export {
  L0_REGEX_DETECTOR_NAME,
  createL0RegexDetector,
  createL0SensitiveDetector,
  L0_SENSITIVE_PATTERN_SPECS,
} from '../export/detector-regex';
/* @public */ export {
  L1_GLOSSARY_DETECTOR_NAME,
  buildGlossaryFromRecords,
  buildGlossaryFromEntityNames,
  createGlossaryDetector,
  placeholderOf,
} from '../export/detector-glossary';
/* @public */ export type { GlossaryEntry, GlossaryLoadResult } from '../export/detector-glossary';
/* @public */ export {
  L2_REMOTE_DETECTOR_DEFAULT_NAME,
  createRemoteDetector,
  prefetchRemoteSpans,
  createPrefetchedRemoteDetector,
  validateRemoteSpans,
} from '../export/detector-remote';
/* @public */ export type { RemoteDetectorConfig, RemoteSpanResponse, FetchLike } from '../export/detector-remote';
/* @public */ export type { PresidioEntityType, PresidioAnalysisResult, PresidioOperator } from '../export/detector-presidio-schema';
/* @public */ export { recommendedOperator } from '../export/detector-presidio-schema';
/* @public */ export { classifySensitivity } from '../export/sensitivity-classifier';
/* @public */ export type { SensitivityLevel, SensitivityDecision } from '../export/sensitivity-classifier';
/* @public */ export { aggregateSamples } from '../export/sample-aggregator';
/* @public */ export type {
  SampleSource,
  AggregatedSample,
  AggregationResult,
  ArtifactGateFn,
} from '../export/sample-aggregator';
