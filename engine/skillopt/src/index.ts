// ── API 分级契约（v1.4.4 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/skillopt
 *
 * Skill 优化 — Skill 质量分析 / 优化建议 / 自动重构
 */

// ── Skill 安全审查 ──
/* @public */ export {
  scanSkillSafety,
  main as skillSafetyCheckMain,
} from './skill-safety-check';
/* @public */ export {
  findFiles,
  scanFile,
} from '@sofagent/audit';
/* @public */ export type {
  SafetyHit,
  SafetyRule,
  SafetyResult,
} from '@sofagent/audit';

// ── SkillOpt 集成 ──
/* @public */ export {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from './skillopt-integration';
/* @public */ export type {
  SkillOptResult,
  ValidationResult,
} from './skillopt-integration';

// ── Dream Cycle backfill 钩子（v1.1.6 新增）──
/* @public */ export { backfill, getBackfillQueue, clearBackfillQueue } from './backfill';
/* @public */ export type { BackfillConcept, BackfillEntry } from './backfill';

// ── v1.2.4 P1：失败清单 + 自动触发 + optimize() API ──
/* @public */ export {
  recordFailure,
  getFailurePatterns,
  getFailurePatternsBySkill,
  getRepeatedFailures,
  resolveFailureLedgerPath,
  clearFailureCache,
} from './failure-ledger';
/* @public */ export type { FailureRecord, FailurePattern } from './failure-ledger';
/* @public */ export {
  optimize,
  autoTriggerAll,
  getPendingTriggerCount,
  AUTO_TRIGGER_THRESHOLD,
} from './auto-trigger';
/* @public */ export type { OptimizeInput, OptimizeResult } from './auto-trigger';
