// ============================================================
// evaluate.ts · MCP tool：Benchmark 评测（v1.3.4 交付 9）
// ============================================================
//
// 触发评测 + 查结果：
//   evaluate({ benchmark_id, case_id, query? })
//     → 触发隔离评测（强制 read-only Test Agent）→ 写 evaluation-log.jsonl（HMAC 链）
//   evaluate({ benchmark_id, query: true })
//     → 查询该 benchmark 的评测日志
//
// 复用 @sofagent/orchestrator 的 benchmark 三件：
//   benchmark-designer（题库布局）/ case-evaluator（隔离评测）/
//   evaluation-log（HMAC 链日志）
// 动态 import——workspace symlink 解析，不新增包依赖。
// ============================================================

// 测试注入：MCP 单测不调真实被测 Agent——经 setEvaluateTestAgent 注入 fake agentFn
let _testAgent:
  | ((ctx: { workspace: string; statement: string }) => Promise<string>)
  | null = null;

/**
 * 测试用被测 Agent 注入（MCP 单测隔离）。
 * @param agent fake agent（返回产出文本；null 恢复默认）
 */
export function setEvaluateTestAgent(
  agent: ((ctx: { workspace: string; statement: string }) => Promise<string>) | null,
): void {
  _testAgent = agent;
}

// ============================================================
// 类型定义
// ============================================================

export interface EvaluateArgs {
  /** Benchmark ID（必填） */
  benchmark_id: string;
  /** Case ID（触发单 case 评测；缺省 = 评测全部 cases） */
  case_id?: string;
  /** 查询模式（true = 只查日志不触发新评测） */
  query?: boolean;
}

export interface EvaluateResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    mode: 'run' | 'query';
    benchmarkId: string;
    evaluations?: Array<{
      caseId: string;
      score: number;
      failureCode: string | null;
      durationMs: number;
    }>;
    records?: Array<{
      ts: string;
      caseId: string;
      revision: number;
      score: number;
      failureCode: string | null;
    }>;
    isError: boolean;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 触发 Benchmark 评测（非 query）或查询评测日志（query）。
 *
 * @param args 参数
 * @returns 结构化结果（text + data）
 */
export async function evaluate(args: EvaluateArgs): Promise<EvaluateResult> {
  if (!args.benchmark_id) {
    return {
      text: '[sofagent] evaluate 错误: benchmark_id 必填',
      data: { mode: 'query', benchmarkId: '', isError: true },
    };
  }

  // ── 查询模式 ──
  if (args.query === true) {
    try {
      const { readEvaluationLog } = await import('@sofagent/orchestrator');
      const records = readEvaluationLog({ benchmarkId: args.benchmark_id });
      const lines = [`[sofagent] benchmark "${args.benchmark_id}" 评测记录共 ${records.length} 条:`];
      for (const r of records.slice(-20).reverse()) {
        lines.push(`  - [${r.ts}] ${r.caseId} rev=${r.revision} score=${r.score}${r.failureCode ? ` FAIL=${r.failureCode}` : ''}`);
      }
      return {
        text: lines.join('\n'),
        data: {
          mode: 'query',
          benchmarkId: args.benchmark_id,
          records: records.slice(-20).reverse().map((r) => ({
            ts: r.ts,
            caseId: r.caseId,
            revision: r.revision,
            score: r.score,
            failureCode: r.failureCode,
          })),
          isError: false,
        },
      };
    } catch (err) {
      return {
        text: `[sofagent] evaluate 查询失败：${err instanceof Error ? err.message : String(err)}`,
        data: { mode: 'query', benchmarkId: args.benchmark_id, isError: true },
      };
    }
  }

  // ── 触发模式 ──
  try {
    const { readBenchmarkLayout, benchmarksRoot, evaluateCase, appendEvaluationRecord } = await import('@sofagent/orchestrator');
    const { loadEnvConfig } = await import('@sofagent/core');
    const root = benchmarksRoot(loadEnvConfig().dataDir);
    const def = readBenchmarkLayout(root, args.benchmark_id);
    if (!def) {
      return {
        text: `[sofagent] benchmark "${args.benchmark_id}" 不存在（先建题库布局）`,
        data: { mode: 'run', benchmarkId: args.benchmark_id, isError: true },
      };
    }

    // 确定待评测 cases（单 case 或全部）
    const cases = args.case_id ? def.cases.filter((c) => c.id === args.case_id) : def.cases;
    if (cases.length === 0) {
      return {
        text: `[sofagent] benchmark "${args.benchmark_id}" 无匹配 case（case_id=${args.case_id ?? '全部'}）`,
        data: { mode: 'run', benchmarkId: args.benchmark_id, isError: true },
      };
    }

    const evaluations = [];
    for (const c of cases) {
      const result = await evaluateCase({
        benchmarkId: def.id,
        caseId: c.id,
        statement: c.statement,
        rubric: c.rubric,
        expectedRevision: def.revision,
        actualRevision: def.revision,
        ...(_testAgent ? { agentFn: _testAgent as never } : {}),
      });
      // 写 evaluation-log.jsonl（HMAC 链）
      appendEvaluationRecord({
        benchmarkId: def.id,
        caseId: c.id,
        revision: result.revision,
        score: result.score,
        failureCode: result.failureCode,
        durationMs: result.durationMs,
      });
      evaluations.push({
        caseId: c.id,
        score: result.score,
        failureCode: result.failureCode,
        durationMs: result.durationMs,
      });
    }

    const lines = [`[sofagent] benchmark "${def.id}" 评测完成（revision=${def.revision}，${evaluations.length} 个 case）:`];
    for (const e of evaluations) {
      lines.push(`  - ${e.caseId}: score=${e.score}/100${e.failureCode ? ` FAIL=${e.failureCode}` : ''}`);
    }

    return {
      text: lines.join('\n'),
      data: { mode: 'run', benchmarkId: def.id, evaluations, isError: false },
    };
  } catch (err) {
    return {
      text: `[sofagent] evaluate 触发失败：${err instanceof Error ? err.message : String(err)}`,
      data: { mode: 'run', benchmarkId: args.benchmark_id, isError: true },
    };
  }
}
