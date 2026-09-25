// ============================================================
// assemble.ts · 规则装配缝（v1.4.9 深模块条目 7）
// ============================================================
// 职责（随施工分批落地）：
//   1. ruleCode——规则编号 → 展示码（A<n> / E<n> / R<n>）的唯一推导实现。
//      此前 stats / reporter / webhook / index / runner / rule-schema 多处各自
//      重写同一套 number 区间分支；本模块收口为单源，其余调用方一律引用本函数。
//   2. assembleCheck——前置块（PREAMBLE）装配：注册表 meta + 规则 scan 产出 → RuleCheck。
//      规则文件不再自建前置块，只保留 scanXxx（业务判定本体）。
//       v1.5.3 第七章：规则执行签名收口——执行前确保 ctx 附带 AuditScope（唯一构造器
//       `scope.ts#createAuditScope` 产出），规则输入面恒经 scope，规则侧零 git。
//
// 边界：本模块是叶子——只依赖 ./types 与 ../scope，不 import 注册表（rules/index.ts），无循环。
// ============================================================

import type { AuditContext, Rule, RuleCheck } from './types';
import { createAuditScope } from '../scope';

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
 * 前置块装配：注册表 meta + scan 产出 → RuleCheck（唯一执行入口）。
 *
 * 🔴 只装配前置块（id/name/number/evidenceMode/ruleClass）——verdict（status/details）
 *    由规则自身的 scan 判定；各规则的 WARN / FAIL 分支属业务本体，本函数不介入。
 *
 * v1.5.3 第七章：执行前确保 ctx 附 `AuditScope`——规则输入面收口为 scope（规则侧零 git）。
 * 未附 scope 的旧调用路径（直调 assembleCheck 的历史代码/测试）在此由唯一构造器补齐；
 * 惰性求值（未消费的字段不触 git），故补齐对既有 A18/A5 判定行为零变化——读到的值
 * 与旧规则内 `git ls-tree HEAD` / `git log -1` 完全一致。
 */
export function assembleCheck(rule: Rule, ctx: AuditContext): RuleCheck {
  const scopedCtx: AuditContext = ctx.scope
    ? ctx
    : { ...ctx, scope: createAuditScope({ commitMsg: ctx.commitMsg, task: ctx.task }) };
  const { status, details } = rule.scan(scopedCtx);
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
