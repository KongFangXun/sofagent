// ============================================================
// slash-commands/goal.ts · /goal 命令实现
// v1.2.7 新建 · 功能 ①
//
// Session Goals——循环收敛从"启发式"升级为"目标驱动"：
//   1. 用户 /goal <完成条件> 设置 SessionGoal
//   2. 每轮结束后用轻量非思考模型评估当前状态是否满足条件
//   3. 评估输出 PASS/CONTINUE/FAIL
//   4. satisfied=true → stopReason='goal-met'
//   5. satisfied=false AND continuations < max → 继续下一轮
//   6. continuations >= max → stopReason='goal-max-continuations'
//
// 向后兼容：未配置 goal 时 fallback 到现有"连续 2 轮无 P0/P1"逻辑。
//
// 模型配置：新增 SOFAGENT_LLM_GOAL_EVAL，缺省时 fallback 到 SOFAGENT_LLM。
// ============================================================

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SlashCommand, SlashCommandContext } from '../slash-registry';
import { DATA_DIR } from '../data-paths';

/**
 * Session Goal 数据结构——存储在 data/orchestrator/goals/current.json
 */
export interface SessionGoal {
  /** 自然语言完成条件（如"所有 P0/P1 已修复且 a-verify IS_PASS=YES"） */
  condition: string;
  /** 评估模型（默认从 SOFAGENT_LLM_GOAL_EVAL 解析） */
  evalModel?: string;
  /** 安全上限：最多续接次数（默认 10） */
  maxContinuations: number;
  /** 当前已续接次数 */
  currentContinuations: number;
  /** 创建时间 ISO 8601 */
  createdAt: string;
}

/**
 * FORGE loop spec 新增字段（loop.md 中定义）。
 * 用于扩展 LoopSpec 的 goal 配置。
 */
export interface LoopSpecGoalExtension {
  completion_condition: string;
  goal_eval_model?: string;
  max_continuations?: number;
}

/** SessionGoal 存储路径 */
function resolveGoalPath(dataDir: string): string {
  return join(dataDir, 'orchestrator', 'goals', 'current.json');
}

/** 默认最大续接次数 */
const DEFAULT_MAX_CONTINUATIONS = 10;

/** /goal 命令实现 */
export class GoalCommand implements SlashCommand {
  readonly name = 'goal';
  readonly description = '设置会话目标——循环收敛从启发式升级为目标驱动';
  readonly usage = '/goal <完成条件>  |  /goal --status  |  /goal --clear';

  async execute(args: string[], ctx: SlashCommandContext): Promise<string> {
    // /goal --status: 查看当前目标
    if (args.length === 1 && args[0] === '--status') {
      return this.showStatus(ctx.dataDir);
    }

    // /goal --clear: 清除目标
    if (args.length === 1 && args[0] === '--clear') {
      return this.clearGoal(ctx.dataDir);
    }

    // /goal <完成条件>: 设置新目标
    if (args.length === 0) {
      return [
        '用法：',
        '  /goal <完成条件>     设置会话目标',
        '  /goal --status       查看当前目标',
        '  /goal --clear        清除当前目标',
        '',
        '示例：',
        '  /goal 所有 P0/P1 已修复且 IS_PASS=YES',
        '  /goal 测试覆盖率 ≥ 80%',
      ].join('\n');
    }

    const condition = args.join(' ');
    return this.setGoal(ctx.dataDir, condition);
  }

  /**
   * 设置新的 SessionGoal。
   */
  private setGoal(dataDir: string, condition: string): string {
    const goal: SessionGoal = {
      condition,
      evalModel: process.env.SOFAGENT_LLM_GOAL_EVAL,
      maxContinuations: DEFAULT_MAX_CONTINUATIONS,
      currentContinuations: 0,
      createdAt: new Date().toISOString(),
    };

    const goalPath = resolveGoalPath(dataDir);
    const goalDir = join(goalPath, '..');
    if (!existsSync(goalDir)) mkdirSync(goalDir, { recursive: true });
    writeFileSync(goalPath, JSON.stringify(goal, null, 2) + '\n');

    return [
      `✅ 会话目标已设置`,
      `   条件: ${condition}`,
      `   最大续接: ${goal.maxContinuations} 轮`,
      `   评估模型: ${goal.evalModel ?? '(fallback SOFAGENT_LLM)'}`,
      '',
      '每轮结束后将自动评估是否满足条件。',
    ].join('\n');
  }

  /**
   * 查看当前目标状态。
   */
  private showStatus(dataDir: string): string {
    const goalPath = resolveGoalPath(dataDir);
    if (!existsSync(goalPath)) {
      return 'ℹ️ 当前未设置会话目标';
    }
    try {
      const goal = JSON.parse(readFileSync(goalPath, 'utf-8')) as SessionGoal;
      return [
        '📋 当前会话目标：',
        `   条件: ${goal.condition}`,
        `   最大续接: ${goal.maxContinuations}`,
        `   当前续接: ${goal.currentContinuations}`,
        `   评估模型: ${goal.evalModel ?? '(fallback SOFAGENT_LLM)'}`,
        `   创建时间: ${goal.createdAt}`,
      ].join('\n');
    } catch {
      return '⚠️ 目标文件损坏，请重新设置';
    }
  }

