// ============================================================
// refine.ts · MCP tool：Refine Agent 质量循环（v1.3.7 交付 T04）
// ============================================================
//
// 触发质量循环 + 查结果：
//   refine({ action: 'trigger', task, agent_id })
//     → 触发 Refine 循环（复用 loop-agent 引擎，换 L2 质量判据）
//   refine({ action: 'query' })
//     → 查询上次 Refine 循环的结果摘要
//   refine({ action: 'trigger', task, agent_id, team_id })
//     → 加载团队质量规则（团队反馈来源）
//
// 复用 @sofagent/orchestrator 的 refine-agent 模块：
//   refine-driver（循环驱动）/ quality-judge（质量判定）/ quality-rule-set（规则集）
//
// ⚠️ type 修饰符不可运行时解构（v1.3.2 fde-compose 踩过的坑）：
//   正确：顶层 import type + 运行时只解构值
// ============================================================

// 测试注入：MCP 单测不调真实 LLM——经 setRefineTestRunner 注入 fake runner
let _testRunner:
  | ((task: string, round: number) => Promise<{ exitCode: number; output: string }>)
  | null = null;

/**
 * 测试用 Refine runner 注入（MCP 单测隔离）。
 * @param runner fake runner（返回产出；null 恢复默认）
 */
export function setRefineTestRunner(
  runner: ((task: string, round: number) => Promise<{ exitCode: number; output: string }>) | null,
): void {
  _testRunner = runner;
}

// 缓存上次 Refine 结果（query 模式用）
let _lastRefineResult: RefineResultCache | null = null;

interface RefineResultCache {
  taskId: string;
  finalState: string;
  convergence: string;
  rounds: number;
  totalDurationMs: number;
  ts: string;
}

// ============================================================
// 类型定义
// ============================================================

export interface RefineArgs {
  /** 操作类型：trigger=触发质量循环 / query=查询结果 */
  action: 'trigger' | 'query';
  /** 目标 Agent 身份码（trigger 时可选） */
  agentId?: string;
  /** 任务描述（trigger 时必填——Refine 针对哪个产出做质量优化） */
  task?: string;
  /** 团队 ID（可选——加载团队质量规则） */
  teamId?: string;
}

export interface RefineResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    action: 'trigger' | 'query';
    taskId?: string;
    finalState?: string;
    convergence?: string;
    rounds?: number;
    totalDurationMs?: number;
    isError: boolean;
  };
  /** 顶层错误标记（mcp-server sendTool 第三参数用） */
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 触发 Refine 质量循环（action=trigger）或查询上次结果（action=query）。
 *
 * @param args 参数（action 必填）
 * @returns 结构化结果（text + data）
 */
export async function refine(args: RefineArgs): Promise<RefineResult> {
  // ── 查询模式 ──
  if (args.action === 'query') {
    if (!_lastRefineResult) {
      return {
        text: '[sofagent] refine 查询：暂无 Refine 循环记录',
        data: { action: 'query', isError: false },
      };
    }
    const r = _lastRefineResult;
    return {
      text: [
        `[sofagent] refine 查询结果：`,
        `  - taskId: ${r.taskId}`,
        `  - finalState: ${r.finalState}`,
        `  - convergence: ${r.convergence}`,
        `  - rounds: ${r.rounds}`,
        `  - totalDurationMs: ${r.totalDurationMs}`,
        `  - ts: ${r.ts}`,
      ].join('\n'),
      data: {
        action: 'query',
        taskId: r.taskId,
        finalState: r.finalState,
        convergence: r.convergence,
        rounds: r.rounds,
        totalDurationMs: r.totalDurationMs,
        isError: false,
      },
    };
  }

  // ── 触发模式 ──
  if (!args.task || typeof args.task !== 'string' || args.task.trim() === '') {
    return {
      text: '[sofagent] refine 错误: task 必填（触发质量循环的任务描述）',
      data: { action: 'trigger', isError: true },
      isError: true,
    };
  }

  try {
    const { runRefineLoop } = await import('@sofagent/orchestrator');

    // 团队 ID → 加载团队反馈质量规则（来源 3）
    let ruleSetOptions: Record<string, unknown> | undefined;
    if (args.teamId) {
      try {
        const { getFeedbackByType, loadTeamState } = await import('@sofagent/orchestrator');
        const { existsSync, readFileSync } = await import('fs');
        const { loadEnvConfig } = await import('@sofagent/core');
        const statePath = `${loadEnvConfig().dataDir}/teams/${args.teamId}/team-state.automerge`;
        if (existsSync(statePath)) {
          const binary = new Uint8Array(readFileSync(statePath));
          const doc = loadTeamState(binary);
          const qualityFeedbacks = getFeedbackByType(doc, 'quality_rule');
          if (qualityFeedbacks.length > 0) {
            ruleSetOptions = {
              teamFeedbacks: qualityFeedbacks.map((f) => ({ content: f.content, type: f.type })),
            };
          }
        }
      } catch {
        // 团队规则加载失败 → 降级到内置规则（不阻断）
      }
    }

    const result = await runRefineLoop(args.task, {
      ...(args.agentId ? { agentId: args.agentId } : {}),
      ...(ruleSetOptions ? { ruleSetOptions } : {}),
      ...(_testRunner
        ? {
            runner: (async (task: string, round: number) => {
              const r = await _testRunner!(task, round);
              return {
                exitCode: r.exitCode,
                output: r.output,
                stdout: r.output,
                durationMs: 0,
              };
            }) as never,
          }
        : {}),
    });

    // 缓存结果
    _lastRefineResult = {
      taskId: result.taskId,
      finalState: result.finalState,
      convergence: result.convergence ?? 'n/a',
      rounds: result.rounds.length,
      totalDurationMs: result.totalDurationMs,
      ts: new Date().toISOString(),
    };

    const lines = [
      `[sofagent] Refine 质量循环完成：`,
      `  - taskId: ${result.taskId}`,
      `  - finalState: ${result.finalState}`,
      `  - convergence: ${result.convergence ?? 'n/a'}`,
      `  - rounds: ${result.rounds.length}`,
      `  - totalDurationMs: ${result.totalDurationMs}`,
    ];

    return {
      text: lines.join('\n'),
      data: {
        action: 'trigger',
        taskId: result.taskId,
        finalState: result.finalState,
        convergence: result.convergence ?? 'n/a',
        rounds: result.rounds.length,
        totalDurationMs: result.totalDurationMs,
        isError: false,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] refine 触发失败：${err instanceof Error ? err.message : String(err)}`,
      data: { action: 'trigger', isError: true },
      isError: true,
    };
  }
}
