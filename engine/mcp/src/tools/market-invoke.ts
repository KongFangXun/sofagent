// ============================================================
// market-invoke.ts · MCP tool: market_invoke（v1.3.6 交付 2）
//
// 能力调用——发现能力 → 挂载调用 → 结果回流。
// 挂载前强制 SkillScan（DANGEROUS 拦截 / SUSPICIOUS 走 HITL）。
//
// 复用 @sofagent/orchestrator 的 market/invoker.ts。
// executor 注入——MCP 层默认返回 dry-run 结果（真实执行由 Agent runtime 接入）。
// ============================================================
// 测试注入：MCP 单测不调真实被测能力——经 setInvokeTestExecutor 注入 fake executor
let _testExecutor: ((input: { capabilityId: string; sourcePath: string; input: unknown }) => Promise<unknown>) | null = null;

/**
 * 测试用能力执行器注入（MCP 单测隔离）。
 * @param fn fake executor（返回产出；null 恢复默认）
 */
export function setInvokeTestExecutor(
  fn: ((input: { capabilityId: string; sourcePath: string; input: unknown }) => Promise<unknown>) | null,
): void {
  _testExecutor = fn;
}

// ============================================================
// 类型定义
// ============================================================

export interface MarketInvokeArgs {
  /** 能力 ID（必填——先 market_search 发现） */
  capability_id: string;
  /** 调用者 agentId（必填——谁调的） */
  caller_agent_id: string;
  /** 调用入参（透传给被调能力） */
  input?: unknown;
}

export interface MarketInvokeResult {
  text: string;
  data: {
    ok: boolean;
    capabilityId?: string;
    outcome?: string;
    durationMs?: number;
    scanVerdict?: string;
    needHITL?: boolean;
    output?: unknown;
    error?: string;
  };
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 发现并调用一个能力。
 *
 * @param args 入参
 * @returns 调用结果
 */
export async function marketInvoke(args: MarketInvokeArgs): Promise<MarketInvokeResult> {
  if (!args.capability_id || !args.caller_agent_id) {
    return {
      text: '[sofagent] market_invoke 错误: capability_id 和 caller_agent_id 必填',
      data: { ok: false, error: 'capability_id 和 caller_agent_id 必填' },
      isError: true,
    };
  }

  try {
    const mod = require('@sofagent/orchestrator') as {
      invokeCapability: (
        input: { capabilityId: string; callerAgentId: string; input?: unknown; skipScan?: boolean },
        executor: (i: { capabilityId: string; sourcePath: string; input: unknown }) => Promise<unknown>,
        dataDir?: string,
      ) => Promise<{
        capabilityId: string;
        capabilityName: string;
        outcome: string;
        output?: unknown;
        scan?: { verdict: string };
        needHITL?: boolean;
        durationMs: number;
        reason?: string;
      }>;
    };

    // 默认 executor：dry-run 模式（MCP 层不直接执行能力，返回占位）
    const executor = _testExecutor
      ? async (i: { capabilityId: string; sourcePath: string; input: unknown }) => _testExecutor!(i)
      : async (_i: { capabilityId: string; sourcePath: string; input: unknown }) => `[dry-run] 能力 ${_i.capabilityId} 调用占位（真实执行由 Agent runtime 注入）`;

    const result = await mod.invokeCapability(
      { capabilityId: args.capability_id, callerAgentId: args.caller_agent_id, ...(args.input !== undefined ? { input: args.input } : {}) },
      executor,
    );

    if (result.outcome === 'blocked') {
      return {
        text: `[sofagent] 调用被拦截: ${result.reason}`,
        data: {
          ok: false,
          capabilityId: result.capabilityId,
          outcome: result.outcome,
          durationMs: result.durationMs,
          ...(result.scan ? { scanVerdict: result.scan.verdict } : {}),
          error: result.reason,
        },
        isError: true,
      };
    }

    if (result.outcome === 'hitl_pending') {
      return {
        text: `[sofagent] 能力「${result.capabilityName}」需人工确认（SkillScan SUSPICIOUS）`,
        data: {
          ok: false,
          capabilityId: result.capabilityId,
          outcome: result.outcome,
          needHITL: true,
          ...(result.scan ? { scanVerdict: result.scan.verdict } : {}),
          error: result.reason,
        },
        isError: true,
      };
    }

    const ok = result.outcome === 'success';
    return {
      text: ok
        ? `[sofagent] 能力「${result.capabilityName}」调用成功（${result.durationMs}ms）`
        : `[sofagent] 能力「${result.capabilityName}」调用失败: ${result.reason}`,
      data: {
        ok,
        capabilityId: result.capabilityId,
        outcome: result.outcome,
        durationMs: result.durationMs,
        ...(result.scan ? { scanVerdict: result.scan.verdict } : {}),
        ...(result.output !== undefined ? { output: result.output } : {}),
        ...(result.reason ? { error: result.reason } : {}),
      },
      isError: !ok,
    };
  } catch (err) {
    return {
      text: `[sofagent] market_invoke 失败: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}
