// ============================================================
// runner.ts · 审计规则运行器（fast-fail 优化）
// v1.1.3 新增：按严重度分四优先级，critical 层 FAIL 即停
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';
import type { AuditContext, RuleCheck, Rule } from './types';
import { loadHistory } from '../audit-history';
import type { AuditHistoryEntry } from '../audit-history';
import { defaultRules, rules } from './index';

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * 审计优先级分组
 * - critical: FAIL 规则——命中即停，后续全部 SKIPPED
 * - warning:  WARN 规则——全部跑完
 * - crutch:   拐杖规则——依赖日志，最慢
 * - extended: 扩展规则——A 组核心扩展优先，E 组工程规范补充；各组内按编号正序
 *
 * v1.1.4 后：
 *   critical: A1→A2→A9→A4→A19  (A19 message 质量排在 A4 之后，早于 A3)
 *   extended: A14→A15→A16→A17→A18→E1→E2→E3→E4  (A 组优先，正序排列)
 */
export const AUDIT_PRIORITY = {
  critical: ['A1', 'A2', 'A9', 'A4'],
  warning:  ['A3', 'A5', 'A6', 'A10', 'A11'],
  crutch:   ['A7', 'A8'],
  extended: ['A14', 'A15', 'A16', 'A17', 'E1', 'E2', 'E3', 'E4'],
} as const;

/**
 * 将规则编号转换为 AUDIT_PRIORITY 中的 key
 */
function ruleToId(r: Rule): string {
  if (r.number >= 200) return `E${r.number - 200}`;
  return `A${r.number}`;
}

/**
 * 获取所有已知的规则 ID（用于 SKIPPED 填充）
 */
function getAllRuleIds(activeRules: Rule[]): string[] {
  return activeRules.map(r => ruleToId(r));
}

/**
 * 运行全部审计规则（fast-fail 模式）
 *
 * 按 AUDIT_PRIORITY 定义的顺序分组执行：
 * 1. critical 层：任一 FAIL → 立即返回，后续规则标 SKIPPED
 * 2. warning 层：全部跑完
 * 3. crutch 层：拐杖规则（A7/A8 hybrid 模式）
 * 4. extended 层：扩展规则
 *
 * @param diffFiles git diff 解析出的文件变更列表
 * @param logEntries 任务日志条目
 * @param task 任务描述（--task 参数）
 * @param strict 严格模式
 * @param silent 沉默模式
 * @param commitMsg commit message
 * @param config 审计配置
 */
export function runRules(
  diffFiles: DiffFile[],
  logEntries: LogEntry[],
  task?: string,
  strict?: boolean,
  silent?: boolean,
  commitMsg?: string,
  config?: AuditConfig,
  history?: AuditHistoryEntry[]
): AuditResult {
  // v1.1.0 修复(F2)：ctx.history 此前从未赋值，导致 A17 跨审计聚合（基于窗口内历史累计文件数）
  // 成为死代码。调用方显式传入 history 则优先；否则自动从审计历史加载。
  const auditHistory = history ?? loadHistory();
  const ctx: AuditContext = { diffFiles, logEntries, task, strict, silent, commitMsg, config, history: auditHistory };
  const results: RuleCheck[] = [];

  // 根据 config.extendedRulesEnabled 决定运行哪些规则
  const rulesToRun: Rule[] = config?.extendedRulesEnabled
    ? rules
    : defaultRules;

  // 根据 config.rules 按规则名禁用
  const rulesConfig = config?.rules;
  const activeRules = rulesConfig
    ? rulesToRun.filter((r) => {
        const key = r.number >= 200 ? `e${r.number - 200}` : `a${r.number}`;
        const enabled = rulesConfig[key];
        return enabled !== false;
      })
    : rulesToRun;

  const allRuleIds = getAllRuleIds(activeRules);
  const ruleMap = new Map<string, Rule>();
  for (const r of activeRules) {
    ruleMap.set(ruleToId(r), r);
  }

  // 按优先级分组执行
  for (const priority of ['critical', 'warning', 'crutch', 'extended'] as const) {
    const ruleIds = AUDIT_PRIORITY[priority];
    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) continue;

      const result = rule.check(ctx);
      results.push(result);

      // fast-fail: critical 层命中 FAIL → 立即返回
      if (priority === 'critical' && result.status === 'FAIL') {
        // 把后续未跑的规则标记为 SKIPPED
        const seenIds = new Set(results.map(r => ruleToId({ name: r.name, number: r.number } as Rule)));
        for (const id of allRuleIds) {
          if (!seenIds.has(id)) {
            results.push({
              name: id,
              number: id.startsWith('E') ? 200 + parseInt(id.slice(1)) : parseInt(id.slice(1)),
              status: 'SKIPPED',
              details: ['critical 层已命中 FAIL，跳过后续规则'],
            });
          }
        }
        // 汇总判定（有 FAIL 直接 exit 2）
        return { rules: results, exitCode: 2 };
      }
    }
  }

  // 汇总判定
  // strict 模式下 WARN 升级为 exit 2
  // v1.1.0 P0 fix: '能力拐杖' rules (E1-E4, A4, A6-A8, A14, A15) should never
  // produce FAIL exit code. Even if a crutch rule returns FAIL, we demote it
  // to WARN level — extended/crutch rules are advisory, not blocking.
  let exitCode = 0;
  for (const rule of results) {
    if (rule.status === 'FAIL') {
      if (rule.ruleClass === '能力拐杖') {
        // Crutch rules: FAIL → WARN (advisory only, never block commit)
        if (strict) exitCode = 2;
        else if (exitCode === 0) exitCode = 1;
      } else {
        exitCode = 2;
      }
    } else if (rule.status === 'WARN') {
      if (strict) exitCode = 2;
      else if (exitCode === 0) exitCode = 1;
    }
  }

  return { rules: results, exitCode };
}
