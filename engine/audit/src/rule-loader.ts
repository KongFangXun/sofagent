// ============================================================
// rule-loader.ts · 审计规则自测 schema 加载器（v1.5.3 第二章 · 本章主交付物）
// ============================================================
// 研究收编（codex-rs/execpolicy）：规则正负成对自检做成**引擎级机制**——
//   每条规则强制携带 match（必须命中的样例）与 notMatch（必须不命中的样例），
//   加载时即校验（官方原话 "think of them as unit tests"）：规则写错立刻爆，不靠人记。
//
// 本章把该纪律从「checklist 级」升级为「schema 强制 + 加载时断言」：
//   ① schema 强制：`examples{match,notMatch}` 均须为非空字符串数组，
//      缺失/为空 ⇒ 拒载（静态定义类规则可显式豁免 examplesExempt）。
//   ② 样例矛盾拒载：同一 string 同时出现在 match 与 notMatch ⇒ 拒载
//      （= v1.6.0 判据质量 lint「可判别性」硬判据①的同款，母本先于此立）。
//   ③ 加载时执行断言（fail-closed）：可执行样例的规则（examplesExecutable）逐条
//      跑样例——match 必命中 / notMatch 必不命中，任一失败 ⇒ 拒载整集并报规则 id。
//
// 接入点：① 引擎默认装载点（rules/index.ts 装载注册表时）；② `--ruleset-path`
//   / `--ruleset` 加载入口（index.ts 主流程，JSON 规则集）。
//
// 边界：本模块是叶子——只依赖 ./rules/types 与 ./ruleset-loader 的类型，无循环。
// ============================================================

import type { AuditContext, Rule, RuleCheck } from './rules/types';
// v1.5.3 第二章：样例执行断言复用 runPatternRule 同款 pattern 编译
// （内联修饰符 (?i) 剥离 + ReDoS 静态检测）——单一事实源，禁在本模块重写 new RegExp。
import { compilePattern } from './ruleset-loader';
import type { Ruleset, RulesetRule } from './ruleset-loader';

/** 样例豁免标记取值（与 Rule.examplesExempt 同值——字段名与取值钉死，供 v1.6.0 lint 消费） */
export const EXAMPLES_EXEMPTION_VALUES = ['static-definition'] as const;
export type ExamplesExemption = (typeof EXAMPLES_EXEMPTION_VALUES)[number];

/**
 * v1.6.0 硬前置 (a)：样例字段名与数组形状**钉死**（单一声明源）。
 *
 * v1.6.0 判据集消费口径 = `examples.match[]` / `examples.notMatch[]`（均非空 `string[]`）。
 * 本常量把「容器字段名 / 两侧字段名 / 值形状」收敛为**唯一字面量来源**——v1.6.0 lint 与
 * 一切消费侧一律引用本常量，禁各处重写 `'match'` / `'notMatch'` 字面量（防口径漂移）。
 */
export const EXAMPLES_FIELD_SHAPE = {
  /** 容器字段名 */
  container: 'examples',
  /** 正侧字段名（必须命中的样例） */
  match: 'match',
  /** 负侧字段名（必须不命中的样例） */
  notMatch: 'notMatch',
  /** 两侧值形状（人类可读约束描述） */
  valueShape: 'string[]（非空）',
} as const;

/** 样例豁免标记字段名（v1.6.0 硬前置 (b)：与 Rule.examplesExempt 同名字段名钉死） */
export const EXAMPLES_EXEMPT_FIELD = 'examplesExempt';
/** 样例可执行标记字段名（v1.6.0 硬前置 (b)：与 Rule.examplesExecutable 同名字段名钉死） */
export const EXAMPLES_EXECUTABLE_FIELD = 'examplesExecutable';

/** 规则稳定性——v1.6.0 判据质量 lint 的 stable/experimental 区分口径 */
export type Stability =
  /** 双夹具齐备且无豁免——可进稳定规则集 */
  | 'stable'
  /** 缺任一侧夹具 / 显式豁免——最多实验态，不得进稳定规则集 */
  | 'experimental';

/** 加载报告（成功装载的明细——供 CLI/测试核验覆盖面） */
export interface RuleLoadReport {
  /** 装载的规则 id（顺序同入参） */
  loaded: string[];
  /** 样例为可执行夹具、已过执行断言的规则 id */
  executed: string[];
  /** 静态定义类豁免规则 id */
  exempted: string[];
}

/** 规则加载失败（fail-closed）——含全部违规条目，一次性报全 */
export class RuleLoadError extends Error {
  constructor(message: string, public readonly violations: string[]) {
    super(message);
    this.name = 'RuleLoadError';
  }
}

/** 是否非空字符串数组（schema 判据单源） */
function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);
}

