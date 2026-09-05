#!/usr/bin/env node
// ============================================================
// eval/cli.ts · eval CLI 入口（sofagent-eval run）
// v1.3.7 新增
//
// 组装 audit runner 适配器 → runEval → 持久化 → 报告
// CLI 层耦合 @sofagent/audit，eval 核心模块保持引擎中立
// ============================================================

import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { runEval } from './eval-runner';
import { printEvalReport } from './eval-reporter';
import type { EvalResult } from './types';
import type { DiffFile, LogEntry, AuditConfig } from '@sofagent/core';
import { EVAL_DIR, EVAL_HISTORY, EVAL_LATEST, DEFAULT_CONFIG, atomicWriteSync, atomicAppendSync } from '@sofagent/core';
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
  // v1.3.5 run-07 维度56 修复：severity 必须叠加触发状态——WARN 级触发（未拦截）封顶 P1，
  // P0 只属于 FAIL 真拦截。原实现只看 ruleClass：A4(业务底线) WARN 触发也标 P0，
  // 与 golden set 语义冲突（A4-fail-01 期望 WARN+P1、A5-fail-01 期望 FAIL+P0——
  // 同为业务底线，差异在拦截与否）。trust-but-verify 匹配率由此回到 100%。
  let severity = '';
  for (const rule of auditResult.rules) {
    if (rule.status !== 'PASS' && rule.status !== 'SKIPPED' && rule.ruleClass) {
      let mapped = RULE_CLASS_TO_SEVERITY[rule.ruleClass] ?? '';
      // WARN（警告未拦截）只把 P0 降为 P1——P0 属于真拦截（FAIL）；
      // P1/P2 的 WARN 触发保持原级（golden 全集语义：A3/A4/A18/E1 的 WARN 用例均期望 P1）
      if (rule.status === 'WARN' && mapped === 'P0') mapped = 'P1';
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
 *
 * @param overrideDataDir 数据目录覆盖（沙箱实跑/测试隔离用）——不传时走
 *   EVAL_DIR/EVAL_HISTORY/EVAL_LATEST 常量（模块加载期基于 SOFAGENT_HOME
 *   解析的生产路径）。quickstart 类「文档实跑验证」必须传临时目录或
 *   预置 SOFAGENT_HOME，否则示例数据会污染真实 eval 历史（曾两轮复发：
 *   实跑走生产路径写入 mock 形态假数据，清理后下次实跑又写入）。
 */
export function persistResult(result: EvalResult, overrideDataDir?: string): void {
  const timestamp = new Date().toISOString();

  const evalDir = overrideDataDir ? join(overrideDataDir, 'eval') : EVAL_DIR;
  const evalHistory = overrideDataDir ? join(evalDir, 'history.jsonl') : EVAL_HISTORY;
  const evalLatest = overrideDataDir ? join(evalDir, 'latest.json') : EVAL_LATEST;

  // 确保 evalDir 存在
  if (!existsSync(evalDir)) {
    mkdirSync(evalDir, { recursive: true });
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
  // latest.json（原子覆盖写——temp+rename，并发读不脏读半截 JSON）
  atomicWriteSync(evalLatest, JSON.stringify(latest, null, 2));

  // history.jsonl（原子追加写——锁内读改写，多进程并发不丢行；原语自动补换行）
  atomicAppendSync(evalHistory, JSON.stringify({
    timestamp,
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    passRate: result.passRate,
    duration: result.duration,
  }));
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

  console.log(`sofagent-eval v${require('../package.json').version} — 运行质量评估`);
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
