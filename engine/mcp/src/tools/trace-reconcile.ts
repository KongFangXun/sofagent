// ============================================================
// trace-reconcile.ts · MCP tool：trace_reconcile（v1.5.3 章八）
// ============================================================
//
// 跨层证据对账执行入口——三源比对：
//   trace 自述（DSH session 统一模型）vs git diff 实际变更集
//   vs task/logs 声明集 → 差异清单（一致/漏报/幻觉/瞒报四态）。
//
// 模型层回溯：llm-calls 推理记录 → 模型版本 → train_job → datasetHash
// （fingerprint HMAC 验签状态透出）。
//
// 对账结果入 decision-log（kind=COVERAGE——v1.5.0 章八新 DecisionKind）。
// 依赖 @sofagent/core trace-reconcile 出口（对账引擎本体在 core）。
// ============================================================

import {
  loadDshSessionsCached,
  reconcileTraces,
  buildModelLayerTrace,
  readLlmCallTrace,
  parseDiffWithIsomorphicGit,
  getDataDir,
  type ReconcileReport,
  type ModelLayerTraceLink,
} from '@sofagent/core';

export interface TraceReconcileArgs {
  /** 仓库根（git diff 采集目标；缺省 process.cwd()） */
  repo_root?: string;
  /** 是否输出模型层回溯链（llm-calls → train fingerprint） */
  include_model_layer?: boolean;
  /** DSH session 扫描上限（缺省 50） */
  session_limit?: number;
}

export interface TraceReconcileToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    report?: ReconcileReport;
    /** 模型层回溯链（include_model_layer=true 时返回） */
    modelLayer?: ModelLayerTraceLink[];
    decisionLogged: boolean;
  };
}

/**
 * trace_reconcile——对账执行 + 差异清单查询。
 */
export async function traceReconcileTool(args: TraceReconcileArgs): Promise<TraceReconcileToolResult> {
  try {
    const repoRoot = args.repo_root ?? process.cwd();
    const dataDir = getDataDir();

    // 1. trace 源：DSH sessions（mtime 缓存——cwd 对齐仓库根）
    const traces = loadDshSessionsCached({
      dataDir,
      cwdFilter: repoRoot,
      limit: args.session_limit ?? 50,
    });

    // 2. git diff 独立事实源（isomorphic-git——无原生 git 依赖）
    const diffFiles = await parseDiffWithIsomorphicGit(repoRoot);
    const changed = diffFiles
      .filter((f) => f.status === 'modified' || f.status === 'added')
      .map((f) => f.path);
    const deleted = diffFiles
      .filter((f) => f.status === 'deleted')
      .map((f) => f.path);

    // 3. 对账（declared 面缺省不采——task/logs 声明集格式各异，
    //    显式接入时经 ReconcileInput 传入）
    const report = reconcileTraces({
      traces,
      diffFiles: changed,
      deletedFiles: deleted,
      repoRoot,
    });

    // 4. 模型层回溯（可选）
    let modelLayer: ModelLayerTraceLink[] | undefined;
    if (args.include_model_layer) {
      const llmCalls = readLlmCallTrace()
        .slice(-50)
        .map((r) => ({ ts: r.ts, provider: r.provider, model: r.model }));
      // train fingerprint 由调用方组装（core 不依赖 train 包）——
      // 无训练链路时空数组（回溯链只到模型版本层）
      modelLayer = buildModelLayerTrace(llmCalls, []);
    }

    // 5. decision-log（kind=COVERAGE）——对账结果入审计面
    let decisionLogged = false;
    try {
      const audit = await import('@sofagent/audit');
      if (typeof audit.emitDecision === 'function') {
        audit.emitDecision(
          {
            agentId: 'sofagent-trace-reconcile',
            sessionId: `trace-reconcile-${new Date().toISOString().slice(0, 10)}`,
            kind: 'COVERAGE',
            moment: 'ATTRIBUTION',
            why: `trace 对账：${traces.length} session vs ${changed.length} diff 文件——一致率 ${report.consistencyRate}，差异 ${report.discrepancies.length} 项`,
            evidence: [
              `sessions=${traces.length}`,
              `diffFiles=${changed.length}`,
              `discrepancies=${report.discrepancies.length}`,
              ...report.discrepancies.slice(0, 5).map((d) => `${d.verdict}: ${d.path}`),
            ],
          },
          dataDir,
        );
        decisionLogged = true;
      }
    } catch (err) {
      console.warn(`[sofagent] trace_reconcile decision-log 写入失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. 文本摘要
    const lines = [
      `[sofagent] trace 对账完成（${repoRoot}）`,
      `  · DSH sessions：${traces.length} 个（cwd 对齐）`,
      `  · trace 写集：${report.traceWriteSet.length} 文件；git diff 变更：${report.diffSet.length} 文件`,
      `  · 一致率：${(report.consistencyRate * 100).toFixed(1)}%`,
    ];
    if (report.discrepancies.length > 0) {
      lines.push(`  · 差异清单（${report.discrepancies.length} 项）：`);
      for (const d of report.discrepancies.slice(0, 10)) {
        const label = { omitted: '漏报', hallucinated: '幻觉动作', misreported: '瞒报', consistent: '一致' }[d.verdict];
        lines.push(`    - [${label}] ${d.path}——${d.evidence}`);
      }
      if (report.discrepancies.length > 10) lines.push(`    … 等 ${report.discrepancies.length} 项`);
    } else {
      lines.push('  · 差异清单：无（三源一致 ✅）');
    }
    if (modelLayer) {
      lines.push(`  · 模型层回溯：${modelLayer.length} 条推理记录（最新：${modelLayer[modelLayer.length - 1]?.model ?? '—'}）`);
    }
    if (decisionLogged) {
      lines.push('  · 对账结果已入 decision-log（kind=COVERAGE）');
    }

    return {
      text: lines.join('\n'),
      data: { isError: false, ok: true, report, modelLayer, decisionLogged },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] trace_reconcile 异常：${msg}`,
      data: { isError: true, ok: false, decisionLogged: false },
    };
  }
}
