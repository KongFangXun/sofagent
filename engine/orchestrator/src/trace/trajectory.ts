// ============================================================
// trace/trajectory.ts · LLM Trace 任务级轨迹视图（v1.3.7 交付 11）
// ============================================================
//
// 按 taskId 聚合 v1.3.1 的 llm-calls.jsonl（调用级 Trace）+ runtime-audit 关联，
// 生成任务级轨迹视图（输入/思考/工具调用/结果/下一步的完整多轮轨迹）。
//
// 只读聚合——不改变 v1.3.1 调用级 Trace 写入点。
// 用途：调试回放（失败按 taskId 看完整调用链）+ RL 训练输入（v1.4.3 样本聚合）。
// ============================================================

import { readLlmCallTrace, type LlmCallRecord } from '@sofagent/core';
import { readLoopDebugRecords, resolveLoopDebugLogPath, type LoopDebugRecord } from '../loop-agent/driver';

/** 单步轨迹（一个完整的推理-行动-观察周期） */
export interface TrajectoryStep {
  /** 步骤序号 */
  step: number;
  /** 时间戳 */
  timestamp: string;
  /** 步骤类型 */
  type: 'llm-call' | 'tool-call' | 'judgment' | 'fix' | 'observation';
  /** 输入/上下文 */
  input: string;
  /** 思考/推理（LLM 输出或工具返回） */
  thinking?: string;
  /** 工具调用（如果有） */
  toolCall?: {
    tool: string;
    args?: Record<string, unknown>;
  };
  /** 结果 */
  result?: {
    status: 'pass' | 'fail' | 'error' | 'blocked' | 'unknown';
    output?: string;
    error?: string;
  };
  /** 下一步说明 */
  nextStep?: string;
}

/** 任务级轨迹（完整多轮调用链） */
export interface TaskTrajectory {
  /** 任务 ID */
  taskId: string;
  /** Agent 身份码（可选） */
  agentId?: string;
  /** 轨迹起始时间 */
  startTime?: string;
  /** 轨迹结束时间 */
  endTime?: string;
  /** 步骤列表 */
  steps: TrajectoryStep[];
  /** 轨迹统计 */
  stats: {
    totalSteps: number;
    llmCallCount: number;
    toolCallCount: number;
    failureCount: number;
    totalDurationMs: number;
  };
}

/** 轨迹聚合选项 */
export interface TrajectoryOptions {
  /** taskId（必填——轨迹按 taskId 聚合） */
  taskId: string;
  /** Agent 身份码过滤（可选） */
  agentId?: string;
  /** 测试隔离用 SOFAGENT_HOME 覆盖 */
  overrideHome?: string;
  /** 调试记录文件路径（默认 {dataDir}/audit/runtime/loop-debug.jsonl） */
  debugLogPath?: string;
}

/**
 * 按 taskId 聚合完整任务级轨迹。
 *
 * 数据源（只读聚合——不改变写入点）：
 *   1. llm-calls.jsonl（v1.3.1 调用级 Trace）—— 按 taskId 过滤
 *   2. loop-debug.jsonl（Onboard 循环调试记录）—— 按 taskId 过滤
 *   3. runtime-audit 关联（审计日志摘要）
 *
 * @param options 聚合选项
 * @returns TaskTrajectory
 */
