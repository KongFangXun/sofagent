// ============================================================
// assemble.ts · 规则装配缝（v1.4.8 深模块条目 7）
// ============================================================
// 职责（随施工分批落地）：
//   1. ruleCode——规则编号 → 展示码（A<n> / E<n> / R<n>）的唯一推导实现。
//      此前 stats / reporter / webhook / index / runner / rule-schema 多处各自
//      重写同一套 number 区间分支；本模块收口为单源，其余调用方一律引用本函数。
//   2. assembleCheck——前置块（PREAMBLE）装配：注册表 meta + 规则 scan 产出 → RuleCheck。
//      规则文件不再自建前置块，只保留 scanXxx（业务判定本体）。
//
// 边界：本模块是叶子——只依赖 ./types，不 import 注册表（rules/index.ts），无循环。
// ============================================================

import type { AuditContext, Rule, RuleCheck } from './types';

/**
 * 规则编号 → 展示码（全工程唯一实现）。
 *
 * 取值口径（与历史多处逐字一致，零行为变化）：
 * - number >= 500 → `R<n-500>`（规则集规则，R 前缀）
 * - number >= 200 → `E<n-200>`（E 系列扩展规则）
 * - number > 0    → `A<n>`
 * - 其余（number <= 0）→ 回退规则名（插件/规则集的无编号条目）
 */
export function ruleCode(number: number, name: string): string {
  if (number >= 500) return `R${number - 500}`;
  if (number >= 200) return `E${number - 200}`;
  if (number > 0) return `A${number}`;
  return name;
}

/**
 * 前置块装配：注册表 meta + scan 产出 → RuleCheck（仅装配路径）。
 *
 * 🔴 只装配前置块（id/name/number/evidenceMode/ruleClass）——verdict（status/details）
 *    由规则自身的 scan 判定；各规则的 WARN / FAIL 分支属业务本体，本函数不介入。
 */
export function assembleCheck(rule: Rule, ctx: AuditContext): RuleCheck {
  const scan = rule.scan;
  if (!scan) {
    throw new Error(`[assembleCheck] 规则 ${rule.id} 未声明 scan——装配路径要求 scan 必填`);
  }
  const { status, details } = scan(ctx);
  return {
    id: rule.id,
    name: rule.name,
    number: rule.number,
    status,
    details,
    evidenceMode: rule.evidenceMode,
    ruleClass: rule.ruleClass,
  };
}

/**
 * 双轨分发（条目 7 批二~批三过渡期）：迁移中的规则走 assembleCheck（scan 装配），
 * 未迁移的规则走旧 check 自装配。批四删除本分发器，调用方直接 assembleCheck。
 */
export function runRuleCheck(rule: Rule, ctx: AuditContext): RuleCheck {
  if (rule.scan) return assembleCheck(rule, ctx);
  if (rule.check) return rule.check(ctx);
  throw new Error(`[runRuleCheck] 规则 ${rule.id} 既无 scan 也无 check——注册表条目不完整`);
}
