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
