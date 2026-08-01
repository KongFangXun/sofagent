/**
 * @sofagent/skillopt
 *
 * Skill 优化 — Skill 质量分析 / 优化建议 / 自动重构
 */

// ── Skill 安全审查 ──
export {
  scanSkillSafety,
  main as skillSafetyCheckMain,
} from './skill-safety-check';
export {
  findFiles,
  scanFile,
} from '@sofagent/audit';
export type {
  SafetyHit,
  SafetyRule,
  SafetyResult,
} from '@sofagent/audit';

// ── SkillOpt 集成 ──
export {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from './skillopt-integration';
export type {
  SkillOptResult,
  ValidationResult,
} from './skillopt-integration';

// ── Dream Cycle backfill 钩子（v1.1.6 新增）──
export { backfill, getBackfillQueue, clearBackfillQueue } from './backfill';
export type { BackfillConcept, BackfillEntry } from './backfill';

// ── v1.2.4 P1：失败清单 + 自动触发 + optimize() API ──
export {
  recordFailure,
  getFailurePatterns,
  getFailurePatternsBySkill,
  getRepeatedFailures,
  resolveFailureLedgerPath,
  clearFailureCache,
} from './failure-ledger';
export type { FailureRecord, FailurePattern } from './failure-ledger';
export {
  optimize,
  autoTriggerAll,
  getPendingTriggerCount,
  AUTO_TRIGGER_THRESHOLD,
} from './auto-trigger';
export type { OptimizeInput, OptimizeResult } from './auto-trigger';
