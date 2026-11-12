// ============================================================
// decision-kinds.ts · DecisionKind 枚举 SSOT（v1.9.0 fresh-eyes F13/F14 单源化）
// ============================================================
// 背景：决策数据的 kind 空间此前四处手抄（audit/decision-schema.ts union、
// audit/decision-log.ts 写侧白名单、audit/inputs/decision-log-source.ts 读侧
// 数组、core/doctor.ts 可解析率枚举）——每加一个 kind 欠一次债：v1.7.0 新增
// RULER_CHANGE 时 doctor 侧漏抄（18 值 vs 19 值，首条记录落地即误报「坏行/
// 腐化」）；v1.3.4 时代的 MARKET 更名 commons_* 后历史值未收编，11,126 条
// 历史记录被读侧按「形态不合法」跳过。
//
// 单源纪律（本文件是唯一真相源）：
//   1. 现行 19 值 = ALL_DECISION_KINDS（写侧白名单/读侧判定/doctor 可解析率共用）；
//   2. 历史值 = HISTORICAL_DECISION_KINDS（更名/退役后历史数据只读收编——
//      读侧判定面 = 现行 ∪ 历史，两集分立登记、互不混写）；
//   3. 新增 kind：只改本文件两数组 + audit/decision-schema.ts 的类型 union
//      （类型在 audit 侧因 DecisionKind 参与 Entry 接口；值集以本文件为准，
//      schema union 与本文件 ALL 的对齐由 decision-log-source.test.ts 的
//      ALL_19_KINDS 双源对账用例锁定）。
// ============================================================

/**
 * 现行 DecisionKind 值集（19 值 · SSOT）。
 * 语义注释的完整版住 audit/decision-schema.ts 的 DecisionKind union（带版本出处）；
 * 本数组只持值——值与语义分离，避免双写漂移。
 */
export const ALL_DECISION_KINDS: readonly string[] = [
  'SPEC_CHANGE', 'ARTIFACT_EDIT', 'TOOL_GATE', 'RULE_TOGGLE',
  'ESCALATE_REPORT', 'FALLBACK_DEGRADE', 'CONFIG_CHANGE',
  'KNOWLEDGE_DISTILL', 'ORCHESTRATION',
  'EVOLUTION', 'TEAM', 'COMMONS',
  'COST', 'COVERAGE', 'INVALIDATION', 'CREDENTIAL_RECONCILE',
  'LEGACY_CLEANUP', 'DATA_PRODUCT',
  'RULER_CHANGE',
];

/**
 * 历史 DecisionKind 值集（更名/退役收编 · 历史数据只读）。
 * - MARKET：v1.3.4 引入、v1.3.6 更名 commons_*（git log -S 可考：fcd3963b8 引入、
 *   df13dc6d0 更名）——存量 decision-log.jsonl 中约 1.1 万条 kind=MARKET 记录，
 *   读侧按「合法历史值」放行，不再跳过。
 */
export const HISTORICAL_DECISION_KINDS: readonly string[] = [
  'MARKET',
];

/** 读侧判定面：现行 ∪ 历史（写侧只允许现行集）。 */
export const READABLE_DECISION_KINDS: readonly string[] = [
  ...ALL_DECISION_KINDS,
  ...HISTORICAL_DECISION_KINDS,
];
