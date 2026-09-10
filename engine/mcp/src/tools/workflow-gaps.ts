// workflow-gaps.ts · MCP tool：workflow_gaps（G2 能力缺口查询）
// 商业平台悬赏数据源——委托 @sofagent/orchestrator 的 analyzeWorkflowGaps


export interface WorkflowGapsResult {
  text: string;
  data: {
    isError: boolean;
    gaps: Array<{ kind: string; workflow_id: string; node: string; agent: string; evidence: string }>;
    summary: { missing_agent: number; low_capability: number; needs_upgrade: number; total: number };
    scanned: number;
    windowDays: number;
  };
}

export async function workflowGaps(args: Record<string, unknown>): Promise<WorkflowGapsResult> {
  const explicit = typeof args.data_dir === 'string' ? args.data_dir : undefined;
  const windowDays = typeof args.window_days === 'number' ? args.window_days : undefined;

  let dataDir: string;
  if (explicit) {
    dataDir = explicit;
  } else {
    const { getDataDir } = await import('@sofagent/core');
    dataDir = getDataDir();
  }

  const { analyzeWorkflowGaps } = await import('@sofagent/orchestrator');
  return analyzeWorkflowGaps(dataDir, windowDays !== undefined ? { windowDays } : undefined);
}
