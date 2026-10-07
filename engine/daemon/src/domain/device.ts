// ============================================================
// domain/device.ts · 设备与上行域（设备注册发现心跳 / USB 检测 / 模型清单 / 上行 WAL / OTA 远程升级）——域级 barrel（v1.5.7 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/device），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/device"。
// ============================================================
/* @public */ export { detectSofagentUsb } from '../usb-detect';
/* @public */ export type { UsbDetectResult } from '../usb-detect';
/* @public */ export {
  isOnline,
  DEVICE_HEARTBEAT_TIMEOUT_MS,
  registerDevice,
  gateDevice,
  listDevices,
  reportHeartbeat,
  scanOfflineDevices,
  enqueueDeviceTask,
  claimDeviceTask,
  reassignOrHold,
  appendDeviceEvent,
  verifyDeviceEventsChain,
  deviceRegistryPath,
  deviceEventsPath,
  deviceTasksPath,
} from '../device-registry';
/* @public */ export type {
  DeviceKind,
  DeviceRecord,
  DeviceRegistryFile,
  DeviceTask,
  DeviceTasksFile,
  DeviceEventRecord,
  RegisterResult,
  DeviceGateResult,
  HeartbeatResponse,
  EnqueueResult,
  ClaimResult,
  ReassignResult,
} from '../device-registry';
/* @public */ export {
  DEFAULT_PROBE_ENDPOINTS,
  PROBE_TIMEOUT_MS,
  scanRegistryModels,
  probeEndpoint,
  scanModelInventory,
} from '../model-inventory';
/* @public */ export type {
  AvailableModelEntry,
  RuntimeSkillPackage,
  ModelInventory,
} from '../model-inventory';
/* @public */ export {
  UPLOAD_WAL_FILE,
  uploadWalPath,
  deriveUploadAesKey,
  enqueueUpload,
  ackUpload,
  failUpload,
  readUploadCursor,
  pendingUploads,
  decryptPendingUpload,
  uploadWalStats,
} from '../upload-wal';
/* @public */ export type {
  UploadWalType,
  UploadWalRecord,
  EnqueueUploadResult,
  PendingUpload,
} from '../upload-wal';
/* @public */ export {
  DEVICE_EVENT_TOPICS,
  DEVICE_OTA_SUBSCRIPTIONS,
  registerDeviceOtaSubscriptions,
  executeDeviceUpgrade,
  resumeSuspendedUpgrades,
  deliverTaskDispatch,
  verifyDeliverySignature,
  computeUpgradeDigest,
  emitDeviceAudit,
  loadUpgradePolicy,
  evaluateUpgradePolicy,
  listSuspendedUpgrades,
  getDeviceVersions,
} from '../ota';
/* @internal */ export { signDelivery } from '../ota';
/* @internal */ export { onDeviceOnline } from '../ota';
/* @public */ export type {
  DeviceUpgradePayload,
  DeviceDeployPayload,
  DeviceTaskDispatchPayload,
  DeviceSubscriptionOptions,
  DeviceEventBusPort,
  VersionManifest,
  VersionManifestPusher,
  UpgradeOutcome,
} from '../ota';
