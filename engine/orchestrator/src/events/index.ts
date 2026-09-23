// ============================================================
// events/index.ts · 事件驱动执行触发 barrel export（v1.5.1 第一章）
// ============================================================

export { EventBus } from './bus';
export type { EventBusOptions, EventHandler, EventSubscriptionHandle, DeadLetterInput, PendingDispatch } from './bus';
// v1.5.2 第三章：运行时 should-run 判定链（五问 + 派发前置挂起/自动恢复）
export { shouldRun, createShouldRunGate, SHOULD_RUN_ORDER } from './should-run';
export type {
  ShouldRunQuestion,
  ShouldRunCheck,
  ShouldRunState,
  ShouldRunSuspension,
  ShouldRunResult,
  ShouldRunProbe,
  ShouldRunProbes,
  ShouldRunGate,
} from './should-run';
export {
  createNodeOutputSource,
  WebhookPayloadError,
} from './adapters';
export type {
  NodeOutputSource,
  NodeCompletionInput,
  WebhookAdapter,
  WebhookInbound,
  TimerAdapter,
  TimerRegistration,
} from './adapters';
export {
  EventRouter,
  parseEventSubscriptions,
  validateEventSubscriptions,
} from './router';
export type {
  EventRouterOptions,
  NodeRunner,
  NodeRunContext,
  NodeRunResult,
  ParsedSubscriptions,
  RoutingOutcome,
} from './router';
export {
  AnomalyBus,
  classifyAnomaly,
  ANOMALY_DECISION_KIND,
  ANOMALY_WHY_TAG,
  getDefaultAnomalyBus,
  reportAnomalyToDefaultBus,
} from './error-bus';
export type {
  AnomalyBusDeps,
  AnomalyClass,
  AnomalyInput,
  AnomalyRouting,
  AnomalyRoutingResult,
  RollbackOutcome,
} from './error-bus';
export {
  EVENT_TYPES,
  REGISTERED_EVENT_TYPES,
} from './types';
export type {
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
  // 设备面 payload 契约（第四 / 五章——唯一定义在 types.ts，消费侧从本包导入）
  DeviceDeliverySignature,
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
  DeviceTaskItem,
  DeviceUpgradeComponent,
  DeviceUpgradePayload,
  DeviceUpgradeRollout,
  DeviceUpgradeTier,
} from './types';

// ── @internal（v1.5.1 修复批 B1：收窄对外承诺，子路径导出保留、仓内仍可用）──
//   · setDefaultAnomalyBus：仅测试从子路径 '../events/error-bus' 导入（不依赖 barrel）。
/* @internal */ export { setDefaultAnomalyBus } from './error-bus';

// ── @internal（v1.5.1 修复批 F2：同法收窄）──
//   · createWebhookAdapter / createTimerAdapter：三类事件源适配器工厂的 webhook /
//     timer 两支，全仓零生产调用点。收窄理由：**本版不构成对外承诺**——宿主装配
//     不在本版落点、零生产调用点；宿主装配落版时随版本 bump 重升 `@public`（届时
//     接线，或按 SDK-face 债务登记）。子路径导出保留，仓内与测试导入不受影响。
/* @internal */ export { createWebhookAdapter, createTimerAdapter } from './adapters';
