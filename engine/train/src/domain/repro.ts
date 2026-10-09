// ============================================================
// domain/repro.ts · 可复现与制品域（指纹 / 制品签名 / 校验 / 登记）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/repro），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/repro"。
// ============================================================
/* @public */ export {
  EnvSnapshotSchema,
  TrainFingerprintBodySchema,
  TrainFingerprintSchema,
  computeDatasetHash,
  resolveDatasetVersion,
  trainFingerprintPath,
  freezeTrainFingerprint,
  loadTrainFingerprint,
  verifyTrainFingerprint,
  reproduceCheck,
  assertDatasetVersionLocked,
  buildDatasetLockEntry,
} from '../train-fingerprint';
/* @public */ export type {
  EnvSnapshot,
  TrainFingerprintBody,
  TrainFingerprint,
  FreezeTrainFingerprintInput,
  TrainFingerprintVerifyStatus,
  TrainFingerprintVerifyResult,
  ReproduceContext,
  FingerprintDiff,
  ReproduceCheckResult,
  DatasetVersionLockResult,
} from '../train-fingerprint';
/* @public */ export {
  ArtifactFileEntrySchema,
  ArtifactManifestBodySchema,
  ArtifactManifestSchema,
  hashArtifactFile,
  artifactManifestPath,
  signArtifacts,
  loadArtifactManifest,
  ArtifactSigningError,
  ArtifactSigningWriteError,
} from '../artifact-signing';
/* @public */ export type {
  ArtifactFileEntry,
  ArtifactManifestBody,
  ArtifactManifest,
} from '../artifact-signing';
/* @public */ export {
  verifyArtifacts,
  verifyManifestIntegrity,
} from '../artifact-verify';
/* @public */ export type {
  ManifestIntegrity,
  ArtifactFileCheck,
  ArtifactVerifyReport,
} from '../artifact-verify';
/* @public */ export {
  registerTrainArtifact,
} from '../artifact-register';
/* @public */ export type {
  RegisterTrainArtifactInput,
  ArtifactRegisterResult,
  ArtifactRegisterAction,
  MountSuggestion,
} from '../artifact-register';
