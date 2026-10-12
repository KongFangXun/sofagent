// ============================================================
// domain/config.ts · 配置域（配置加载 / 模板 / 监控配置）——域级 barrel（v1.5.9 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/core/domain/config），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/config"。
// ============================================================
/* @public */ export {
  loadConfig,
  loadEnvConfig,
  writeConfig,
  safeDefaults,
  DEFAULT_CONFIG,
  ENV_DEFAULTS,
  ConfigLoadError,
  ConfigParseError,
  ConfigSignatureError,
  signConfig,
  warnUnknownConfigKeys,
} from '../config-loader';
/* @public */ export type { AuditConfig, SofaEnvConfig, MemoryBackend } from '../config-loader';
/* @public */ export { CONFIG_TEMPLATE } from '../config-template';
/* @public */ export {
  loadWatchConfig,
  generateWatchTemplate,
  resolveWatchYmlPaths,
  DEFAULT_WATCH_CONFIG,
} from '../config/watch-config';
/* @public */ export type { WatchConfig, CronJob } from '../config/watch-config';

// ── v1.5.9 章三·加载链配置面契约（域＝配置域）────────────────────────────
// 为什么补在这里：domain barrel 头部写明「新符号先进根 barrel 再同步分拣到本文件，
// 避免两面漂移」——v1.5.9 章三把 15 个符号加进根 barrel 却漏了本步，导致
// 「root ≡ 域 barrel 并集」不变量被打破（S476 行为锁实测 core root=333 vs uni=310）。
// 标记沿用根 barrel 的 `@internal`（本批未扩大 @public 面）。
/* @internal */ export {
  LOAD_CHAIN_LAYERS,
  LOAD_CHAIN_CONFIG_FIELDS,
  getFieldsByLayer,
  assertUniqueOwnership,
  assertAllRegistered,
  resolveOwner,
  assertLayerWrite,
  buildLayerConfig,
  loadChainDefaults,
  loadChainConfigFromEnv,
  validateLoadChainSchema,
  LoadChainSchemaError,
  LoadChainOwnershipError,
  LoadChainUnregisteredFieldError,
  LoadChainBoundaryError,
} from '../loadchain-schema';
