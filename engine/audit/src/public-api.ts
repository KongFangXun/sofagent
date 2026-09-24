// ── API 分级契约（v1.5.2 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
// ============================================================
// public-api.ts · @sofagent/audit 公共 API（barrel export）
// v1.5.2: 供 @sofagent/mcp 等外部包使用的稳定接口
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

// v1.3.0 (交付 4)：规则清单只读暴露——默认规则 + 扩展规则 + 全量聚合别名。
// ⚠️ H2 · v1.5.1 更正（原注释写「list_rules 用」，点名的消费方是错的）：
//   - MCP `list_rules` 实际只消费 defaultRules / extendedRules
//     （见 engine/mcp/src/tools/list-rules.ts:14）；
//   - `rules as allDiffRules` = `[...defaultRules, ...extendedRules]` 的全量聚合别名
//     （见 ./rules/index.ts:87），仓内**零消费**——全仓仅本行与
//     tools/check/public-api-baseline.json 命中。
//   保留原因：已在 @public 基线内（semver 锁定），移除属 @public 退役，需走
//   公告 + 基线同批改的流程；是否退役由维护者裁定，本批只更正注释、不动导出面。
/* @public */ export { defaultRules, extendedRules, rules as allDiffRules } from './rules';
/* @public */ export type { Rule, RuleClass, EvidenceMode } from './rules/types';

/* @public */ export { loadConfig } from '@sofagent/core';
/* @public */ export type { AuditConfig } from '@sofagent/core';

// clearHistory 已移出公共 exports——「用于测试」的破坏性 API 不应挂在包默认导出，
// 任何人调一行 clearHistory() 就能清空全部审计历史。内部测试仍可从模块路径导入。
/* @public */ export { loadHistory, appendHistory, isHmacKeyConfigured, validateHmacKey } from './audit-history';
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

// ── Skill 安全审查（v1.1.3: 供 @sofagent/evolve 等外部包使用） ──
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

// ── HMAC 审计链协议内核（v1.4.8 第〇批收口——复刻收口为单一事实源）──
// @internal：跨包内部接缝（orchestrator/train-audit 消费）——不承诺 semver 稳定性，
// 按 tools/check/public-api.mjs 的 @internal 语义不计入 public API 基线。
/* @internal */ export { appendChained, verifyChain, ChainKernelError } from './chain-kernel';
/* @internal */ export type { AppendChainedOptions, VerifyChainOptions, ChainCheckStatus, ChainCheckResult, ChainFields } from './chain-kernel';

// ── 审计输入双通道之「调用意图通道」（v1.5.1 第七章）──
// @internal：跨生态内部接缝——**唯一生产消费方**是 DSH 插件
// （engine/dsh-plugins/cordis-plugin-sofagent-audit/src/index.ts 的
//  `tools/pre-execute` / `tools/result` 两个 seamHandler，经 helpers.call 桥接），
// 故按 @internal 语义不计入 public API 基线（不承诺 semver 稳定性）。
// 零执行权限：本通道只有「只读消费宿主事件 + 落盘留痕」两种能力，无拦截面。
/* @internal */ export {
  createIntentChannel,
  resolveInputChannels,
  ruleSupportsChannel,
  readIntentEntries,
  resolveIntentLogPath,
  INTENT_EVENTS,
  INTENT_LOG_FILENAME,
  // 跳失留痕（v1.5.1 第七章·收口）——「跳过必须可审计」的落盘面：
  // 生产消费方同上（插件在身份不可达时经 helpers.call 桥接 recordIntentSkip），
  // readIntentSkips / summarizeIntentChannel 是运维「只读盘判断通道是否在工作」的查询面。
  recordIntentSkip,
  readIntentSkips,
  resolveIntentSkipLogPath,
  summarizeIntentChannel,
  INTENT_SKIP_LOG_FILENAME,
} from './intent-channel';
/* @internal */ export type { IntentChannel, IntentChannelOptions, IntentEventContext } from './intent-channel';
/* @internal */ export type { IntentSkipReason, IntentSkipRecord, IntentChannelStatus } from './intent-channel';
/* @internal */ export type { IntentEntry, AuditInputChannel } from './rules/types';

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

