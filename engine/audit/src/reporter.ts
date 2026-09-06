// ============================================================
// reporter.ts · 审计结果聚合与输出
// v0.93 重构：改用注册表模式——从 rules/index.ts 导入规则数组，
// 循环调用 rule.check(ctx)，不再硬编码 import 4 条规则
// v0.94：runRules 签名扩展，支持 silent/commitMsg 参数
// v0.95：支持 config 注入 AuditContext + extendedRules 开关
// v1.4.5：fast-fail 优化——委托到 rules/runner.ts
//
// 本文件专用于 @sofagent/audit，包含 runRules 运行时实现（依赖 rules/runner）。
// 与 core/src/reporter.ts 的关系：
//   - core/reporter.ts: 类型契约（跨包共享的类型定义）
//   - audit/reporter.ts: 运行时实现（runRules 函数，依赖 rules/runner）
//   两者故意分置：类型归 core（无运行时依赖），实现归 audit（有规则引擎依赖）。
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './rules/types';
import { defaultRules, extendedRules } from './rules';
import type { AuditHistoryEntry } from './audit-history';
import { runRules as runRulesWithFastFail } from './rules/runner';

// 向后兼容：re-export RuleCheck（index.ts 等模块通过 reporter 导入此类型）
export type { RuleCheck } from './rules/types';

export interface AuditResult {
  rules: RuleCheck[];
  exitCode: number;
  /** v1.1.0：权限拒绝列表（permission 集成审计） */
  permissionDenials?: string[];
}

/**
 * 产品签名行(感知层——让用户明确知道「这是 sofagent 的审计结果」）。
 *
 * 仅用于 text/table 等**人类可读**输出格式的头部；`--json` 输出绝不使用
 * （保持机器可读纯净，不破坏 acceptance scenario 6 的 JSON 结构断言）。
 *
 * 判定映射与 printResults 保持一致：exit 0=PASS / 1=WARN / 2=FAIL。
 * FAIL（拦截）时使用 ❌ 前缀，让用户明确知道「是 sofagent 拦的」。
 *
 * 口径统一（run-02 P1-5）：横幅/明细/尾行三面同口径「N 项检查 · M 条规则」——
 * quick 模式只跑默认 17 条而规则库注册 24 条，旧版把本跑检查数当规则总数打
 * 进横幅（「17 规则」），与明细行「24 条规则 (17 默认 + 7 扩展)」自相矛盾。
 * 现传入注册总数（totalRules）时并列展示；二者相等（全量跑）时维持单数形式。
 *
 * @param exitCode 审计退出码（0/1/2）
 * @param ruleCount 参与本次审计的规则数（= 本跑检查项数）
 * @param totalRules 规则库注册总数（defaultRules + extendedRules；省略时退化为单数形式）
 * @returns 形如「━━━ sofagent 审计 · 17 项检查 · 24 条规则 · PASS ━━━」的签名行（均为运行时实数，非写死值）
 */
export function productSignature(exitCode: number, ruleCount: number, totalRules?: number): string {
  const verdict = exitCode === 0 ? 'PASS' : exitCode === 1 ? 'WARN' : 'FAIL';
  const icon = exitCode === 0 ? '✅' : exitCode === 1 ? '⚠️ ' : '❌';
  const scope =
    totalRules != null && totalRules !== ruleCount
      ? `${ruleCount} 项检查 · ${totalRules} 条规则`
      : `${ruleCount} 条规则`;
  return `${icon} ━━━ sofagent 审计 · ${scope} · ${verdict} ━━━`;
}

/**
 * v1.3.8 P1-B4: runRules 选项对象——十位置参数（四布尔陷阱）重构为对象参数。
 * 布尔位置参数调用处极易错位（如 quick 模式第 6 参 commitMsg 与第 7 参 config
 * 混传即静默假绿）。新调用方一律用 options 对象。
 */
export interface RunRulesOptions {
  /** git diff 解析出的文件变更列表 */
  diffFiles: DiffFile[];
  /** 任务日志条目 */
  logEntries: LogEntry[];
  /** 任务描述（--task 参数） */
  task?: string;
  /** 严格模式 */
  strict?: boolean;
  /** 沉默模式（跳过日志依赖规则，走 diff 启发式） */
  silent?: boolean;
  /** commit message（用于 E2/A5 规则及 #10 回退） */
  commitMsg?: string;
  /** 审计配置（.sofagent/config.yml 加载，三级 fallback） */
  config?: AuditConfig;
  /** 历史审计记录（可选；不传则 runner 自动从文件加载） */
  history?: AuditHistoryEntry[];
  /** v1.3.1 交付 2：国标对齐 GB/T 48000.3-2026 维度（opt-in 默认 false） */
  gb48000?: boolean;
  /** v1.3.3 #8：quick 模式标记（cli-quick 零配置审计），A3 见到跳过越界检查 */
  quickMode?: boolean;
}

