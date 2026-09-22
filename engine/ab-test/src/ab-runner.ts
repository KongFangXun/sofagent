// ============================================================
// ab-testing/ab-runner.ts · A/B 测试运行器
// v1.3.7 新增 · v1.0.9 替换 simulateAgentRun → runMinimalAgent
// v1.3.7 新增 runReactAgent（方案 C），保留 runMinimalAgent fallback
// current vs candidate 并行对比评测
// v1.5.1：迁移至 @sofagent/ab-test，import 路径对齐新包结构
// ============================================================

import { readFileSync } from 'fs';
import { basename, dirname } from 'path';
import type { ABConfig, ABTestResult } from './types';
import type { EvalBreakdown, TestCase } from '@sofagent/eval';
import { evalCase } from '@sofagent/eval';
import { callModelAPI } from '@sofagent/core';
import type { ModelMessage } from '@sofagent/core';

/** createReactAgent 工厂函数签名（A/B 运行器） */
interface ReactAgentConfig {
  prompt: string;
  tools?: unknown[];
}
interface ReactAgentInstance {
  invoke?: (input: { messages: { role: string; content: string }[] }, config?: { recursionLimit?: number }) => Promise<unknown>;
}
type ReactAgentFactory = (config: { llm: unknown; prompt: string; tools?: unknown[] }) => Promise<ReactAgentInstance>;

/** Agent 运行结果 */
interface AgentResult {
  output: Record<string, unknown>;
}

/**
 * 约束链读空哨兵（v1.4.9 P1-5）。
 *
 * 方案 C（runReactAgent）用 buildConstrainedSystemPrompt 注入四层约束；约束目录与
 * skillPath 不匹配时它**静默返回空串**，Agent 便在「无约束」条件下运行——而 A/B
 * 评审要评的正是「约束下的行为」，无约束评审 = 评审语义被悄悄替换。
 * 哨兵置于消息首部：runTestCase 据此**拒绝降级**（降级到方案 B 只是换一条语义
 * 再跑一遍，会把「约束没注入」这个事实盖住）。
 */
const EMPTY_CONSTRAINT_CHAIN_PREFIX = '[empty-constraint-chain]';

/** 四层约束的段标记（与 harness buildConstrainedSystemPrompt 的段首一一对应） */
const CONSTRAINT_LAYER_MARKERS: readonly string[] = [
  '# 宪法约束',
  '# 企业规则',
  '# 历史经验',
  '# 用户自定义规则',
];

/**
 * 约束链是否为空/仅骨架（v1.4.9 P1-5）。
 *
 * 空串，或四层核心约束（宪法/规范/反思/用户自定义）**一层都没注入** → 视为读空：
 * 此时 systemPrompt 至多剩知识库/身份上下文等骨架，Agent 行为不再受宪法约束。
 */
function isConstraintChainEmpty(systemPrompt: string): boolean {
  if (systemPrompt.trim() === '') return true;
  return !CONSTRAINT_LAYER_MARKERS.some((marker) => systemPrompt.includes(marker));
}

/** 该错误是否为「约束链读空」哨兵（runTestCase 判「不得降级」用） */
function isEmptyConstraintChainError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(EMPTY_CONSTRAINT_CHAIN_PREFIX);
}

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
 * 带超时的 Promise（接收工厂函数，延迟执行）
 */