  /**
   * 清除当前目标。
   */
  private clearGoal(dataDir: string): string {
    const goalPath = resolveGoalPath(dataDir);
    if (!existsSync(goalPath)) {
      return 'ℹ️ 当前未设置会话目标';
    }
    try {
      writeFileSync(goalPath, '');
      return '✅ 会话目标已清除（后续循环回退到启发式停止条件）';
    } catch {
      return '⚠️ 清除失败——请手动删除 data/orchestrator/goals/current.json';
    }
  }
}

/**
 * 从磁盘加载当前 SessionGoal（供 nodes.ts goal 评估节点调用）。
 * @param dataDir 数据目录
 * @returns SessionGoal 或 null（未设置）
 */
export function loadSessionGoal(dataDir: string): SessionGoal | null {
  const goalPath = resolveGoalPath(dataDir);
  if (!existsSync(goalPath)) return null;
  try {
    const content = readFileSync(goalPath, 'utf-8').trim();
    if (!content) return null;
    return JSON.parse(content) as SessionGoal;
  } catch {
    return null;
  }
}

/**
 * 递增续接计数（每轮 goal 评估 CONTINUE 后调用）。
 * @param dataDir 数据目录
 * @returns 更新后的 currentContinuations
 */
export function incrementContinuations(dataDir: string): number {
  const goal = loadSessionGoal(dataDir);
  if (!goal) return 0;
  goal.currentContinuations += 1;
  const goalPath = resolveGoalPath(dataDir);
  writeFileSync(goalPath, JSON.stringify(goal, null, 2) + '\n');
  return goal.currentContinuations;
}

/**
 * 调轻量模型评估目标是否满足。
 *
 * @param condition 自然语言完成条件
 * @param currentState 当前状态摘要（审计报告 + 审查报告等）
 * @param dataDir 数据目录（用于读取 evalModel 配置）
 * @returns 'PASS' | 'CONTINUE' | 'FAIL'
 */
export async function evaluateGoal(
  condition: string,
  currentState: string,
  dataDir: string,
): Promise<'PASS' | 'CONTINUE' | 'FAIL'> {
  const goal = loadSessionGoal(dataDir);
  const evalLlm = goal?.evalModel
    ?? process.env.SOFAGENT_LLM_GOAL_EVAL
    ?? process.env.SOFAGENT_LLM;

  if (!evalLlm) {
    // 模型不可用时保守返回 CONTINUE（不停止）
    return 'CONTINUE';
  }

  const [provider, modelName] = evalLlm.split(':');
  const providerKey = provider ?? '';

  const LLM_PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
    glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4/', defaultModel: 'glm-4-flash' },
    kimi: { baseURL: 'https://api.moonshot.cn/v1/', defaultModel: 'moonshot-v1-8k' },
    deepseek: { baseURL: 'https://api.deepseek.com/v1/', defaultModel: 'deepseek-chat' },
  };

  let baseURL: string;
  if (providerKey === 'custom') {
    baseURL = process.env.SOFAGENT_LLM_BASE_URL ?? '';
    if (!baseURL) return 'CONTINUE';
  } else {
    const config = LLM_PROVIDERS[providerKey];
    if (!config) return 'CONTINUE';
    baseURL = config.baseURL;
  }

  const apiKey = process.env.SOFAGENT_LLM_GOAL_EVAL_API_KEY
    ?? process.env.SOFAGENT_LLM_API_KEY
    ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return 'CONTINUE';

  try {
    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({
      modelName: modelName || LLM_PROVIDERS[providerKey]?.defaultModel || 'gpt-4o-mini',
      configuration: { baseURL },
      openAIApiKey: apiKey,
    });

    const prompt = [
      '你是目标评估助手。判断当前状态是否满足指定的完成条件。',
      '',
      `完成条件：${condition}`,
      '',
      '当前状态：',
      currentState.slice(0, 4000),
      '',
      '请只输出以下三个词之一（不要其他内容）：',
      '  PASS    — 条件已满足，可以停止',
      '  CONTINUE — 条件尚未满足，可以继续',
      '  FAIL    — 条件无法满足，应当停止',
    ].join('\n');

    const response = await model.invoke([
      { role: 'system', content: '你是目标评估助手。只输出 PASS / CONTINUE / FAIL。' },
      { role: 'user', content: prompt },
    ]);

    const text = typeof response === 'string'
      ? response
      : (response as { content?: string })?.content ?? '';
    const upper = text.trim().toUpperCase();

    if (upper.includes('PASS')) return 'PASS';
    if (upper.includes('FAIL')) return 'FAIL';
    return 'CONTINUE';
  } catch {
    return 'CONTINUE';
  }
}
