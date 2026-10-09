// ============================================================
// domain/crypto.ts · 加密、身份与信任锚域（AES-GCM / ECDH / 密钥轮换 / 配对 / age / 密钥管理 / 身份 / 哈希）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/crypto），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/crypto"。
// ============================================================
/* @public */ export {
  generateAgentIdentity,
  computeFingerprint,
  computeShortCode,
  extractConstraintsFromPrompt,
  generateEd25519KeyPair,
  buildSignaturePayload,
  signIdentityPayload,
  verifyAgentIdentity,
} from '../agent-identity';
/* @public */ export type { AgentIdentity, Ed25519KeyPair } from '../agent-identity';
/* @public */ export {
  registerIdentity,
  getIdentity,
  listIdentities,
  revokeIdentity,
  getIdentityStorePath,
} from '../identity-store';
/* @public */ export type { IdentityRecord, ListIdentitiesOptions } from '../identity-store';
/* @public */ export {
  computeRepoHash,
  clearRepoHashCache,
  REPO_HASH_PATTERN,
} from '../repo-hash';
/* @public */ export type { RepoHashExecFn } from '../repo-hash';
/* @internal */ export { computeDistAggregateHash } from '../dist-hash';
/* @public */ export {
  encryptPayload,
  decryptPayload,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  AES_KEY_BYTES,
} from '../crypto/aes-gcm';
/* @public */ export type { EncryptedPayload } from '../crypto/aes-gcm';
/* @public */ export {
  generateKeyPair,
  deriveSharedKey,
  publicKeyFingerprint,
  ECDH_CURVE,
  DERIVED_KEY_BYTES,
} from '../crypto/ecdh';
/* @public */ export type { EcdhKeyPair } from '../crypto/ecdh';
/* @public */ export {
  createKeySlot,
  rotateKey,
  getEncryptionKey,
  getDecryptionKeys,
  isPreviousKeyUsable,
  shouldRotate,
  ROTATION_GRACE_MS,
} from '../crypto/key-rotation';
/* @public */ export type { KeySlot } from '../crypto/key-rotation';
/* @public */ export {
  generatePairingCode,
  createPairingSession,
  pairByCode,
  pairByToken,
  computeTokenTag,
  pairByFederationFile,
  getFederationTokenPath,
  PAIRING_CODE_LENGTH,
  MIN_TOKEN_LENGTH,
} from '../crypto/pairing';
/* @public */ export type { PairedPeer, PairingSession } from '../crypto/pairing';
/* @public */ export {
  encryptWithAge,
  decryptWithAge,
  isAgePayload,
  AGE_MAGIC_PREFIX,
} from '../crypto/age-wrapper';
/* @public */ export {
  generateDataKey,
  loadDataKey,
  rotateDataKey,
  keyFingerprint,
  writeInitializedMarker,
  isInitialized,
  keysDirPath,
  dataKeyPath,
  initializedMarkerPath,
  listArchivedKeys,
  DATA_KEY_BYTES,
  DATA_KEY_RECOVERY_HINT,
} from '../crypto/key-manager';
/* @public */ export type { KeyOperationResult, KeyOperationOptions } from '../crypto/key-manager';
