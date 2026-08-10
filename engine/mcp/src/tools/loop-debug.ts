// ============================================================
// loop-debug.ts · MCP tool：Onboard Agent L1 调试循环（v1.3.1 交付 8）
// ============================================================
//
// 触发调试循环 + 查结果：
//   loop_debug({ task, agent_id?, max_rounds?, timeout_ms? })
//     → 触发 Onboard L1 循环（activate → run → judge → fix → re-run）
//   loop_debug({})（无 task）
//     → 查询最近调试记录（loop-debug.jsonl，带 agentId 可追溯）
//
// 调试记录带 agentId（交付 6 身份码协同 / 交付 7 跨设备聚合可追溯）。
// 复用 @sofagent/orchestrator 的 runOnboardLoop + readLoopDebugRecords
// （动态 import——workspace symlink 解析，不新增包依赖）。
// ============================================================

// 测试注入：MCP 单测不调真实 LLM——经 setLoopDebugTestRunner 注入 fake runner
let _testRunner: ((task: string, round: number) => Promise<{ exitCode?: number | null; output?: string; stderr?: string; durationMs?: number }>) | null = null;

/**
 * 测试用 runner 注入（MCP 单测隔离——不触发真实 LLM/进程）。
 * @param runner fake runner（返回判定输入；缺省 null 恢复默认 dag-runner）
 */
export function setLoopDebugTestRunner(
  runner: ((task: string, round: number) => Promise<{ exitCode?: number | null; output?: string; stderr?: string; durationMs?: number }>) | null,
): void {
  _testRunner = runner;
}

// ============================================================
// 类型定义
// ============================================================

export interface LoopDebugArgs {
  /** 任务描述（缺省 = 查询模式，不触发新循环） */
  task?: string;
  /** Agent 身份码（交付 6 协同；写入调试记录） */
  agent_id?: string;
  /** 最大循环轮数（默认 3） */
  max_rounds?: number;
  /** 超时阈值 ms（默认 120000） */
  timeout_ms?: number;
}

export interface LoopDebugResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    mode: 'run' | 'query';
    taskId?: string;
    agentId?: string;
    finalState?: string;
    rounds?: Array<{ round: number; state: string; detail: string; durationMs?: number }>;
    records?: Array<{ ts: string; taskId: string; agentId?: string; round: number; state: string }>;
    isError: boolean;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 触发 Onboard L1 调试循环（有 task）或查询最近调试记录（无 task）。
 *
 * @param args 参数
 * @returns 结构化结果（text + data）
 */
export async function loopDebug(args: LoopDebugArgs): Promise<LoopDebugResult> {
  // ── 查询模式：无 task → 读最近调试记录 ──
  if (!args.task || typeof args.task !== 'string') {
    try {
      const { resolveLoopDebugLogPath, readLoopDebugRecords } = await import('@sofagent/orchestrator');
      const filePath = resolveLoopDebugLogPath();
      const records = readLoopDebugRecords(filePath, args.agent_id ? { agentId: args.agent_id } : {});
      const recent = records.slice(-20).reverse();
      const lines = [`[sofagent] loop_debug 调试记录共 ${records.length} 条（最近 ${recent.length} 条）:`];
      for (const r of recent) {
        lines.push(`  - [${r.ts}] task=${r.taskId} round=${r.round} state=${r.state}${r.agentId ? ` agent=${r.agentId}` : ''}`);
      }
      return {
        text: lines.join('\n'),
        data: {
          mode: 'query',
          records: recent.map((r) => ({ ts: r.ts, taskId: r.taskId, ...(r.agentId ? { agentId: r.agentId } : {}), round: r.round, state: r.state })),
          isError: false,
        },
      };
    } catch (err) {
      return {
        text: `[sofagent] loop_debug 查询失败：${err instanceof Error ? err.message : String(err)}`,
        data: { mode: 'query', isError: true },
      };
    }
  }

  // ── 触发模式：有 task → 跑 Onboard L1 循环 ──
  try {
    const { runOnboardLoop } = await import('@sofagent/orchestrator');
    const result = await runOnboardLoop(args.task, {
      agentId: args.agent_id,
      maxRounds: args.max_rounds,
      timeoutMs: args.timeout_ms,
      ...(_testRunner ? { runner: _testRunner as never } : {}),
    });

    const roundLines = result.rounds.map(
      (r) => `  第${r.round}轮: ${r.verdict.state}${r.verdict.durationMs !== undefined ? `（${r.verdict.durationMs}ms）` : ''} — ${r.verdict.detail}`,
    );
    const text = [
      `[sofagent] Onboard L1 调试完成 · finalState=${result.finalState} · ${result.rounds.length} 轮`,
      ...roundLines,
    ].join('\n');

    return {
      text,
      data: {
        mode: 'run',
        taskId: result.taskId,
        ...(result.agentId ? { agentId: result.agentId } : {}),
        finalState: result.finalState,
        rounds: result.rounds.map((r) => ({
          round: r.round,
          state: r.verdict.state,
          detail: r.verdict.detail,
          ...(r.verdict.durationMs !== undefined ? { durationMs: r.verdict.durationMs } : {}),
        })),
        isError: false,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] loop_debug 触发失败：${err instanceof Error ? err.message : String(err)}`,
      data: { mode: 'run', isError: true },
    };
  }
}
