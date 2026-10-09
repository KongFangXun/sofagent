// ============================================================
// shared/rule-constants.ts · 规则常量单一事实源
// v1.5.8 基线规则集合此前在 config-loader（['a1','a2']）与
//   runner（Set[1,2,9,10,11]）两处定义不一致——关 A9/A10/A11 不触发告警但
//   runner 强制启用。现提取共享常量，两处 import 同一来源。
// ============================================================

/**
 * 基线规则（安全底线）——不可通过 config.yml 关闭。
 * runner 强制启用；config-loader 对禁用基线规则告警。
 *
 * v1.2.5: 扩展为 9 条——A20-A23 作为 critical 层安全红线加入基线保护，
 * 企业 IT 在 config.yml 写 `a20: false` 无法关闭网络外联检测。
 * 权威源：engine/audit/src/rules/runner.ts AUDIT_PRIORITY（critical 层）
 */
export const BASELINE_RULE_KEYS = ['a1', 'a2', 'a9', 'a10', 'a11', 'a20', 'a21', 'a22', 'a23'] as const;

export type BaselineRuleKey = (typeof BASELINE_RULE_KEYS)[number];

/** 基线规则数字编号（runner 的 BASELINE_RULE_NUMBERS 用同一来源派生） */
export const BASELINE_RULE_NUMBERS: ReadonlySet<number> = new Set(
  BASELINE_RULE_KEYS.map((k) => parseInt(k.slice(1), 10)),
);

/**
 * 全量现行规则 key（config.yml `rules:` 可用的 key 集，28 条）——
 * config-template 注释与 config-loader 未知规则名校验的单一来源。
 * v1.5.7: 25→28（新增 e5/e6/e7）。
 * ⚠️ 与 engine/audit/src/rules/index.ts 注册表逐条对应（一致性由
 * engine/audit/src/__tests__/rule-metadata-snapshot.test.ts 锁定——不一致即测试红）。
 */
export const CURRENT_RULE_KEYS = [
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11',
  'a14', 'a15', 'a16', 'a17', 'a18', 'a19', 'a20', 'a21', 'a22', 'a23', 'a24',
  'e1', 'e2', 'e4', 'e5', 'e6', 'e7',
] as const;

export type CurrentRuleKey = (typeof CURRENT_RULE_KEYS)[number];

/** 现行规则总数（= CURRENT_RULE_KEYS.length，防手写漂移）。 */
export const CURRENT_RULE_COUNT = CURRENT_RULE_KEYS.length;
