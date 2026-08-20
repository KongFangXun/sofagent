// ============================================================
// ast/index.ts · AST 规则引擎 barrel export
// v1.3.9（一）：官方 AST 规则引擎参考实现（sofagent-ruleset-ast）
// ============================================================

export { AstRuleEngine } from './engine';
export type { AstEngineOptions } from './engine';
export { walk, is, nodeText, collectImports } from './walk';
export { builtinAstRules, astRuleById } from './rules';
export { buildSbom, parsePackageJson, parseGoMod } from './rules/asi04-sbom';
export type { SbomEntry } from './rules/asi04-sbom';
export { inRange, compareVersions, parseVersion } from './rules/semver';
export { run as runAstPlugin, default } from './plugin-adapter';
export type {
  AstRule,
  AstFinding,
  AstScanInput,
  AstSeverity,
  AstRuleContext,
  AstTextRuleContext,
  AstNodeHost,
} from './types';
