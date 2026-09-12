// ============================================================
// train/index.ts · train 域深 barrel（v1.4.8 深模块条目 9 第一步）
// ============================================================
// orchestrator 根 barrel 1449 符号中消费方大量只用 train 域——本文件
// 提供 ./train 窄入口（非破坏：根 barrel 不变，exports 增子路径）。
// 符号集 = train 域 @public 子集（单文件 re-export——单源不复制）。
// ============================================================

// 通道协议（类型面）
export type {
  ChannelStatus,
  ChannelEvent,
  ChannelArtifact,
  ChannelSubmitResult,
  ChannelStatusResult,
  TrainChannel,
  ChannelJobSpec,
} from './train-channel';

// executor 桥（v1.4.8 条目 3：四参签名直出调度面形态）
export { channelAsExecutor } from './train-channel';

// 调度面（类型 + 工厂）
export type {
  TrainSchedulerOptions,
  SubmitTrainJobInput,
  TrainRunHandle,
  SubmitTrainJobResult,
} from './train-scheduler';
export type { TrainExecutor, TrainExecutorHooks, SpawnFn } from './train-executor';
export type { SignalAction } from './train-protocol';
export { createTrainScheduler } from './train-scheduler';

// v1.4.8 条目 9：daemon 侧消费者所需 train 域符号补齐（原经根 barrel 取）
// 事件类型（cloud-train.ts 消费）
export type { TrainEvent } from './train-protocol';
// 审计挂链（cloud-events.ts / cloud-train.test.ts 消费）
export { emitTrainAudit, checkTrainAuditChain } from './train-audit';
export type { TrainAuditEventType, EmitTrainAuditInput } from './train-audit';
// 云命令构造（cloud-exec.ts 消费）
export {
  buildCloudSpawnCommand,
  buildCloudUploadCommand,
  buildCloudCleanupCommand,
  buildCloudStopCommand,
} from './train-cloud';
export type { CloudCommand } from './train-cloud';

