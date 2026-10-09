// ============================================================
// domain/observability.ts · 观测域（ontology/trace/worklog/events/orchestrator-compare）——域级 barrel（v1.5.8 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/observability），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/observability"。
// ============================================================
/* @public */ export {
  ActionRegistry,
  globalActionRegistry,
  validateToolCall,
  createOntologyValidator,
  ENTITY_SCHEMA,
  CONCEPT_SCHEMA,
  RELATIONS_SCHEMA,
  validateAgainstSchema,
  CORE_CONTRACTS,
  validateOntologyPayload,
  importOntology,
  RELATION_KEYS,
  ONTOLOGY_IMPORT_DSH_MAPPING,
} from '../ontology';
/* @public */ export type {
  ActionRegistration,
  OntologyVerdict,
  OntologyVerdictStatus,
  OntologyValidatorOptions,
  OntologyValidator,
  JsonSchema,
  SchemaValidationResult,
  CoreContract,
  ContractMeta,
  RelationDirection,
  RelationCardinality,
  StateMachineContract,
  EntityImport,
  ConceptImport,
  RelationImport,
  OntologyImportPayload,
  OntologyValidationResult,
  OntologyImportResult,
  OntologyImportOptions,
  RelationKey,
} from '../ontology';
/* @public */ export {
  aggregateTrajectory,
  exportTrajectoryJson,
  exportTrajectoryForRL,
} from '../trace/trajectory';
/* @public */ export type {
  TaskTrajectory,
  TrajectoryStep,
  TrajectoryOptions,
} from '../trace/trajectory';
/* @public */ export { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from '../orchestrator-compare';
/* @public */ export type { Metric } from '../orchestrator-compare';
/* @public */ export { WorklogAggregator, isoWeekKey } from '../worklog';
/* @public */ export type {
  WorklogOptions,
  AgentWorklog,
  TaskWorklogEntry,
  WorkflowWorklog,
  WeekTrend,
  EvolutionTrends,
} from '../worklog';
/* @public */ export {
  EventBus,
  EventRouter,
  AnomalyBus,
  classifyAnomaly,
  ANOMALY_DECISION_KIND,
  ANOMALY_WHY_TAG,
  getDefaultAnomalyBus,
  reportAnomalyToDefaultBus,
  EVENT_TYPES,
  REGISTERED_EVENT_TYPES,
  parseEventSubscriptions,
  validateEventSubscriptions,
  createNodeOutputSource,
  WebhookPayloadError,
} from '../events';
/* @internal */ export { setDefaultAnomalyBus } from '../events';
/* @internal */ export { createWebhookAdapter, createTimerAdapter } from '../events';
/* @public */ export type {
  EventBusOptions,
  EventHandler,
  EventSubscriptionHandle,
  DeadLetterInput,
  NodeOutputSource,
  NodeCompletionInput,
  WebhookAdapter,
  WebhookInbound,
  TimerAdapter,
  TimerRegistration,
  EventRouterOptions,
  NodeRunner,
  NodeRunContext,
  NodeRunResult,
  ParsedSubscriptions,
  RoutingOutcome,
  AnomalyBusDeps,
  AnomalyClass,
  AnomalyInput,
  AnomalyRouting,
  AnomalyRoutingResult,
  RollbackOutcome,
  DeadLetterEntry,
  DeliveryOutcome,
  DeliveryRecord,
  EventPublishInput,
  EventRoutingTarget,
  EventSourceType,
  EventSubscription,
  NodeOutputPayload,
  EventPublishResult,
  RegisteredEventType,
  SofagentEvent,
  TimerPayload,
  WebhookKind,
  WebhookPayload,
  // 设备面 payload 契约（第四 / 五章——唯一定义在 events/types.ts）
  DeviceDeliverySignature,
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
  DeviceTaskItem,
  DeviceUpgradeComponent,
  DeviceUpgradePayload,
  DeviceUpgradeRollout,
  DeviceUpgradeTier,
} from '../events';