// ── 规则集导出（v1.5.2 章二 · MCP `ruleset_export` 消费面）──
// @internal：跨包内部接缝——**唯一生产消费方**是 MCP tool
// （engine/mcp/src/tools/ruleset-export.ts 经 createRequire 延迟 require），
// 故按 tools/check/public-api.mjs 的 @internal 语义不计入 public API 基线
// （不承诺 semver 稳定性）。后续如需外部消费，再走 @public 升级流程。
/* @internal */ export { buildRulesetExport, buildRulesetCore, buildExportedRuleset, computeRulesetFingerprint, RULESET_EXPORT_SCHEMA_VERSION } from './export/ruleset-export';
/* @internal */ export type { RulesetExportOptions, RulesetExportResult, RulesetExportAuditEvent, ExportedRuleset, ExportedRulesetRule, RulesetCore, FingerprintAlgo } from './export/ruleset-export';
// 规则训练消费元数据（同章交付——意图表 + 构建函数）
/* @internal */ export { buildExportMetadata, assertIntentCoverage, severityOf, sampleViolationOf, RULE_INTENTS, SEVERITY_BASIS } from './rules/export-metadata';
/* @internal */ export type { RuleExportMetadata, RuleSeverity, SampleViolationSource } from './rules/export-metadata';

// ── PR 生命周期（G13 · workflow 变更提案状态机——MCP pr_submit/pr_review/pr_merge 消费面）──
/* @public */ export {
  prSubmit,
  prReview,
  prMerge,
  listPrs,
  upsertTriggerBinding,
  isHeuristicallyBlocked,
  prRecordMergedVersion,
  prRevertToOpen,
} from './pr-store';
/* @public */ export type {
  PrStatus,
  TriggerConfidence,
  TriggerBinding,
  PrContributor,
  StoredPr,
  PrResult,
  PrSubmitInput,
  PrReviewInput,
  PrMergeInput,
} from './pr-store';

// ── 贡献度聚合（G4 · 人/数字员工同标准——MCP contribution_query 消费面）──
/* @public */ export { aggregateContributions, prOverview } from './contribution';
/* @public */ export type { ContributorRow, WorkflowRow, ContributionReport } from './contribution';

// ── 审计留痕规约层 + PROV-O 导出（章十 · audit_query 查询面）──
/* @public */ export { reduceAuditHistory, exportProvTurtle, exportProvJsonLd } from './audit-reducer';
/* @public */ export type { AuditQueryFilter, AuditReducedReport, AgentRollupRow, RuleRollupRow } from './audit-reducer';

// ============================================================
// v1.4.8 扩展三：并发 Git 纪律守卫（orchestrator/daemon 执行侧消费）
// ============================================================
/* @public */ export { checkPathspecDiscipline, detectForeignStaged, snapshotForTurn, verifyNoConcurrentWrite } from './concurrent-git-discipline';

// ============================================================
// v1.4.9 G5b（T4）：连接器注册面（MCP connector_register /
// connector_list 消费——准入复用 plugin-gate 来源白名单）
// ============================================================
/* @public */ export {
  registerConnector,
  listConnectors,
  getConnector,
  loadConnectorPolicy,
} from './cli/plugin-gate';
/* @public */ export type {
  ConnectorKind,
  ConnectorEntry,
  ConnectorRegisterResult,
} from './cli/plugin-gate';

// ============================================================
// v1.5.0 章一：治理 KPI 聚合（dashboard「治理」tab 数据引擎）+
// v1.4.9 第七章 stats 同源出口（--stats 契约不变，本批补公共面）
// ============================================================
/* @public */ export { computeAuditStats, formatStatsReport, formatStatsJson, readHistoryEntries } from './stats';
/* @public */ export type { AuditStatsReport, StatsOptions, RuleTriggerEntry } from './stats';
/* @public */ export {
  computeGovernanceKpis,
  formatGovernanceWeekly,
  buildDatasetLineageReport,
  readDecisionEntries,
  readDatasetVersionsLite,
} from './governance';
/* @public */ export type { GovernanceKpiReport, GovernanceOptions, DatasetVersionLite, LineageReportOptions } from './governance';