/**
 * schema + 矛盾断言（对任意带 examples 的规则载体通用）。
 *
 * @param id 规则 id（报错定位用）
 * @param examples 待校验的 examples（未知形态——运行时校验）
 * @param exempt 是否显式豁免（true 则跳过所有样例断言）
 * @returns 违规描述数组（空 = 通过）
 */
export function checkExamplesSchema(id: string, examples: unknown, exempt: boolean): string[] {
  if (exempt) return [];
  const errors: string[] = [];
  if (examples === undefined || examples === null || typeof examples !== 'object') {
    errors.push(`${id}: examples 缺失——须提供 {match,notMatch} 或显式标记 examplesExempt`);
    return errors;
  }
  const e = examples as Record<string, unknown>;
  const matchOk = isNonEmptyStringArray(e.match);
  const notMatchOk = isNonEmptyStringArray(e.notMatch);
  if (!matchOk) errors.push(`${id}: examples.match 必须是非空字符串数组`);
  if (!notMatchOk) errors.push(`${id}: examples.notMatch 必须是非空字符串数组`);
  // 样例矛盾：同一 string 同现 match 与 notMatch（可判别性硬判据）
  if (matchOk && notMatchOk) {
    const contradictory = (e.match as string[]).filter((s) => (e.notMatch as string[]).includes(s));
    if (contradictory.length > 0) {
      errors.push(`${id}: 样例矛盾——同一样例同现 match 与 notMatch: ${contradictory.join(', ')}`);
    }
  }
  return errors;
}

/**
 * 由样例合成审计上下文——把样例同时放进「文件路径」与「新增行内容」，
 * 并对齐 task / commitMsg，最大化触发面（样例注释自称「含文件名/内容片段」）。
 */
export function auditExampleContext(sample: string): AuditContext {
  return {
    diffFiles: [{ path: sample, status: 'added', lines: [`+${sample}`] }],
    logEntries: [],
    task: sample,
    commitMsg: sample,
  };
}

/**
 * 执行断言（仅对 examplesExecutable 的规则生效）：
 * match 样例必命中（非 PASS）/ notMatch 样例必不命中（PASS）。
 * @returns 违规描述数组（空 = 通过）
 */
export function checkExamplesBehavior(rule: Rule): string[] {
  if (!rule.examplesExecutable) return [];
  const errors: string[] = [];
  const ex = rule.examples;
  if (!ex) return [`${rule.id}: examplesExecutable=true 但 examples 缺失`];
  for (const sample of ex.match) {
    const status = rule.scan(auditExampleContext(sample)).status;
    if (status === 'PASS') {
      errors.push(`${rule.id}: match 样例未命中（检测锚串可能被删）: ${sample}`);
    }
  }
  for (const sample of ex.notMatch) {
    const status = rule.scan(auditExampleContext(sample)).status;
    if (status !== 'PASS') {
      errors.push(`${rule.id}: notMatch 样例误命中（${status}）: ${sample}`);
    }
  }
  return errors;
}

/**
 * 规则稳定性判定（v1.6.0 lint 消费口径）。
 * - 显式豁免 ⇒ experimental
 * - 任一夹具缺失/为空 ⇒ experimental
 * - 双夹具齐备且无豁免 ⇒ stable
 */
export function stabilityOf(rule: Rule): Stability {
  if (rule.examplesExempt) return 'experimental';
  const ex = rule.examples;
  if (!ex || !isNonEmptyStringArray(ex.match) || !isNonEmptyStringArray(ex.notMatch)) {
    return 'experimental';
  }
  return 'stable';
}

/**
 * 引擎默认装载点：加载审计规则定义集（fail-closed）。
 *
 * 逐条做 schema + 矛盾断言（全量）；对 examplesExecutable 的规则加做执行断言。
 * 任一违规 ⇒ 抛 RuleLoadError（**整集拒载**，不降级为「跳过该条」）。
 *
 * @param rules 规则定义集（registr：defaultRules + extendedRules）
 * @returns 加载报告
 * @throws RuleLoadError
 */
export function loadAuditRules(rules: Rule[]): RuleLoadReport {
  const violations: string[] = [];
  const executed: string[] = [];
  const exempted: string[] = [];

  for (const rule of rules) {
    if (rule.examplesExempt) exempted.push(rule.id);
    violations.push(...checkExamplesSchema(rule.id, rule.examples, Boolean(rule.examplesExempt)));
    if (rule.examplesExecutable) {
      const behaviorErrors = checkExamplesBehavior(rule);
      violations.push(...behaviorErrors);
      if (behaviorErrors.length === 0) executed.push(rule.id);
    }
  }

  if (violations.length > 0) {
    throw new RuleLoadError(
      `审计规则集加载被拒（fail-closed · ${violations.length} 项违规）：样例 schema/矛盾/执行断言未通过`,
      violations,
    );
  }

  return { loaded: rules.map((r) => r.id), executed, exempted };
}

