// ============================================================
// ab-testing/ab-runner.ts · A/B 测试运行器
// v1.0.6 新增 · v1.0.6 替换 simulateAgentRun → runMinimalAgent
// current vs candidate 并行对比评测
// ============================================================

import { readFileSync } from 'fs';
import type { ABConfig, ABTestResult } from './types';
import type { ScoreBreakdown, TestCase } from '../eval/types';
import { scoreCase } from '../eval/eval-scorer';
import { callModelAPI } from '../model-client';
import type { ModelMessage } from '../model-client';

/**
 * 解析模型输出为结构化结果
 * 尝试 JSON 解析，失败则包装为 { output: rawText }
 */
function parseAgentOutput(rawOutput: string): Record<string, unknown> {
  // 尝试提取 JSON 块（模型可能在 markdown 代码块中返回 JSON）
  const jsonBlockMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = jsonBlockMatch ? jsonBlockMatch[1]!.trim() : rawOutput.trim();

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSON 解析失败，fall through 到文本包装
  }

  // 尝试从文本中提取最外层 JSON 对象
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]!);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 仍然失败，fall through
    }
  }

  return { output: rawOutput };
}

/**
 * 最小化 Agent 运行——真实模型 API 调用
 *
 * 工作流程：
 * 1. 读取 Skill 文件内容作为 system prompt
 * 2. 组装消息：system = skillContent, user = testCase.input.task
 * 3. 调模型 API（temperature=0.3）
 * 4. 解析输出为结构化结果
 *
 * @param testCase  测试用例
 * @param skillPath Skill 文件路径
 * @returns 模型输出的结构化结果
 */
async function runMinimalAgent(
  testCase: TestCase,
  skillPath: string
): Promise<Record<string, unknown>> {
  // 1. 读 Skill 文件内容作为 system prompt
  let skillContent: string;
  try {
    skillContent = readFileSync(skillPath, 'utf-8');
  } catch {
    // Skill 文件不存在时，使用空 system prompt
    skillContent = 'You are a helpful assistant.';
  }

  // 2. 组装消息
  const userContent: string =
    typeof testCase.input === 'string'
      ? testCase.input
      : testCase.input?.task
        ? String(testCase.input.task)
        : JSON.stringify(testCase.input);

  const messages: ModelMessage[] = [
    { role: 'system', content: skillContent },
    { role: 'user', content: userContent },
  ];

  // 3. 调模型 API（temperature=0.3，60s 超时，失败重试 1 次）
  const response = await callModelAPI(messages, { temperature: 0.3 });

  // 4. 解析输出为结构化结果
  return parseAgentOutput(response);
}

/**
 * 运行单次 A/B 测试对比
 * @param config A/B 配置
 * @param testCases 测试用例集
 * @param previousConsecutiveWins 历史连续胜出次数
 */
export async function runABTest(
  config: ABConfig,
  testCases: TestCase[],
  previousConsecutiveWins: number = 0
): Promise<ABTestResult> {
  if (testCases.length < config.minSampleSize) {
    // 样本不足，返回平局
    return {
      currentScore: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
      candidateScore: { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 },
      winner: 'tie' as const,
      margin: 0,
      consecutiveWins: previousConsecutiveWins,
    };
  }

  let currentTotal: ScoreBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };
  let candidateTotal: ScoreBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };

  for (const testCase of testCases) {
    // 公平性：同一 testCase 先跑 current 再跑 candidate（相同调用顺序）
    const currentOutput = await runMinimalAgent(testCase, config.current);
    const candidateOutput = await runMinimalAgent(testCase, config.candidate);

    const currentScore = scoreCase(currentOutput, testCase.expected);
    const candidateScore = scoreCase(candidateOutput, testCase.expected);

    currentTotal = addScores(currentTotal, currentScore);
    candidateTotal = addScores(candidateTotal, candidateScore);
  }

  // 平均分
  const n = testCases.length;
  const avgCurrent = divideScore(currentTotal, n);
  const avgCandidate = divideScore(candidateTotal, n);

  const weights = config.scoreWeights;
  const currentWeighted = avgCurrent.exactMatch * weights.exactMatch
    + avgCurrent.semanticSimilarity * weights.semanticSimilarity
    + avgCurrent.ruleCompliance * weights.ruleCompliance;
  const candidateWeighted = avgCandidate.exactMatch * weights.exactMatch
    + avgCandidate.semanticSimilarity * weights.semanticSimilarity
    + avgCandidate.ruleCompliance * weights.ruleCompliance;

  const margin = candidateWeighted - currentWeighted;
  const minMargin = 0.01; // 最小分差阈值

  let winner: 'current' | 'candidate' | 'tie';
  let consecutiveWins = previousConsecutiveWins;

  if (margin > minMargin) {
    winner = 'candidate';
    consecutiveWins = previousConsecutiveWins + 1;
  } else if (margin < -minMargin) {
    winner = 'current';
    consecutiveWins = 0;
  } else {
    winner = 'tie';
    // tie 不重置计数器，但也不累加
  }

  return {
    currentScore: avgCurrent,
    candidateScore: avgCandidate,
    winner,
    margin,
    consecutiveWins,
  };
}

/**
 * 评分加法
 */
function addScores(a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown {
  return {
    exactMatch: a.exactMatch + b.exactMatch,
    semanticSimilarity: a.semanticSimilarity + b.semanticSimilarity,
    ruleCompliance: a.ruleCompliance + b.ruleCompliance,
    overall: a.overall + b.overall,
  };
}

/**
 * 评分除法
 */
function divideScore(s: ScoreBreakdown, n: number): ScoreBreakdown {
  return {
    exactMatch: s.exactMatch / n,
    semanticSimilarity: s.semanticSimilarity / n,
    ruleCompliance: s.ruleCompliance / n,
    overall: s.overall / n,
  };
}
