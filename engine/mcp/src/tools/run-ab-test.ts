// ============================================================
// run-ab-test.ts · MCP tool：发起 A/B 对比实验（v1.3.6 交付 1）
// ============================================================
//
// 打通自进化闭环的「实验」半环：
//   run_ab_test({ current, candidate, eval_set?, promote_threshold? })
//     → 调 @sofagent/ab-test 的 runABTest（current vs candidate 并行对比
//       + golden-set 评分）→ persistABTestResult 落 latest.json
//
// 返回结构化结果：current 分数 / candidate 分数 / 胜出方 / golden-set
// 通过率（rule_compliance 维度）/ 连续胜出次数 / 晋升建议。
//
// 注意：
//   - runABTest 走真实模型链路（createReactAgent → fallback 模型 API），
//     耗时分钟级——MCP 调用方需容忍长响应。
//   - golden-set 解析逻辑与 ab-test/cli.ts 一致（YAML 数组格式）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { DEFAULT_SCORE_WEIGHTS } from '@sofagent/ab-test';

// ============================================================
// 类型定义
// ============================================================

export interface RunAbTestArgs {
  /** 当前版本 Agent 定义（Skill 文件）路径（必填） */
  current: string;
  /** 候选版本 Agent 定义路径（必填） */
  candidate: string;
  /** golden-set 路径（可选——缺省用 @sofagent/eval 内置 golden-set.yaml） */
  eval_set?: string;
  /** 晋升阈值：candidate 连续胜出 N 次后可晋升（默认 2） */
  promote_threshold?: number;
  /** 历史连续胜出次数（可选——接续上一次实验的计数） */
  previous_wins?: number;
}

export interface RunAbTestResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    isError: boolean;
    winner: 'current' | 'candidate' | 'tie' | '';
    currentScore: { exactMatch: number; semanticSimilarity: number; ruleCompliance: number; overall: number };
    candidateScore: { exactMatch: number; semanticSimilarity: number; ruleCompliance: number; overall: number };
    margin: number;
    goldenSetSize: number;
    consecutiveWins: number;
    promoteThreshold: number;
    canPromote: boolean;
    persisted: boolean;
    message?: string;
  };
}

// ============================================================
// golden-set 加载（与 ab-test/cli.ts 同逻辑）
// ============================================================

interface GoldenTestCase {
  id: string;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  tags?: string[];
}

/**
 * 解析 golden-set YAML/JSON 测试用例集。
 *
 * @param evalSetPath 显式路径（可选——缺省尝试 @sofagent/eval 的 golden-set.yaml）
 * @returns 测试用例数组（找不到/解析失败返回空）
 */
function loadGoldenSet(evalSetPath?: string): { cases: GoldenTestCase[]; resolvedPath: string } {
  const candidates: string[] = [];
  if (evalSetPath && existsSync(evalSetPath)) {
    candidates.push(evalSetPath);
  } else {
    // 默认路径（与 ab-test/cli.ts 同序）：eval 包 data/golden-set.yaml
    try {
      // require.resolve 从 @sofagent/ab-test 包位置出发解析兄弟包
      const { createRequire } = require('module') as typeof import('module');
      const req = createRequire(join(__dirname, '..'));
      const evalPkgRoot = join(dirname(req.resolve('@sofagent/eval/package.json')), 'data', 'golden-set.yaml');
      candidates.push(evalPkgRoot);
    } catch {
      // 解析失败留给空结果
    }
    candidates.push(join(process.cwd(), 'eval-set'));
  }

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const parsed = yamlLoad(readFileSync(p, 'utf-8')) as unknown;
      if (!Array.isArray(parsed)) continue;
      const cases = parsed.filter(
        (item): item is GoldenTestCase =>
          !!item && typeof item === 'object' &&
          typeof (item as GoldenTestCase).id === 'string' &&
          !!(item as GoldenTestCase).input &&
          !!(item as GoldenTestCase).expected,
      );
      if (cases.length > 0) return { cases, resolvedPath: p };
    } catch {
      // 该候选路径解析失败，试下一个
    }
  }
  return { cases: [], resolvedPath: candidates[0] ?? '' };
}

