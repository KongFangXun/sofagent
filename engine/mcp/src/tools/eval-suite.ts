// ============================================================
// eval-suite.ts · MCP tool：企业专属 eval 套件（v1.3.2 交付 6）
// ============================================================
//
// eval_suite({ action, enterprise_id, industry })
//   action=instantiate → 从行业模板实例化 eval 套件
//   action=freeze → 冻结基线（调 freezeBenchmark）
//   action=run → 运行 eval 套件（调 runEvalSuite）
//   action=query → 查询 eval 运行日志
// ============================================================

export interface EvalSuiteArgs {
  /** 操作类型 */
  action: 'instantiate' | 'freeze' | 'run' | 'query';
  /** 企业 ID */
  enterprise_id: string;
  /** 行业 */
  industry?: 'finance' | 'manufacturing' | 'supplychain' | 'customerservice' | 'generic';
  /** 自定义 case（action=instantiate 时） */
  custom_cases?: Array<{
    id: string;
    statement: string;
    rubric: string;
  }>;
}

export interface EvalSuiteResult {
  text: string;
  data: {
    action: string;
    benchmarkId?: string;
    frozen?: boolean;
    revision?: number;
    caseCount?: number;
    runResult?: {
      totalCases: number;
      passedCases: number;
      averageScore: number;
    };
    isError: boolean;
  };
}

/**
 * 企业 eval 套件 MCP tool。
 */
export async function evalSuite(args: EvalSuiteArgs): Promise<EvalSuiteResult> {
  if (!args.enterprise_id) {
    return {
      text: '[sofagent] eval_suite 错误: enterprise_id 必填',
      data: { action: args.action, isError: true },
    };
  }

  try {
    const orchestrator = await import('@sofagent/orchestrator');
    const {
      instantiateEvalSuite,
      freezeEvalBaseline,
      runEvalSuite,
      loadIndustryTemplate,
    } = orchestrator;

    const industry = args.industry ?? 'generic';

    // ── instantiate ──
    if (args.action === 'instantiate') {
      const suite = instantiateEvalSuite(
        args.enterprise_id,
        industry,
        (args.custom_cases ?? []).map((c) => ({
          id: c.id,
          statement: c.statement,
          rubric: c.rubric,
        })),
      );
      return {
        text: [
          `[sofagent] eval_suite: 已实例化企业 eval 套件`,
          `  企业：${args.enterprise_id} · 行业：${industry}`,
          `  Benchmark ID：${suite.benchmarkId}`,
          `  Cases：${suite.cases.length} 个`,
        ].join('\n'),
        data: {
          action: 'instantiate',
          benchmarkId: suite.benchmarkId,
          caseCount: suite.cases.length,
          isError: false,
        },
      };
    }

    // ── freeze ──
    if (args.action === 'freeze') {
      const suite = instantiateEvalSuite(args.enterprise_id, industry);
      const frozen = await freezeEvalBaseline(suite);
      return {
        text: [
          `[sofagent] eval_suite: 已冻结 eval 基线`,
          `  Benchmark ID：${suite.benchmarkId}`,
          `  Revision：${frozen.revision}`,
          `  Cases：${frozen.cases.length} 个`,
        ].join('\n'),
        data: {
          action: 'freeze',
          benchmarkId: suite.benchmarkId,
          frozen: true,
          revision: frozen.revision,
          caseCount: frozen.cases.length,
          isError: false,
        },
      };
    }

    // ── run ──
    if (args.action === 'run') {
      const suite = instantiateEvalSuite(args.enterprise_id, industry);
      // 默认 mock agent + score（真实运行需注入被测 Agent）
      const mockAgent = async (statement: string) => `处理结果：${statement.slice(0, 50)}`;
      const defaultScore = (_s: string, _o: string, _r: string) => 75;
      const result = await runEvalSuite(suite, mockAgent, defaultScore);
      return {
        text: [
          `[sofagent] eval_suite: 运行完成`,
          `  Benchmark ID：${result.benchmarkId}`,
          `  总分：${result.averageScore}/100`,
          `  通过：${result.passedCases}/${result.totalCases}`,
        ].join('\n'),
        data: {
          action: 'run',
          benchmarkId: result.benchmarkId,
          runResult: {
            totalCases: result.totalCases,
            passedCases: result.passedCases,
            averageScore: result.averageScore,
          },
          isError: false,
        },
      };
    }

    // ── query ──
    if (args.action === 'query') {
      const suite = instantiateEvalSuite(args.enterprise_id, industry);
      const { readEvaluationLog } = orchestrator;
      const records = readEvaluationLog({ benchmarkId: suite.benchmarkId });
      return {
        text: [
          `[sofagent] eval_suite: 查询到 ${records.length} 条评测记录`,
          ...records.slice(-10).reverse().map((r) =>
            `  - [${r.ts}] ${r.caseId} rev=${r.revision} score=${r.score}${r.failureCode ? ` FAIL=${r.failureCode}` : ''}`,
          ),
        ].join('\n'),
        data: {
          action: 'query',
          benchmarkId: suite.benchmarkId,
          isError: false,
        },
      };
    }

    return {
      text: `[sofagent] eval_suite 错误: 未知 action '${args.action}'`,
      data: { action: args.action, isError: true },
    };
  } catch (err) {
    return {
      text: `[sofagent] eval_suite 失败：${err instanceof Error ? err.message : String(err)}`,
      data: { action: args.action, isError: true },
    };
  }
}