// ============================================================
// 多规则裁决语义——同一输入命中多条规则时取最严
// ============================================================
// 对齐 codex execpolicy "strictest severity across all matches"：
// 一条输入可能同时命中 forbidden / warn / allow 多档规则，最终裁决取最严档
// （FAIL > WARN > PASS），并保留**全部命中明细**（不只最严那条）供报告层呈现。
// 乱序稳定性：结果只依赖各条 status 的严重度序，与入参顺序无关（同级取先出现者）。
// SKIPPED 不参与裁决（未执行 ≠ 命中或放行）。

/** 裁决档位——FAIL(最严) > WARN > PASS */
export type Verdict = 'FAIL' | 'WARN' | 'PASS';

/** 严重度序（取最严用；SKIPPED 不入表 = 不参与裁决） */
const VERDICT_RANK: Record<Verdict, number> = { FAIL: 2, WARN: 1, PASS: 0 };

/** 单条命中明细（供报告层逐条渲染） */
export interface MatchDetail {
  /** 规则 id（RuleCheck.id，缺省回退 name） */
  id: string;
  name: string;
  /** 该条命中档位（仅 FAIL / WARN——PASS/SKIPPED 不进明细） */
  status: 'FAIL' | 'WARN';
  details: string[];
}

/** 多规则裁决结果 */
export interface StrictestResult {
  /** 取最严后的整体裁决档位 */
  status: Verdict;
  /** 全部命中（非 PASS、非 SKIPPED）明细，按入参顺序 */
  matches: MatchDetail[];
}

/**
 * 多规则裁决——取最严（FAIL > WARN > PASS）+ 全部命中明细。
 *
 * @param checks 规则检查结果数组（可能含 PASS / WARN / FAIL / SKIPPED）
 * @returns 最严档位 + 全部命中明细（PASS/SKIPPED 不入明细）
 */
export function strictestVerdict(checks: RuleCheck[]): StrictestResult {
  let status: Verdict = 'PASS';
  const matches: MatchDetail[] = [];
  for (const c of checks) {
    const s = c.status;
    if (s === 'FAIL' || s === 'WARN') {
      matches.push({ id: c.id ?? c.name, name: c.name, status: s, details: c.details ?? [] });
      if (VERDICT_RANK[s] > VERDICT_RANK[status]) status = s;
    }
    // PASS / SKIPPED 不参与裁决（SKIPPED = 未执行，既非命中亦非放行）
  }
  return { status, matches };
}

// ============================================================
// --ruleset-path / --ruleset 加载入口：JSON 规则集样例断言
// ============================================================

/**
 * JSON 规则集样例断言——JSON 规则的 `examples` 为**可选**字段：
 *   - 缺省（未声明）：跳过（JSON pattern 规则的历史格式无样例，保持向后兼容）。
 *   - 声明后：schema + 矛盾断言；且 pattern 类型规则逐条**执行断言**
 *     （match 必须被 pattern 命中 / notMatch 必须不被命中）——「锚串被删」即拒载。
 *
 * @param ruleset 已加载的 JSON 规则集
 * @throws RuleLoadError
 */
export function validateRulesetExamples(ruleset: Ruleset): void {
  const violations: string[] = [];
  ruleset.rules.forEach((rule: RulesetRule, i: number) => {
    const id = rule.id || `rules[${i}]`;
    const ex = (rule as { examples?: unknown }).examples;
    if (ex === undefined) return; // 可选字段缺省——跳过（向后兼容）
    violations.push(...checkExamplesSchema(id, ex, false));
    // pattern 类型：可执行断言
    if (rule.type === 'pattern' && typeof rule.pattern === 'string' && ex && typeof ex === 'object') {
      const e = ex as { match?: unknown; notMatch?: unknown };
      if (isNonEmptyStringArray(e.match) && isNonEmptyStringArray(e.notMatch)) {
        let regex: RegExp;
        try {
          // 复用 runPatternRule 同款编译（内联修饰符剥离 + ReDoS 静态检测）——断言与实际执行同源
          regex = compilePattern(rule.pattern, 'g');
        } catch {
          violations.push(`${id}: pattern 无法编译，样例执行断言不可进行`);
          return;
        }
        for (const s of e.match) {
          regex.lastIndex = 0; // 全局正则复位（与 runPatternRule 一致）
          if (!regex.test(s)) violations.push(`${id}: match 样例未被 pattern 命中（锚串可能被删）: ${s}`);
        }
        for (const s of e.notMatch) {
          regex.lastIndex = 0;
          if (regex.test(s)) violations.push(`${id}: notMatch 样例被 pattern 误命中: ${s}`);
        }
      }
    }
  });

  if (violations.length > 0) {
    throw new RuleLoadError(
      `规则集 "${ruleset.name}" 加载被拒（fail-closed · ${violations.length} 项样例违规）`,
      violations,
    );
  }
}