// dirname 局部引入（保持顶部 import 简洁）
import { dirname } from 'path';

// ============================================================
// 主函数
// ============================================================

/**
 * 发起 A/B 对比实验（current vs candidate + golden-set）。
 *
 * @param args 实验参数
 * @returns 结构化结果（text + data）
 */
export async function runAbTest(args: RunAbTestArgs): Promise<RunAbTestResult> {
  const emptyScore = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };
  const fail = (message: string): RunAbTestResult => ({
    text: `[sofagent] A/B 实验失败：${message}`,
    data: {
      isError: true,
      winner: '',
      currentScore: emptyScore,
      candidateScore: emptyScore,
      margin: 0,
      goldenSetSize: 0,
      consecutiveWins: 0,
      promoteThreshold: args.promote_threshold ?? 2,
      canPromote: false,
      persisted: false,
      message,
    },
  });

  if (!args.current || !args.candidate) {
    return fail('缺少必填参数 current / candidate（两版 Agent 定义路径）');
  }

  // 动态导入 @sofagent/ab-test（运行时才加载，错误可兜底）
  let ab: typeof import('@sofagent/ab-test');
  try {
    ab = await import('@sofagent/ab-test');
  } catch (err) {
    return fail(`@sofagent/ab-test 不可用: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 加载 golden-set
  const { cases: testCases, resolvedPath } = loadGoldenSet(args.eval_set);
  const promoteThreshold = args.promote_threshold ?? 2;
  if (testCases.length < 3) {
    return fail(`golden-set 用例不足（${testCases.length}/3，路径 ${resolvedPath}）——请提供有效评估集`);
  }

  const config = {
    current: args.current,
    candidate: args.candidate,
    evalSet: resolvedPath,
    promoteThreshold,
    minSampleSize: 3,
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  };

  try {
    const result = await ab.runABTest(config, testCases, args.previous_wins ?? 0);

    // 持久化 latest.json（与 CLI run 同行为）
    let persisted = false;
    try {
      const { persistABTestResult } = await import('@sofagent/ab-test');
      persistABTestResult(result);
      persisted = true;
    } catch {
      // 持久化失败不影响主结果返回
    }

    const canPromote = result.winner === 'candidate' && result.consecutiveWins >= promoteThreshold;

    const lines: string[] = [];
    lines.push('[sofagent] A/B 实验完成:');
    lines.push(`  胜出方: ${result.winner}`);
    lines.push(`  Current 得分:  ${result.currentScore.overall.toFixed(2)}（规则合规 ${result.currentScore.ruleCompliance.toFixed(2)}）`);
    lines.push(`  Candidate 得分: ${result.candidateScore.overall.toFixed(2)}（规则合规 ${result.candidateScore.ruleCompliance.toFixed(2)}）`);
    lines.push(`  分差（candidate - current）: ${result.margin.toFixed(4)}`);
    lines.push(`  Golden-set: ${testCases.length} 用例`);
    lines.push(`  连续胜出: ${result.consecutiveWins}/${promoteThreshold}`);
    lines.push(canPromote
      ? '  ✅ 已达晋升阈值——可调 promote_ab（需人工确认）执行晋升'
      : '  ⏳ 未达晋升阈值，继续实验积累连续胜出次数');

    return {
      text: lines.join('\n'),
      data: {
        isError: false,
        winner: result.winner,
        currentScore: result.currentScore,
        candidateScore: result.candidateScore,
        margin: result.margin,
        goldenSetSize: testCases.length,
        consecutiveWins: result.consecutiveWins,
        promoteThreshold,
        canPromote,
        persisted,
      },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
