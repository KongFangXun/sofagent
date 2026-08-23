// ── API 分级契约（v1.4.0 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/ontology — 领域本体定义
 * v1.2.0 从 sofagent/audit/src/ontology/ 迁出
 */

/* @public */ export type {
  OntologyObject,
  OntologyAction,
  OntologyConstraint,
  MergedOntology,
} from './types';

/* @public */ export { mergeOntology, checkOntologyStatus, migrateToTrunk, LIFECYCLE_TO_MARKET_RING } from './merge-engine';
/* @public */ export type { LifecycleMigrationRequest, LifecycleMigrationResult } from './merge-engine';
/* @public */ export { mergeSharedOntology } from './shared-merge';
/* @public */ export { generateOntologyView } from './ontology-view';

// ── Dream Cycle synthesize 落点（v1.1.6 新增）──
/* @public */ export { synthesize, getRegistered, clearRegistered } from './synthesize';
/* @public */ export type { SynthesizableConcept, SynthesizeReceipt } from './synthesize';
