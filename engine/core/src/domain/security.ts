// ============================================================
// domain/security.ts · 安全与隐私域（prompt 注入防线 / 可信分级 / 设备数据面策略 / 上传策略）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/security），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/security"。
// ============================================================
/* @public */ export {
  wrapUntrusted,
  needsUntrustedWrap,
  redactForPrompt,
  RESTRICTED_PLACEHOLDER,
  UNTRUSTED_PROMPT_DECLARATION,
} from '../security/prompt-sanitizer';
/* @public */ export type { UntrustedSource, UntrustedMeta } from '../security/prompt-sanitizer';
/* @public */ export {
  isTrustEntryUsable,
  sortByTrust,
  prepareForPrompt,
} from '../security/trust-grading';
/* @public */ export type { TrustTagged } from '../security/trust-grading';
/* @public */ export {
  DEVICE_DATA_POLICY_FILE,
  normalizeDirPath,
  isPathAllowed,
  deviceDataPolicyPath,
  loadDeviceDataPolicy,
  saveDeviceDataPolicy,
  authorizeDeviceRead,
} from '../device-data-policy';
/* @public */ export type {
  DeviceDataPolicyConfig,
  DeviceReadAuthResult,
} from '../device-data-policy';
/* @public */ export {
  DEVICE_UPLOAD_POLICY_FILE,
  deviceUploadPolicyPath,
  loadDeviceUploadPolicy,
  saveDeviceUploadPolicy,
  authorizeDeviceUpload,
} from '../device-upload-policy';
/* @public */ export type {
  UploadDeclaration,
  DeviceUploadPolicyConfig,
  DeviceUploadAuthResult,
} from '../device-upload-policy';
