/**
 * @sofagent/ontology — 领域本体定义
 * v1.1.5 从 sofagent/audit/src/ontology/ 迁出
 */

export type {
  OntologyObject,
  OntologyAction,
  OntologyConstraint,
  MergedOntology,
} from './types';

export { mergeOntology, checkOntologyStatus } from './merge-engine';
export { mergeSharedOntology } from './shared-merge';
export { generateOntologyView } from './ontology-view';