/**
 * 运行全部审计规则（fast-fail 模式，v1.0.7）
 * 委托到 rules/runner.ts 的 runRules，内部按 AUDIT_PRIORITY 分组执行。
 *
 * v1.3.8 P1-B4：新增对象参数签名（推荐）——`runRules({ diffFiles, silent: true, ... })`。
 * 旧的位置参数签名保留兼容（既有调用方/测试较多，全量迁移另行排期），
 * 两个签名最终都汇入同一实现，行为完全一致。
 */
export function runRules(
  diffFilesOrOptions: DiffFile[] | RunRulesOptions,
  logEntries?: LogEntry[],
  task?: string,
  strict?: boolean,
  silent?: boolean,
  commitMsg?: string,
  config?: AuditConfig,
  history?: AuditHistoryEntry[],
  gb48000?: boolean,
  quickMode?: boolean,
): AuditResult {
  // 对象签名：解包后走同一实现（调用方不可能两套都传）
  if (Array.isArray(diffFilesOrOptions)) {
    return runRulesWithFastFail(diffFilesOrOptions, logEntries ?? [], task, strict, silent, commitMsg, config, history, gb48000, quickMode);
  }
  const opts = diffFilesOrOptions;
  return runRulesWithFastFail(
    opts.diffFiles,
    opts.logEntries ?? [],
    opts.task,
    opts.strict,
    opts.silent,
    opts.commitMsg,
    opts.config,
    opts.history,
    opts.gb48000,
    opts.quickMode,
  );
}

// ============================================================
// v1.3.4 P2-4: FAIL 报告规则明细格式化
// ============================================================

/**
 * v1.3.4 P2-4: 格式化 FAIL/WARN 规则的详细明细
 *
 * 原 bug：二进制/大文件审计 FAIL 时报告只说「1 违规」，没指明是 A11 还是 A17 还是其他。
 * 本函数对每条命中规则输出「规则名 + 触发原因 + 文件路径」，让用户一眼看到是哪条规则拦的。
 *
 * @param results 审计结果
 * @returns 格式化后的明细行数组（每行包含规则名 + 原因 + 文件路径）
 */
export function formatRuleDetails(results: AuditResult): string[] {
  const lines: string[] = [];
  const problems = results.rules.filter((r) => r.status === 'FAIL' || r.status === 'WARN');

  // v1.4.0 交付四①（规则即测试）：从规则注册表按 number 查 justification（人类可读拦截理由）
  const allRules = [...defaultRules, ...extendedRules];

  for (const rule of problems) {
    const icon = rule.status === 'FAIL' ? '❌' : '⚠️';
    const ruleId = rule.number >= 200 ? `E${rule.number - 200}` : `A${rule.number}`;
    const classTag = rule.ruleClass === '业务底线' ? '[底线]'
      : rule.ruleClass === '能力拐杖' ? '[拐杖]'
      : rule.ruleClass === '工程规范' ? '[规范]'
      : '';
    const justification = allRules.find((r) => r.number === rule.number)?.justification;

    if (rule.details.length === 0) {
      // 无详情时仍输出规则名（让用户知道是哪条规则拦的）
      lines.push(`${icon} [sofagent] ${rule.name} (${ruleId}) ${classTag}${justification ? `：${justification}` : ''}`);
    } else {
      for (const detail of rule.details) {
        // 每条 detail 已经包含触发原因（规则 check 函数生成），这里补上规则名 + ID + 理由
        lines.push(`${icon} [sofagent] ${rule.name} (${ruleId}) ${classTag}: ${detail}${justification ? `（${justification}）` : ''}`);
      }
    }
  }

  return lines;
}

/**
 * v1.3.4 P2-4: 生成 FAIL 报告汇总——含规则明细
 *
 * 用于 CLI / CI 输出场景，确保用户看到完整的安全画像：
 *   - 总违规数 / 警告数
 *   - 每条命中规则的规则名 + ID + 触发原因 + 文件路径
 *
 * @param results 审计结果
 * @returns 汇总报告字符串（多行）
 */
export function generateFailReport(results: AuditResult): string {
  const failCount = results.rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.rules.filter((r) => r.status === 'WARN').length;
  const passCount = results.rules.filter((r) => r.status === 'PASS').length;

  const lines: string[] = [];
  lines.push(`━━━ sofagent 审计报告 ━━━`);
  lines.push(`违规 ${failCount} · 警告 ${warnCount} · 通过 ${passCount}（共 ${results.rules.length} 条规则）`);
  lines.push('');

  const details = formatRuleDetails(results);
  if (details.length > 0) {
    lines.push('命中规则明细:');
    for (const d of details) {
      lines.push(`  ${d}`);
    }
  } else {
    lines.push('✅ 全部规则通过');
  }

  lines.push('');
  return lines.join('\n');
}
