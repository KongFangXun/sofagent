#!/usr/bin/env node
// ============================================================
// eval/cli.ts · eval CLI 入口（sofagent-eval run）
// v1.3.1 新增
//
// 组装 audit runner 适配器 → runEval → 持久化 → 报告
// CLI 层耦合 @sofagent/audit，eval 核心模块保持引擎中立
// ============================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { runEval } from './eval-runner';
import { printEvalReport } from './eval-reporter';
import type { EvalResult } from './types';
import type { DiffFile, LogEntry, AuditConfig } from '@sofagent/core';
import { EVAL_DIR, EVAL_HISTORY, EVAL_LATEST, DEFAULT_CONFIG } from '@sofagent/core';
import type { RuleCheck } from '@sofagent/audit';
import { runRules } from '@sofagent/audit';

// ============================================================
// 类型定义
// ============================================================

/** CLI 参数解析结果 */
interface EvalCliConfig {
  goldenSetPath: string;
  verbose: boolean;
}

// ============================================================
// audit runner 适配器
// ============================================================

/** 规则分级 → 严重度映射 */
const RULE_CLASS_TO_SEVERITY: Record<string, string> = {
  '业务底线': 'P0',
  '能力拐杖': 'P1',
  '工程规范': 'P2',
};

/** 严重度优先级排序（数字越小优先级越高） */
const SEVERITY_PRIORITY: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  '': 3,
};

/**
 * 从 RuleCheck.name 中提取规则 ID（如 "A1 不碰敏感" → "A1"）
 */
function extractRuleId(name: string): string {
  const match = name.match(/^([A-Z]\d+)/);
  return match ? match[1]! : name;
}

/**
 * 把 AuditResult 转换为 eval 期望的输出格式
 *
 * 三态转换规则（v1.2.5 修复）：
 * - exitCode 0 → result: 'PASS'（全部规则通过）
 * - exitCode 1 → result: 'WARN'（有 WARN 或能力拐杖 FAIL，非阻断）
 * - exitCode 2 → result: 'FAIL'（有业务底线/工程规范 FAIL，阻断）
 *
 * rules_triggered：提取 status 不是 PASS 也不是 SKIPPED 的规则 ID
 * severity：取所有触发规则中最高优先级（最低数字）的 ruleClass 映射
 */
export function convertAuditResult(auditResult: {
  rules: RuleCheck[];
  exitCode: number;
}): Record<string, unknown> {
  const EXIT_CODE_TO_RESULT: Record<number, string> = {
    0: 'PASS',
    1: 'WARN',
    2: 'FAIL',
  };
  const result: string = EXIT_CODE_TO_RESULT[auditResult.exitCode] ?? 'FAIL';

  // 提取触发的规则 ID（status 不是 PASS 也不是 SKIPPED 的规则）
  const rules_triggered: string[] = [];
  for (const rule of auditResult.rules) {
    if (rule.status !== 'PASS' && rule.status !== 'SKIPPED') {
      rules_triggered.push(extractRuleId(rule.name));
    }
  }

  // 取最高优先级 severity
  let severity = '';
  for (const rule of auditResult.rules) {
    if (rule.status !== 'PASS' && rule.status !== 'SKIPPED' && rule.ruleClass) {
      const mapped = RULE_CLASS_TO_SEVERITY[rule.ruleClass] ?? '';
      const mappedPriority = SEVERITY_PRIORITY[mapped] ?? 99;
      const currentPriority = SEVERITY_PRIORITY[severity] ?? 99;
      if (mapped && mappedPriority < currentPriority) {
        severity = mapped;
      }
    }
  }

  return { result, rules_triggered, severity };
}

/**
 * 创建 audit runner 适配器
 *
 * 把 eval 的 runFunction 签名适配为 audit runRules 的签名：
 * 1. 从 input 提取 diffFiles / logEntries / task / commitMsg
 * 2. 调用 runRules
 * 3. 把 AuditResult 转换为 eval 期望的输出格式
 */
