// ============================================================
// events/index.ts · 事件驱动执行触发 barrel export（v1.5.1 第一章）
// ============================================================

export { EventBus } from './bus';
export type { EventBusOptions, EventHandler, EventSubscriptionHandle, DeadLetterInput } from './bus';
export {
  createNodeOutputSource,
  createWebhookAdapter,
  createTimerAdapter,
  sortEventsByTime,
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
  setDefaultAnomalyBus,
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
