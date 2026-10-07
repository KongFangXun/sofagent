// ============================================================
// domain/inspectors.ts · 巡检域（分层巡检 / 各 inspector / FDE 陪跑与注册表巡检）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/inspectors），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/inspectors"。
// ============================================================
/* @public */ export {
  analyzeAuditHistory,
  checkDoctorHealth,
  checkKnowledgeFreshness,
  checkSkillStaleness,
  accumulateWarnings,
  runHealthReport,
  generateDataSovereigntyDaily,
  generateDataSovereigntyWeekly,
  generateDataSovereigntyMonthly,
  // v1.4.8 深模块条目 2：runInspectors / DEFAULT_INSPECTOR_CONFIG 降 @internal
  //（包内外零运行时消费者——活路径是 runLayeredInspection；内部仍导出供测试）
} from '../inspectors';
/* @internal */ export { runInspectors, DEFAULT_INSPECTOR_CONFIG } from '../inspectors';
/* @public */ export type { InspectorConfig, InspectorResult, DaemonHealth } from '../inspectors';
/* @public */ export {
  runLayeredInspection,
  runAllLayers,
  getLayerInspectorNames,
  LAYER_SCHEDULE,
} from '../inspector-layers';
/* @public */ export type { InspectorLayer, LayeredInspectionResult } from '../inspector-layers';
/* @public */ export { runFederationDistillation } from '../inspectors/federation-distillation';
/* @public */ export { runFailurePattern, getFailureClusters } from '../inspectors/failure-pattern';
/* @public */ export type { FailureCluster } from '../inspectors/failure-pattern';
/* @public */ export { runOntologyCoverage } from '../inspectors/ontology-coverage';
/* @public */ export { runEvalFailuresCheck } from '../inspectors/eval-failures';
/* @public */ export { runEvolveTrigger } from '../inspectors/evolve-trigger';
/* @public */ export { runDailySnapshot } from '../inspectors/daily-snapshot';
/* @public */ export type { DailySnapshot } from '../inspectors/daily-snapshot';
/* @public */ export { runTrendAggregator } from '../inspectors/trend-aggregator';
/* @public */ export type { WeeklyTrendReport } from '../inspectors/trend-aggregator';
/* @public */ export { runTaskStats } from '../inspectors/task-stats';
/* @public */ export type { TaskStatsReport } from '../inspectors/task-stats';
/* @public */ export { runAuditTrailInspector, aggregateAuditTrails } from '../inspectors/audit-trail';
/* @public */ export type { AuditTrailInspectorOptions } from '../inspectors/audit-trail';
/* @public */ export { runFdeCompanionDaily } from '../inspectors/fde-companion-daily';
/* @public */ export { runFdeRegistryDaily } from '../inspectors/fde-registry-daily';
/* @public */ export { loadFDERegistry, highRiskNodes } from '../fde-registry-loader';
/* @public */ export type {
  FDECadence,
  FDERisk,
  FDERegistryNode,
  FDERegistryParseResult,
} from '../fde-registry-types';
