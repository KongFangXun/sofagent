// ============================================================
// ota/index.ts · 设备 OTA 远程升级 + 任务下发推送消费（v1.5.1 第四 + 五章）
// ============================================================
//
// 子模块边界：
//   · upgrade-policy.ts    —— 升级窗口 / 手动确认策略解析 + 挂起队列持久化
//   · upgrade-executor.ts  —— 拉取 → 验签 → 灰度 → 回滚 → 版本清单上报（执行器）
//   · subscriptions.ts     —— 设备侧事件订阅登记表 + 三事件处理器（推送底座消费）
//
// 挂载点：消费方从本 barrel import；daemon 生产入口（cli.ts 设备进程）应调用
// `registerDeviceOtaSubscriptions(bus, opts)` —— 详见 subscriptions.ts 头部注释。
// ============================================================

export {
  OTA_POLICY_FILE,
  OTA_STATE_FILE,
  parseClockMinutes,
  isWithinWindow,
  isHighRiskVersion,
  resolveUpgradePolicy,
  loadUpgradePolicy,
  otaPolicyPath,
  evaluateUpgradePolicy,
  otaStatePath,
  loadOtaState,
  saveOtaState,
  suspendUpgrade,
  listSuspendedUpgrades,
  clearSuspendedUpgrade,
  recordDeviceVersions,
  getDeviceVersions,
  holdTaskDispatch,
  takeHeldTaskDispatches,
  listHeldTaskDispatches,
} from './upgrade-policy';
export type {
  UpgradeWindow,
  UpgradePolicy,
  PolicyVerdict,
  PolicyVerdictReason,
  SuspensionReason,
  SuspendedUpgrade,
  PendingTaskDispatch,
  DeviceOtaState,
  OtaStateFile,
} from './upgrade-policy';

export {
  sha256Hex,
  computeUpgradeDigest,
  buildDeliveryResponsibility,
  signDelivery,
  verifyDeliverySignature,
  componentPath,
  componentBackupPath,
  emitDeviceAudit,
  executeDeviceUpgrade,
  resumeSuspendedUpgrades,
} from './upgrade-executor';
export type {
  UpgradeTier,
  UpgradeComponent,
  UpgradeRollout,
  DeliverySignature,
  DeviceUpgradePayload,
  UpgradeOutcome,
  UpgradeRejectReason,
  PullResult,
  ComponentOpResult,
  ProbeResult,
  VersionManifest,
  VersionManifestPusher,
  UpgradeResult,
  UpgradeExecutorOptions,
} from './upgrade-executor';

export {
  DEVICE_EVENT_TOPICS,
  DEVICE_OTA_SUBSCRIPTIONS,
  stableStringify,
  bundleDigest,
  deliverTaskDispatch,
  onDeviceOnline,
  listHeldTasks,
  registerDeviceOtaSubscriptions,
} from './subscriptions';
export type {
  DeviceEventEnvelope,
  DeviceEventBusPort,
  DeployImporterPort,
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
  TaskDispatchResult,
  DeviceSubscriptionEntry,
  DeviceSubscriptionOptions,
} from './subscriptions';