export function aggregateTrajectory(options: TrajectoryOptions): TaskTrajectory {
  const { taskId, agentId, overrideHome, debugLogPath } = options;

  // 1. 读取 LLM 调用 Trace（v1.3.1）
  const llmRecords: LlmCallRecord[] = readLlmCallTrace({
    taskId,
    ...(agentId ? { agentId } : {}),
    ...(overrideHome ? { overrideHome } : {}),
  });

  // 2. 读取 Onboard 循环调试记录
  const resolvedDebugPath = resolveLoopDebugLogPath(undefined, debugLogPath);
  const debugRecords: LoopDebugRecord[] = readLoopDebugRecords(resolvedDebugPath, {
    taskId,
    ...(agentId ? { agentId } : {}),
  });

  // 3. 合并并按时间排序
  const mergedSteps: Array<{ timestamp: string; build: () => TrajectoryStep }> = [];

  // LLM 调用 → TrajectoryStep
  for (const rec of llmRecords) {
    mergedSteps.push({
      timestamp: rec.ts,
      build: () => ({
        step: 0, // 后续重新编号
        timestamp: rec.ts,
        type: 'llm-call',
        input: `provider=${rec.provider} model=${rec.model}`,
        thinking: rec.rawResponse?.slice(0, 200) ?? undefined,
        result: {
          status: rec.stopReason === 'completed' ? 'pass' : rec.stopReason === 'auth' ? 'blocked' : 'fail',
          error: rec.error ?? undefined,
        },
      }),
    });
  }

  // 循环调试记录 → TrajectoryStep
  for (const rec of debugRecords) {
    mergedSteps.push({
      timestamp: rec.ts,
      build: () => ({
        step: 0,
        timestamp: rec.ts,
        type: rec.round === 0 ? 'observation' : rec.state === 'passed' ? 'judgment' : 'fix',
        input: `round=${rec.round}`,
        result: {
          status: rec.state === 'passed' ? 'pass' : 'fail',
          output: rec.detail,
        },
        nextStep: rec.state === 'passed' ? undefined : '修复后重试',
      }),
    });
  }

  // 按时间排序
  mergedSteps.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // 重新编号步骤
  const steps: TrajectoryStep[] = mergedSteps.map((m, i) => ({
    ...m.build(),
    step: i + 1,
  }));

  // 统计
  const llmCallCount = steps.filter((s) => s.type === 'llm-call').length;
  const toolCallCount = steps.filter((s) => s.type === 'tool-call').length;
  const failureCount = steps.filter((s) => s.result?.status === 'fail' || s.result?.status === 'error').length;

  // 总耗时（从 LLM Trace 累加 durationMs）
  const totalDurationMs = llmRecords.reduce((sum, r) => sum + (r.durationMs || 0), 0);

  return {
    taskId,
    ...(agentId ? { agentId } : {}),
    startTime: steps.length > 0 ? steps[0]!.timestamp : undefined,
    endTime: steps.length > 0 ? steps[steps.length - 1]!.timestamp : undefined,
    steps,
    stats: {
      totalSteps: steps.length,
      llmCallCount,
      toolCallCount,
      failureCount,
      totalDurationMs,
    },
  };
}

/**
 * 导出轨迹为结构化 JSON（v1.4.1 RL 训练样本聚合消费方就绪）。
 *
 * @param trajectory 任务级轨迹
 * @returns JSON 字符串
 */
export function exportTrajectoryJson(trajectory: TaskTrajectory): string {
  return JSON.stringify(trajectory, null, 2);
}

/**
 * 导出轨迹为 RL 训练格式（step-level MDP）。
 *
 * 每步是一个 (state, action, reward, next_state) 四元组。
 *
 * @param trajectory 任务级轨迹
 * @returns RL 训练样本数组
 */
export function exportTrajectoryForRL(trajectory: TaskTrajectory): Array<{
  step: number;
  state: string;
  action: string;
  reward: number;
  nextState: string;
}> {
  const samples: Array<{ step: number; state: string; action: string; reward: number; nextState: string }> = [];

  for (let i = 0; i < trajectory.steps.length; i++) {
    const step = trajectory.steps[i]!;
    const nextStep = trajectory.steps[i + 1];

    const state = step.input;
    const action = step.thinking ?? step.toolCall?.tool ?? step.type;
    const reward = step.result?.status === 'pass' ? 1 : step.result?.status === 'fail' ? -1 : 0;
    const nextState = nextStep?.input ?? step.result?.output ?? '(end)';

    samples.push({ step: step.step, state, action, reward, nextState });
  }

  return samples;
}
