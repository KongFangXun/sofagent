// ============================================================
// eval/eval-runner.ts · eval 核心运行器
// v1.0.6 新增
// 加载 golden set → 逐条跑 → 收集输出 → 评分
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import type { TestCase, TestCaseResult, EvalResult, EvalConfig } from './types';
import { scoreCase } from './eval-scorer';

/**
 * 加载 golden set YAML 文件
 */
function loadGoldenSet(filePath: string): TestCase[] {
  if (!existsSync(filePath)) {
    throw new Error(`golden set 文件不存在: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const parsed = yamlLoad(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`golden set 格式错误: 期望 YAML 数组，实际 ${typeof parsed}`);
  }

  const cases: TestCase[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const tc = item as Record<string, unknown>;
    if (!tc['id'] || !tc['input'] || !tc['expected']) {
      continue; // 跳过格式不完整的条目
    }
    cases.push({
      id: String(tc['id']),
      description: String(tc['description'] ?? ''),
      input: tc['input'] as Record<string, unknown>,
      expected: tc['expected'] as Record<string, unknown>,
      tags: Array.isArray(tc['tags']) ? tc['tags'] as string[] : undefined,
    });
  }

  return cases;
}

/**
 * 执行单条测试用例
 * 根据 input 中的 diff 和 context 调用 runRules 进行审计，对比期望输出
 */
async function runTestCase(
  testCase: TestCase,
  runFunction: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
): Promise<TestCaseResult> {
  const start = Date.now();

  try {
    const actual = await runFunction(testCase.input);
    const score = scoreCase(actual, testCase.expected);
    const passed = score.overall >= 0.8; // 综合分 >= 0.8 算通过

    return {
      testId: testCase.id,
      passed,
      actual,
      expected: testCase.expected,
      score,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      testId: testCase.id,
      passed: false,
      actual: {},
      expected: testCase.expected,
      score: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
      error: (err as Error).message,
      duration: Date.now() - start,
    };
  }
}

/**
 * 默认 runner：直接模拟执行
 * 生产环境可替换为实际 Agent 调用
 */
async function defaultRunFunction(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  // 模拟审计引擎执行：简单解析 diff 内容
  const result: Record<string, unknown> = {
    result: 'PASS',
    rules_triggered: [] as string[],
  };

  const diff = String(input['diff'] ?? '');
  const context = (input['context'] ?? {}) as Record<string, unknown>;

  // 简单检查：如果 diff 包含明显违规关键词
  if (diff.includes('sk-') || diff.includes('SECRET') || diff.includes('password')) {
    result['result'] = 'FAIL';
    (result['rules_triggered'] as string[]).push('A2');
    result['severity'] = 'P0';
  }

  if (diff.includes('ignore previous instructions') || diff.includes('DAN')) {
    result['result'] = 'FAIL';
    (result['rules_triggered'] as string[]).push('A9');
    result['severity'] = 'P0';
  }

  if (context['taskDescription']) {
    result['task'] = context['taskDescription'];
  }

  return result;
}

/**
 * 运行完整 eval
 * @param config eval 配置
 * @param runFunction 可选的 custom runner（默认使用模拟 runner）
 */
export async function runEval(
  config: EvalConfig,
  runFunction?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
): Promise<EvalResult> {
  const start = Date.now();
  const runner = runFunction ?? defaultRunFunction;

  const testCases = loadGoldenSet(config.goldenSetPath);
  const results: TestCaseResult[] = [];

  for (const testCase of testCases) {
    if (config.verbose) {
      process.stderr.write(`  [eval] 运行: ${testCase.id}...\n`);
    }
    const result = await runTestCase(testCase, runner);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    total: results.length,
    passed,
    failed,
    passRate: results.length > 0 ? passed / results.length : 0,
    results,
    duration: Date.now() - start,
  };
}
