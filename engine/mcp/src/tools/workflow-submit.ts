// ============================================================
// workflow-submit.ts · MCP tool：workflow_submit（v1.3.6 交付 ①）
// ============================================================
//
// Workflow 外部提交入口——模型层生成的 workflow 从 MCP 进入约束层。
// 委托 @sofagent/orchestrator 的 submitWorkflow 容器：
//   schema 校验（单一事实源）→ parser 解析（含审阅协议字段）→ 可执行句柄。
//
// 行为契约：
//   - mode='validate'（默认）：只校验 + 解析，返回结构化结论（不执行）——
//     外部提交方先拿到校验反馈，再决定是否执行（对齐 workflow_submit 模式）
//   - mode='run'：校验通过后经 dag-runner 加载执行（run 字段触发）
//   - 非法 workflow 返回结构化错误清单（issues），绝不 crash
// ============================================================

export interface WorkflowSubmitArgs {
  /** workflow 文本（YAML 或 JSON） */
  workflow: string;
  /** 执行模式：validate=只校验（默认）/ run=校验后执行 */
  mode?: 'validate' | 'run';
  /** run 模式下的任务描述（供编排主 Agent 组装上下文） */
  task?: string;
}

/**
 * 结构化结果（对齐 snapshot_restore 模式——data 带具体类型，
 * mcp-server 可读 data.isError 判定 isError）。
 */
export interface WorkflowSubmitResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    /** schema + 语义校验是否通过 */
    validated: boolean;
    /** 是否已执行（mode=run 且校验通过时 true） */
    executed: boolean;
    /** workflow 名（校验通过时） */
    name?: string;
    /** 节点数（校验通过时） */
    nodeCount?: number;
    /** merge_criteria 审阅条件（校验通过时） */
    mergeCriteria?: Array<Record<string, unknown>>;
    /** approver 审阅批准者（校验通过时，缺省 null = 默认强制人审） */
    approver?: Record<string, unknown> | null;
    /** 校验未通过时的结构化错误清单（机器可读） */
    issues?: string[];
    /** run 模式执行结果（executed=true 时） */
    result?: unknown;
  };
}

/**
 * workflow_submit——外部提交 workflow 进约束层。
 */
export async function workflowSubmit(args: WorkflowSubmitArgs): Promise<WorkflowSubmitResult> {
  const { workflow, mode = 'validate', task = '' } = args;

  if (typeof workflow !== 'string' || workflow.trim() === '') {
    return {
      text: '[sofagent] workflow_submit 失败：workflow 内容为空',
      data: { isError: true, validated: false, executed: false, issues: ['workflow 内容为空'] },
    };
  }

  try {
    const { submitWorkflow } = await import('@sofagent/orchestrator');
    const handle = submitWorkflow({ workflow });
    const parsed = handle.parsed;

    if (mode === 'validate') {
      const criterionCount = parsed.mergeCriteria?.length ?? 0;
      const approverNote = parsed.approver
        ? `approver=${parsed.approver.id}（${parsed.approver.kind ?? 'human'}）`
        : 'approver=缺省（默认强制人审）';
      const mergeNote =
        criterionCount > 0
          ? `merge_criteria ${criterionCount} 条（${parsed.mergeCriteria!.map((c) => c.kind).join('/')}）`
          : 'merge_criteria=无条件';
      return {
        text:
          `[sofagent] workflow 校验通过 ✅「${parsed.name}」` +
          ` ${parsed.nodes.length} 节点 · ${mergeNote} · ${approverNote}` +
          `\n  mode=validate 只校验不执行；传 mode='run' + task 触发 dag-runner 执行。`,
        data: {
          isError: false,
          validated: true,
          executed: false,
          name: parsed.name,
          nodeCount: parsed.nodes.length,
          mergeCriteria: (parsed.mergeCriteria ?? []).map((c) => ({ ...c })),
          approver: parsed.approver ? { ...parsed.approver } : null,
        },
      };
    }

    // mode='run'：经容器执行（默认 runDAG 路径）
    const result = await handle.run(task || `执行 workflow「${parsed.name}」`);
    return {
      text: `[sofagent] workflow「${parsed.name}」已提交执行（${parsed.nodes.length} 节点）`,
      data: {
        isError: false,
        validated: true,
        executed: true,
        name: parsed.name,
        nodeCount: parsed.nodes.length,
        result,
      },
    };
  } catch (err) {
    // 结构化错误——WorkflowSubmitError 带 issues 清单（机器可读）
    const issues =
      err && typeof err === 'object' && 'issues' in err
        ? (err as { issues: string[] }).issues
        : [err instanceof Error ? err.message : String(err)];
    return {
      text: `[sofagent] workflow 校验未通过 ❌（${issues.length} 项）：${issues.join('；')}`,
      data: { isError: true, validated: false, executed: false, issues },
    };
  }
}