export function createAuditRunner(): (input: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // 1. 从 input 提取结构化 DiffFile[]
    const diffFiles = (input['diffFiles'] as DiffFile[]) ?? [];
    const logEntries = (input['logEntries'] as LogEntry[]) ?? [];
    const task = input['task'] as string | undefined;
    const commitMsg = input['commitMsg'] as string | undefined;

    // 2. 调用真实审计引擎（extendedRulesEnabled = true 以覆盖全部 24 条规则）
    const auditConfig: AuditConfig = { ...DEFAULT_CONFIG, extendedRulesEnabled: true };
    const auditResult = runRules(diffFiles, logEntries, task, false, true, commitMsg, auditConfig);

    // 3. 转换为 eval 期望的输出格式
    return convertAuditResult(auditResult);
  };
}

// ============================================================
// 持久化
// ============================================================

/** latest.json 中失败用例的结构 */
interface FailedCase {
  testId: string;
  description: string;
  overallScore: number;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  error?: string;
}

/**
 * 持久化 eval 结果
 * - latest.json：覆盖写（含 timestamp / 汇总 / failures 数组）
 * - history.jsonl：追加写（仅汇总指标）
 */
export function persistResult(result: EvalResult): void {
  const timestamp = new Date().toISOString();

  // 确保 EVAL_DIR 存在
  if (!existsSync(EVAL_DIR)) {
    mkdirSync(EVAL_DIR, { recursive: true });
  }

  // 提取失败用例
  const failures: FailedCase[] = result.results
    .filter((r) => !r.passed)
    .map((r) => ({
      testId: r.testId,
      description: '',
      overallScore: r.score.overall,
      expected: r.expected,
      actual: r.actual,
      ...(r.error ? { error: r.error } : {}),
    }));

  // latest.json（覆盖写）
  const latest = {
    timestamp,
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    passRate: result.passRate,
    duration: result.duration,
    failures,
  };
  writeFileSync(EVAL_LATEST, JSON.stringify(latest, null, 2), 'utf-8');

  // history.jsonl（追加写）
  const historyLine = JSON.stringify({
    timestamp,
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    passRate: result.passRate,
    duration: result.duration,
  }) + '\n';
  writeFileSync(EVAL_HISTORY, historyLine, { flag: 'a', encoding: 'utf-8' });
}

// ============================================================
// golden set 路径解析
// ============================================================

/**
 * 解析 golden set 路径
 * 优先级：--golden-set 参数 > 环境变量 SOFAGENT_EVAL_GOLDEN_SET > 默认值
 */
function resolveGoldenSetPath(cliGoldenSet?: string): string {
  if (cliGoldenSet) return cliGoldenSet;
  const envGoldenSet = process.env.SOFAGENT_EVAL_GOLDEN_SET;
  if (envGoldenSet) return envGoldenSet;
  // 默认路径：eval 包安装目录下的 data/golden-set.yaml
  return join(__dirname, '..', 'data', 'golden-set.yaml');
}

// ============================================================
// 参数解析
// ============================================================

/**
 * 解析 CLI 参数
 */
function parseArgs(args: string[]): EvalCliConfig {
  const goldenSetIdx = args.indexOf('--golden-set');
  const goldenSetPath = goldenSetIdx !== -1 ? args[goldenSetIdx + 1] : undefined;

  return {
    goldenSetPath: resolveGoldenSetPath(goldenSetPath),
    verbose: args.includes('--verbose'),
  };
}

// ============================================================
// 主入口
// ============================================================

/**
 * CLI 主入口
 */
export async function main(cliArgs?: string[]): Promise<void> {
  const args = cliArgs ?? process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log('sofagent-eval — 质量评估引擎');
    console.log('');
    console.log('Usage: sofagent-eval run [options]');
    console.log('');
    console.log('Options:');
    console.log('  --golden-set <path>  golden set YAML 路径（默认 engine/eval/data/golden-set.yaml）');
    console.log('  --verbose            详细输出');
    process.exit(0);
  }

  if (subcommand !== 'run') {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Usage: sofagent-eval run');
    process.exit(1);
  }

  const config = parseArgs(args);

  console.log(`sofagent-eval v${require('../../package.json').version} — 运行质量评估`);
  console.log(`  Golden Set: ${config.goldenSetPath}`);
  console.log('');

  // 创建 audit runner 适配器
  const auditRunner = createAuditRunner();

  // 运行 eval
  const result = await runEval(
    { goldenSetPath: config.goldenSetPath, verbose: config.verbose },
    auditRunner
  );

  // 持久化结果
  persistResult(result);

  // 打印报告
  printEvalReport(result);

  // 退出码
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

// 直接执行时调用 main
if (require.main === module) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
