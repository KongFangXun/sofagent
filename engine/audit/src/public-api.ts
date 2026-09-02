// ── API 分级契约（v1.4.4 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.4.4: 供 @sofagent/mcp 等外部包使用的稳定接口
// ============================================================
// 注意：此文件只导出已经稳定且被外部消费的符号。
// 内部实现细节不要加到这里——避免泄露实现导致耦合。

/* @public */ export { parseDiff, isInGitRepo } from '@sofagent/core';
/* @public */ export type { DiffFile } from '@sofagent/core';
/* @public */ export { checkLogs } from '@sofagent/core';
/* @public */ export type { LogEntry } from '@sofagent/core';

/* @public */ export { runRules } from './reporter';
/* @public */ export type { AuditResult, RuleCheck } from './reporter';

// v1.4.0 交付三：成本审计维度（cost_query MCP 与外部脚本 import 用）
/* @public */ export { runCostAudit, loadWorklogSlice } from './cost-audit';
/* @public */ export type { CostBudget, CostFinding, WorklogSlice } from './cost-audit';

// v1.3.0 (交付 4)：规则清单只读暴露（list_rules 用）——默认规则 + 扩展规则全量
/* @public */ export { defaultRules, extendedRules, rules as allDiffRules } from './rules';
/* @public */ export type { Rule, RuleClass, EvidenceMode } from './rules/types';

/* @public */ export { loadConfig } from '@sofagent/core';
/* @public */ export type { AuditConfig } from '@sofagent/core';

// clearHistory 已移出公共 exports——「用于测试」的破坏性 API 不应挂在包默认导出，
// 任何人调一行 clearHistory() 就能清空全部审计历史。内部测试仍可从模块路径导入。
/* @public */ export { loadHistory, appendHistory, checkHistoryChainIntegrity, isHmacKeyConfigured, validateHmacKey } from './audit-history';
/* @public */ export type { AuditHistoryEntry } from './audit-history';

/* @public */ export { VERSION } from '@sofagent/core';

// Snapshot / shadow-repo 函数（从 @sofagent/core 统一导出，避免重复实现）
/* @public */ export {
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  createShadowRepo,
  hasShadowRepo,
} from '@sofagent/core';
/* @public */ export type { SnapshotEntry } from '@sofagent/core';

// ── Skill 安全审查（v1.1.3: 供 @sofagent/skillopt 等外部包使用） ──
/* @public */ export { findFiles, scanFile } from './rules/skill-safety-engine';
/* @public */ export { COMPILED_RULES, SCANNABLE_EXTENSIONS, VERSION as SKILL_SAFETY_VERSION } from './rules/skill-safety-rules';
/* @public */ export type { SafetyHit, SafetyRule, SafetyResult } from './rules/skill-safety-rules';
/* @public */ export {
  printFileResult,
  printTerminalSummary,
  printJsonOutput,
  printQuietOutput,
  printError,
  showHelp,
} from './rules/skill-safety-reporter';

// ── AgentShield 五类配置面扫描（v1.1.3 同批实现，此前未进公共面 → README 声称无调用点） ──
/* @public */ export { createAgentShield, DEFAULT_KNOWN_AGENTS } from './agent-shield';
/* @public */ export type { AgentShield, ShieldFinding, ShieldScanResult, ShieldOptions } from './agent-shield';

// ── 数据主权审计追踪（v1.2.2 · P0） ──
/* @public */ export { DataSovereigntyLogger, resolveSovereigntyLogPath, resolveDateArg, sanitizeRecord } from './data-sovereignty';
/* @public */ export type { DataSovereigntyRecord, SovereigntyLogEntry } from './data-sovereignty';
/* @public */ export { generateDailyReport, generateWeeklyReport, generateMonthlyReport, generateReport, aggregateStats } from './report-generator';
/* @public */ export type { GeneratedReport, ReportKind } from './report-generator';
/* @public */ export { renderReport } from './report-template';
/* @public */ export type { ReportStats } from './report-template';

// ── v1.2.4 P2：矛盾检测 + 联邦蒸馏 CLI ──
/* @public */ export { runConflictCheckCli, parseConflictCheckArgs } from './cli/conflict-check';
/* @public */ export type { ConflictCheckArgs, ConflictCheckResult, ConflictCheckFn } from './cli/conflict-check';
/* @public */ export { runFederationDistillCli, parseFederationDistillArgs } from './cli/federation-distill';
/* @public */ export type { FederationDistillArgs, DistillResult, MergeFn } from './cli/federation-distill';

// ── webhook 推送（v1.2.4 P3 S5：供 @sofagent/mcp L4 双通道使用） ──
/* @public */ export { pushAuditResult } from './webhook';
/* @public */ export type { WebhookPayload, WebhookPlatform } from './webhook';
// SSRF 守卫——daemon 等其他出站推送方复用同一判定（单一事实源，禁副本）
/* @public */ export { isPrivateWebhookUrl } from './webhook';

// ── 决策审计（v1.3.0 交付 6 T03）──
/* @public */ export { emitDecision } from './decision-log';
/* @public */ export type { DecisionLogEntry, EmitDecisionInput } from './decision-log';
/* @public */ export { checkDecisionChainDetailed } from './decision-chain';
/* @public */ export { sanitizeWhy } from './decision-schema';
/* @public */ export type { DecisionKind, DecisionCategory, LoopPhase, DecisionWhy, RouteReason, CausalType } from './decision-schema';

// ── 决策审计查询（v1.3.0 交付 6 T04；v1.3.6 交付⑮ 补 moment/agent/category/组合查询）──
/* @public */ export {
  queryByKind,
  queryByMoment,
  queryByAgent,
  queryByCategory,
  queryDecisions,
  loadDecisionLog,
  getKindSummary,
  traceBack,
  traceFromBehavior,
  getHighFrequencyPatterns,
  traceDecisionChain,
  findSimilarDecisions,
} from './decision-query';
/* @public */ export type { QueryOptions, DecisionFilter, KindSummary, TraceResult, HighFrequencyPattern, DecisionChainTrace, DecisionChainNode, SimilarDecisionHit } from './decision-query';

// ── 分级降级梯队（v1.3.6 交付⑭ · 韧性设计）──
/* @public */ export {
  DegradationManager,
  getCapability,
  filterRulesForLevel,
  isLlmUnavailable,
  isAuditTimeout,
  isDaemonCrash,
  LEVEL_ORDER,
} from './degradation';
/* @public */ export type { DegradationLevel, DegradationTrigger, DegradationRecord, LevelCapability, DegradationManagerOptions } from './degradation';

// ── 训练语料导出（MCP corpus_export 经包 main 入口消费此面）──
/* @public */ export { exportRuleCorpus, generateVerifiers, buildRuleCorpusBody, signBody, jsonToYaml } from './export/exporter';
/* @public */ export { buildVerifiersManifest, buildVerifiersWithOverrides } from './export/reward-mapping';
/* @public */ export type { RuleExportEntry, RuleCorpusBody, RuleCorpusExport, Verifiability, RewardHint } from './export/rule-schema';
