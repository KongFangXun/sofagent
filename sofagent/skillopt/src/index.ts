/**
 * @sofagent/skillopt
 *
 * Skill 优化 — Skill 质量分析 / 优化建议 / 自动重构
 */

// ── Skill 安全审查 ──
export {
  scanSkillSafety,
  main as skillSafetyCheckMain,
  findFiles,
  scanFile,
} from './skill-safety-check';
export type {
  SafetyHit,
  SafetyRule,
  SafetyResult,
} from './rules/skill-safety-rules';

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
