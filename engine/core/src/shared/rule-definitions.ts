// ============================================================
// shared/rule-definitions.ts · 跨引擎规则定义单一事实源
// v1.5.3 第一章（双规则引擎统一）：
//   历史上 `engine/rules/`（tool-level，调用前拦截，3 条）与
//   `engine/audit/src/rules/`（git-diff，提交后审计，25 条）并行维护各自
//   的规则定义——仅靠结构对齐（鸭子类型）避免包间硬依赖，无任何一层
//   真正共用同一套定义。本模块是「同一套规则定义」的**唯一落点**：
//     ① 规则身份目录（id / number / 参与的触发时机 ruleTypes）；
//     ② tool 引擎此前各自维护的检测正则（敏感文件路径 / 注入模式）收敛至此
//        ——engine/rules 由此成为纯「触发时机适配层」，不再独立维护规则正则。
//   消费方：engine/audit/src/rules/（git-diff 引擎）与 engine/rules/
//          （tool-level 引擎）**import 同一来源**——非鸭子类型对齐。
// ============================================================

import type { RuleType } from './rule-types';

export type { RuleType } from './rule-types';

/**
 * 单条跨引擎共用规则的定义——**同一套定义，两种触发时机**。
 *
 * 与 duck-typing 对齐（两处各写一份结构相同的定义）不同，本目录是两引擎
 * `import` 的同一对象来源：改一处，两引擎同步。
 */
export interface RuleDefinition {
  /** 规范编号（'A1' / 'A2' / 'A9'） */
  id: string;
  /** 编号（沿用 audit 编号，两引擎一致） */
  number: number;
  /**
   * 参与的触发时机（多值）：`'tool'` = 调用前拦截（engine/rules）、
   * `'diff'` = 提交后审计（engine/audit）。同一规则可在两种时机执行
   * ——这正是「复用同一套规则定义」的载体。
   */
  ruleTypes: RuleType[];
  /** 覆盖的检测面（人类可读，供 list-rules / 文档引用） */
  concern: string;
}

/**
 * 跨引擎共用规则定义目录——唯一事实源。
 *
 * 当前登记的三条即两引擎历史上重叠的规则（A1 敏感文件 / A2 密钥泄漏 /
 * A9 注入）。三者均在**两种触发时机**下执行：tool-level 侧为
 * `tool-sensitive-file` / `tool-secret-leak` / `tool-injection`，
 * git-diff 侧为 A1 / A2 / A9。
 */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { id: 'A1', number: 1, ruleTypes: ['tool', 'diff'], concern: '敏感文件操作' },
  { id: 'A2', number: 2, ruleTypes: ['tool', 'diff'], concern: '密钥/令牌泄漏' },
  { id: 'A9', number: 9, ruleTypes: ['tool', 'diff'], concern: 'prompt 注入' },
];

const BY_ID: ReadonlyMap<string, RuleDefinition> = new Map(
  RULE_DEFINITIONS.map((d) => [d.id, d]),
);

/** 按 id 取共用规则定义（未登记返回 undefined）。两引擎据此取 number / ruleTypes。 */
export function ruleDefinition(id: string): RuleDefinition | undefined {
  return BY_ID.get(id);
}
