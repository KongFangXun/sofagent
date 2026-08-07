// ============================================================
// runner.ts · 审计规则运行器（fast-fail 优化）
// v1.2.0 新增：按严重度分四优先级，critical 层 FAIL 即停
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';
import { BASELINE_RULE_NUMBERS } from '@sofagent/core';
import type { AuditContext, RuleCheck, Rule } from './types';
import { loadHistory } from '../audit-history';
import type { AuditHistoryEntry } from '../audit-history';
import { defaultRules, rules } from './index';

/**
 * 规则分组（24 条 = 17 默认 + 7 扩展）
 *
 * 默认规则（17 条，config.yml 中 enabled: true）：
 *   A1-A11, A18-A23
 *
 * 扩展规则（7 条，需主动开启 extensions.enabled: true）：
 *   A14-A17, E1-E2, E4
 *
 * 规则数口径(统一）：
 *   - 17 条默认规则（normal run，config.yml extendedRulesEnabled=false）
 *   - 24 条全量规则（config fallback 到 safeDefaults 时 extendedRulesEnabled=true，
 *     fail-closed 保护——宁可多查不漏查）
 *   - 23 个 .ts 文件（rules/ 目录，含 index.ts 注册表 = 23 规则文件 + 1 index）
 *   - 9 条基线规则（不可禁用）
 *
 * 注：A12/A13 已在 v0.99.4 合并入 A11，不再独立存在(统一：以 v1.1.4 changelog 为准，
 * README 与代码此前 v0.99.4/v1.2.0 不一致，真实版本为 v0.99.4）。
 * @see engine/audit/src/rules/index.ts defaultRules/extendedRules ——以实际注册表为准。
 */

/**
 * 基线规则——安全底线，不可通过 config.yml 关闭。
 * 即使 config.rules.a1 = false，A1 仍然生效。
 * 单一事实源 = @sofagent/core BASELINE_RULE_KEYS（9 条：a1/a2/a9/a10/a11/a20/a21/a22/a23）
 */
// 注：数字编号由 BASELINE_RULE_KEYS 派生，避免与 config-loader 的 key 集合漂移

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * 审计优先级分组
 * - critical: 安全红线——全量跑完收集所有 FAIL，统一 fast-fail 后续层（v1.2.5 变更）
 * - warning:  业务底线——全部跑完
 * - crutch:   拐杖规则——依赖日志，最慢
 * - extended: 扩展规则——A 组核心扩展优先，E 组工程规范补充；各组内按编号正序
 *
 * v1.2.5 重构：
 *   critical: A1→A2→A9→A10→A20→A21→A22→A23  (安全红线，fast-fail)
 *   warning:  A3→A4→A5→A11→A19                (业务底线 + msg 质量)
 *   crutch:   A6→A7→A8→A18                     (能力拐杖)
 *   extended: A14→A15→A16→A17→E1→E2→E4         (E3 已并入 A11)
 *
 * 变更明细：
 *   - A19 从 critical 移到 warning（msg 质量不是安全红线，不该阻断安全检查）
 *   - A10 从 warning 移到 critical（恶意源 = 安全红线）
 *   - A4 从 critical 移到 warning（配置删除是业务底线）
 *   - A6 从 warning 移到 crutch（构建完整性是能力拐杖）
 *   - A20-A23 新增到 critical（网络外传/后门/提权/路径穿越）
 *   - E3 已并入 A11，从 extended 删除
 *   - critical 层从"命中即停"改为"全量收集所有 FAIL 后统一 fast-fail"（§4.9.2）
 *
 * @see engine/audit/src/rules/index.ts  defaultRules/extendedRules 数组——新增规则时需同时在两处注册：
 *      ① 在 index.ts 的 defaultRules 或 extendedRules 数组中添加规则对象；
 *      ② 在此处的 AUDIT_PRIORITY 分组中添加对应的规则 ID。
 *      两边顺序一致才能保证优先级分组正确。
 */