function withTimeout<T>(factory: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    factory().then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * 方案 B：最小化 Agent 运行——真实模型 API 调用
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
  // v1.4.7 批次 I：fail-loud——skill 读不到时不再静默换通用 prompt（A/B 评审的
  // 语义被无声明替换为通用 assistant，评审报告不标注降级 = 结果不可信还装可信）
  let skillContent: string;
  try {
    skillContent = readFileSync(skillPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `A/B 评审基线 skill 缺失: ${skillPath}——评审结果不可信，中止而非降级` +
        `（读取失败: ${err instanceof Error ? err.message : String(err)}）`,
    );
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
 * 方案 C：LangGraph ReactAgent 运行器（v1.0.7 新增，v1.2.0 迁移至 createReactAgent）
 *
 * 使用 createReactAgent() + buildConstrainedSystemPrompt() 四层加载链。
 * 启动真实 Agent，注入宪法约束 + 企业规则 + 历史经验 + 知识库。
 *
 * @param testCase  测试用例
 * @param skillPath Skill 文件路径
 * @returns Agent 输出的结构化结果
 */
async function runReactAgent(
  testCase: TestCase,
  skillPath: string
): Promise<Record<string, unknown>> {
  // v1.4.9 P1-5：约束链的派生与检查**先于**一切重依赖（langgraph 动态 import / LLM 解析）——
  // 它是配置前置条件，失败应与「langgraph 是否装好 / SOFAGENT_LLM 是否配了」无关。
  // 从 harness 导入约束构建函数（避免循环依赖）
  const { buildConstrainedSystemPrompt } = await import('@sofagent/inject');

  // v1.4.9 P1-5：消除「一个参数两种语义」——`skillPath` 恒为**文件**路径
  // （方案 B 也按文件读它）。方案 C 要的是 harness 的 (projectRoot, skillDir)
  // 二元组，此处从文件路径**显式派生**并把语义写死：
  //   skillPath = <约束目录>/<文件名> ⇒ 约束目录 = dirname(skillPath)
  //   projectRoot = dirname(约束目录) · skillDir = basename(约束目录)
  //   ⇒ harness 读 <约束目录>/SKILL.md · fde.md · think.md · custom/
  // 旧实现把 dirname(skillPath) 当 projectRoot 直接传，harness 会再 join 一层
  // （默认 '.sofagent'）⇒ 实读 <约束目录>/.sofagent/* ⇒ 结构性读空。
  const constraintDir = dirname(skillPath);
  const projectRoot = dirname(constraintDir);
  const skillDirName = basename(constraintDir) || '.sofagent';
  const systemPrompt = buildConstrainedSystemPrompt(projectRoot, { skillDir: skillDirName });

  // 约束链读空 ⇒ 与方案 B 同等处置（B 缺 skill 文件即 fail-loud「中止而非降级」）。
  // 哨兵检查前置到 LLM 解析之前：这是**配置错误**，不该等模型就绪才暴露，
  // 也使该失败的触发与 SOFAGENT_LLM 环境无关（可确定性测试）。
  if (isConstraintChainEmpty(systemPrompt)) {
    throw new Error(
      `${EMPTY_CONSTRAINT_CHAIN_PREFIX} A/B 评审约束链读空（skillPath=${skillPath} ⇒ 约束目录 ${constraintDir} 下无 SKILL.md/fde.md/think.md/custom）：` +
        `React Agent 将在**无约束**条件下运行，评审结果不可信——中止而非静默降级。`,
    );
  }

  // @ts-ignore — @langchain/langgraph/prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const reactCreate = createReactAgent as unknown as ReactAgentFactory;

  // 解析 LLM 模型（从环境变量读取）
  const { resolveLLMModel } = await import('@sofagent/orchestrator');
  const resolved = await resolveLLMModel(null);
  if (!resolved || !resolved.model) {
    throw new Error('LLM 模型未配置（SOFAGENT_LLM 环境变量）');
  }

  const userContent: string =
    typeof testCase.input === 'string'
      ? testCase.input
      : testCase.input?.task
        ? String(testCase.input.task)
        : JSON.stringify(testCase.input);

  const agentConfig: { llm: unknown; prompt: string; tools?: unknown[] } = {
    llm: resolved.model,
    prompt: systemPrompt,
  };
  if (testCase.allowedTools && testCase.allowedTools.length > 0) {
    agentConfig.tools = testCase.allowedTools;
  }

  const agent = await reactCreate(agentConfig);

  const result = await agent.invoke?.({
    messages: [{ role: 'user', content: userContent }],
  }, { recursionLimit: 40 });

  const text = extractResultText(result);
  return parseAgentOutput(text);
}

/**
 * 从 Agent 结果中提取文本
 */
function extractResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
  }
  return String(result ?? '');
}

/**
 * 带降级的运行器：方案 C → 方案 B fallback
 *
 * 先尝试 createReactAgent（方案 C），超时/异常时降级到模型 API 直跑（方案 B）。
 * 降级信息仅在 verbose 模式下输出。
 *
 * @param testCase  测试用例
 * @param skillPath Skill 文件路径
 * @param verbose   是否输出降级信息
 */
async function runTestCase(
  testCase: TestCase,
  skillPath: string,
  verbose: boolean = false
): Promise<Record<string, unknown>> {
  try {
    return await withTimeout(
      () => runReactAgent(testCase, skillPath),
      5 * 60 * 1000 // 5 分钟超时
    );
  } catch (e) {
    // v1.4.9 P1-5：约束链读空**不降级**——它是配置错误而非运行时抖动，降级到
    // 方案 B 只会换一条语义再跑一遍，把「约束没注入」这个事实盖住。
    if (isEmptyConstraintChainError(e)) throw e;
    if (verbose) {
      console.warn(`createReactAgent 运行超时或异常，降级到方案 B（模型 API 直跑）: ${(e as Error).message}`);
    }
    return await runMinimalAgent(testCase, skillPath);
  }
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

  let currentTotal: EvalBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };
  let candidateTotal: EvalBreakdown = { exactMatch: 0, semanticSimilarity: 0, ruleCompliance: 0, overall: 0 };

  for (const testCase of testCases) {
    // v1.0.7: 使用方案 C（createReactAgent）+ 方案 B fallback
    const currentOutput = await runTestCase(testCase, config.current);
    const candidateOutput = await runTestCase(testCase, config.candidate);

    const currentScore = evalCase(currentOutput, testCase.expected);
    const candidateScore = evalCase(candidateOutput, testCase.expected);

    currentTotal = addEvalBreakdowns(currentTotal, currentScore);
    candidateTotal = addEvalBreakdowns(candidateTotal, candidateScore);
  }

  // 平均分
  const n = testCases.length;
  const avgCurrent = divideEvalBreakdown(currentTotal, n);
  const avgCandidate = divideEvalBreakdown(candidateTotal, n);

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
function addEvalBreakdowns(a: EvalBreakdown, b: EvalBreakdown): EvalBreakdown {
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
function divideEvalBreakdown(s: EvalBreakdown, n: number): EvalBreakdown {
  return {
    exactMatch: s.exactMatch / n,
    semanticSimilarity: s.semanticSimilarity / n,
    ruleCompliance: s.ruleCompliance / n,
    overall: s.overall / n,
  };
}
