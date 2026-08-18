/**
 * @sofagent/ontology — 领域本体定义
 * v1.2.0 从 sofagent/audit/src/ontology/ 迁出
 */

export type {
  OntologyObject,
  OntologyAction,
  OntologyConstraint,
  MergedOntology,
} from './types';

export { mergeOntology, checkOntologyStatus, migrateToTrunk, LIFECYCLE_TO_MARKET_RING } from './merge-engine';
export type { LifecycleMigrationRequest, LifecycleMigrationResult } from './merge-engine';
export { mergeSharedOntology } from './shared-merge';
export { generateOntologyView } from './ontology-view';

// ── Dream Cycle synthesize 落点（v1.1.6 新增）──
export { synthesize, getRegistered, clearRegistered } from './synthesize';
export type { SynthesizableConcept, SynthesizeReceipt } from './synthesize';