export const AUDIT_PRIORITY = {
  critical: ['A1', 'A2', 'A9', 'A10', 'A20', 'A21', 'A22', 'A23'],
  warning:  ['A3', 'A4', 'A5', 'A11', 'A19'],
  crutch:   ['A6', 'A7', 'A8', 'A18'],
  extended: ['A14', 'A15', 'A16', 'A17', 'E1', 'E2', 'E4'],
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
 * 1. critical 层：v1.2.5 变更——全部跑完收集所有 FAIL，统一 fast-fail 后续层
 * 2. warning 层：全部跑完
 * 3. crutch 层：拐杖规则（A6/A7/A8/A18 hybrid 模式）
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
  const suppressedBaselineRules: string[] = [];
  const activeRules = rulesConfig
    ? rulesToRun.filter((r) => {
        const key = r.number >= 200 ? `e${r.number - 200}` : `a${r.number}`;
        const enabled = rulesConfig[key];
        // 基线规则（A1/A2/A9）无视 config 关闭指令，永远生效
        if (BASELINE_RULE_NUMBERS.has(r.number)) {
          if (enabled === false) {
            suppressedBaselineRules.push(key.toUpperCase());
          }
          return true;
        }
        return enabled !== false;
      })
    : rulesToRun;

  const allRuleIds = getAllRuleIds(activeRules);
  const ruleMap = new Map<string, Rule>();
  for (const r of activeRules) {
    ruleMap.set(ruleToId(r), r);
  }

  // 按优先级分组执行
  // v1.2.5 §4.9.2: critical 层从"命中即停"改为"全量收集所有 FAIL"
  // 设计理由：一个被注入的 Agent 可能同时碰了 .env（A1 FAIL）+
  // 偷偷 curl 外传（A20 FAIL）+ 建了后门（A21 FAIL）——旧逻辑只报 A1。
  // 新逻辑：critical 8 条全跑完，收集所有 FAIL，审计报告展示完整安全画像。
  let criticalFailCount = 0;

  for (const priority of ['critical', 'warning', 'crutch', 'extended'] as const) {
    const ruleIds = AUDIT_PRIORITY[priority];

    if (priority === 'critical') {
      // critical 层：全部跑完，收集所有 FAIL
      for (const ruleId of ruleIds) {
        const rule = ruleMap.get(ruleId);
        if (!rule) continue;

        const result = rule.check(ctx);
        results.push(result);

        if (result.status === 'FAIL') {
          criticalFailCount++;
        }
      }

      // critical 全部跑完后，如果有 FAIL → fast-fail 后续层
      if (criticalFailCount > 0) {
        // 标记后续层规则为 SKIPPED
        const seenIds = new Set(results.map(r => ruleToId({ name: r.name, number: r.number } as Rule)));
        for (const id of allRuleIds) {
          if (!seenIds.has(id)) {
            results.push({
              name: id,
              number: id.startsWith('E') ? 200 + parseInt(id.slice(1)) : parseInt(id.slice(1)),
              status: 'SKIPPED',
              details: [`critical 层 ${criticalFailCount} 条规则命中 FAIL，跳过后续层规则`],
            });
          }
        }
        // 基线规则不可关闭检查（fast-fail 前也要报警）
        if (suppressedBaselineRules.length > 0) {
          results.push({
            name: 'BASELINE_GUARD',
            number: 0,
            status: 'WARN',
            details: [`基线规则 ${suppressedBaselineRules.join('、')} 为安全底线，config.yml 关闭指令已忽略——这些规则始终生效`],
          });
        }
        // 汇总判定（有 FAIL 直接 exit 2）
        return { rules: results, exitCode: 2 };
      }
      // critical 全部 PASS → 进入下一层
      continue;
    }

    // warning/crutch/extended 层：原有逻辑不变
    for (const ruleId of ruleIds) {
      const rule = ruleMap.get(ruleId);
      if (!rule) continue;

      const result = rule.check(ctx);
      results.push(result);
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

  // 基线规则不可关闭检查：config 里关闭了 A1/A2/A9 时记录警告
  if (suppressedBaselineRules.length > 0) {
    results.push({
      name: 'BASELINE_GUARD',
      number: 0,
      status: 'WARN',
      details: [`基线规则 ${suppressedBaselineRules.join('、')} 为安全底线，config.yml 关闭指令已忽略——这些规则始终生效`],
    });
  }

  return { rules: results, exitCode };
}
