// ============================================================
// mlflow-exporter.ts · Benchmark 评测结果 MLflow tracking 集成
// v1.4.2（六）：多维标准化评估——自定义单一分数 → MLflow 标准指标
//
// 设计约束：
// - 零新依赖：MLflow REST API（fetch，Node 18+ 原生）直连 tracking server，
//   MLFLOW_TRACKING_URI 环境变量指定（缺省 http://127.0.0.1:5000）
// - 离线容错：tracking server 不可达时返回 structured degraded 结果（不崩——
//   Benchmark 本地评测照常，MLflow 是附加通道）
// - 指标映射：≥10 个标准指标（sofagent 审计/工作明细数据 → MLflow 标准指标）
// - LLM-as-Judge：主观维度（回答质量/方案合理性）经可注入 judge 函数评分
// ============================================================

import type { CaseEvaluation } from './case-evaluator';

// ── 配置 ──────────────────────────────────────────────────

export interface MlflowConfig {
  /** tracking server URI（缺省 MLFLOW_TRACKING_URI 或 http://127.0.0.1:5000） */
  trackingUri?: string;
  /** 实验名（缺省 sofagent-benchmark） */
  experimentName?: string;
  /** fetch 实现（测试注入 stub 用；缺省全局 fetch） */
  fetchImpl?: typeof fetch;
}

// ── 指标映射（验收：≥10 个标准指标）───────────────────────

/** 单条 benchmark 评测的指标全集 */
export interface MlflowMetrics {
  // ── 评测核心 ──
  /** case 得分（0..100） */
  score: number;
  /** 是否通过（score ≥ 60） */
  passed: number;
  /** 评测耗时（ms） */
  duration_ms: number;
  // ── 审计维度（sofagent 审计数据 → MLflow）──
  /** 工具调用数（审计日志工具调用计数） */
  tool_call_count: number;
  /** 审计 PASS 规则数 */
  audit_pass_count: number;
  /** 审计 FAIL 规则数 */
  audit_fail_count: number;
  /** 审计 WARN 规则数 */
  audit_warn_count: number;
  /** 审计通过率（PASS / 全部） */
  audit_pass_rate: number;
  // ── 成本维度（LLM trace → MLflow）──
  /** LLM 调用次数 */
  llm_call_count: number;
  /** 输入 token 合计 */
  token_input_total: number;
  /** 输出 token 合计 */
  token_output_total: number;
  /** 模型调用耗时合计（ms） */
  model_call_duration_ms_total: number;
  // ── 质量维度 ──
  /** LLM-as-Judge 主观分（0..100，无 judge 时 -1 占位） */
  judge_score: number;
}

/**
 * 从 CaseEvaluation + 审计/轨迹附注构造标准指标（≥10 项映射的核心）。
 * 附注缺省全零——「无数据」与「零值」如实区分由调用方负责。
 */
export function buildMetrics(
  evaluation: CaseEvaluation,
  extras: {
    toolCallCount?: number;
    auditPassCount?: number;
    auditFailCount?: number;
    auditWarnCount?: number;
    llmCallCount?: number;
    tokenInput?: number;
    tokenOutput?: number;
    modelCallDurationMs?: number;
    judgeScore?: number;
  } = {},
): MlflowMetrics {
  const auditTotal =
    (extras.auditPassCount ?? 0) + (extras.auditFailCount ?? 0) + (extras.auditWarnCount ?? 0);
  return {
    score: evaluation.score,
    passed: evaluation.score >= 60 ? 1 : 0,
    duration_ms: evaluation.durationMs,
    tool_call_count: extras.toolCallCount ?? 0,
    audit_pass_count: extras.auditPassCount ?? 0,
    audit_fail_count: extras.auditFailCount ?? 0,
    audit_warn_count: extras.auditWarnCount ?? 0,
    audit_pass_rate: auditTotal > 0 ? round4((extras.auditPassCount ?? 0) / auditTotal) : 0,
    llm_call_count: extras.llmCallCount ?? 0,
    token_input_total: extras.tokenInput ?? 0,
    token_output_total: extras.tokenOutput ?? 0,
    model_call_duration_ms_total: extras.modelCallDurationMs ?? 0,
    judge_score: extras.judgeScore ?? -1,
  };
}

// ── LLM-as-Judge（主观维度评分）────────────────────────────

/** LLM-as-Judge 的输入 */
export interface JudgeInput {
  /** 被测 Agent 的输出 */
  output: string;
  /** 私有评分标准（rubric——与被测 Agent 隔离） */
  rubric: string;
  /** 主观维度：回答质量 / 方案合理性 */
  dimension: 'answer_quality' | 'solution_soundness';
  /** 任务描述（statement） */
  statement?: string;
}

/** Judge 评决 */
export interface JudgeVerdict {
  /** 0..100 */
  score: number;
  /** 评分理由（可审计——与 Benchmark rubric 私有性一致，judge 输出落 evaluation log） */
  rationale: string;
}

/**
 * LLM-as-Judge：对 Benchmark case 的主观维度用 LLM 评分。
 * judgeFn 由调用方注入（生产接模型路由；测试接 stub）——本函数负责
 * prompt 构造 + 输出解析 + 分数钳位。
 */
export async function llmAsJudge(
  input: JudgeInput,
  judgeFn: (prompt: string) => Promise<string>,
): Promise<JudgeVerdict> {
  const prompt = [
    '你是 Benchmark 评审（LLM-as-Judge）。对被测 Agent 的输出按评分标准打分。',
    '',
    `## 评分维度：${input.dimension === 'answer_quality' ? '回答质量' : '方案合理性'}`,
    input.statement ? `## 任务描述\n${input.statement}` : '',
    `## 评分标准（私有，被测 Agent 不可见）\n${input.rubric}`,
    `## 被测输出\n${input.output}`,
    '',
    '输出格式（严格遵守）：',
    'SCORE: <0-100 整数>',
    'RATIONALE: <一句话理由>',
  ].filter(Boolean).join('\n');

  const raw = await judgeFn(prompt);
  const scoreMatch = /SCORE:\s*(\d+)/.exec(raw);
  const rationaleMatch = /RATIONALE:\s*(.+)/.exec(raw);
  const score = scoreMatch ? Number(scoreMatch[1]) : 0;
  return {
    score: Math.max(0, Math.min(100, score)),
    rationale: (rationaleMatch?.[1] ?? '').trim() || '(judge 未给出理由)',
  };
}

// ── MLflow REST 客户端（零依赖直连）───────────────────────

export interface MlflowRunResult {
  /** 是否成功写入 MLflow */
  ok: boolean;
  /** run ID（成功时） */
  runId?: string;
  /** 失败/降级原因 */
  error?: string;
  /** 写入的指标（审计留痕） */
  metrics: MlflowMetrics;
}

/**
 * 把一条 Benchmark 评测结果写 MLflow tracking（创建 experiment + run + log_batch metrics）。
 * server 不可达时降级返回 ok=false——本地评测结果不丢（evaluation-log 仍是主存储）。
 */
export async function logBenchmarkToMlflow(params: {
  evaluation: CaseEvaluation;
  benchmarkId: string;
  caseId: string;
  metrics: MlflowMetrics;
  config?: MlflowConfig;
}): Promise<MlflowRunResult> {
  const { evaluation, benchmarkId, caseId, metrics } = params;
  const config = params.config ?? {};
  const baseUri = (config.trackingUri ?? process.env.MLFLOW_TRACKING_URI ?? 'http://127.0.0.1:5000').replace(/\/$/, '');
  const experimentName = config.experimentName ?? 'sofagent-benchmark';
  const doFetch = config.fetchImpl ?? fetch;

  try {
    // 一、找/建 experiment
    let experimentId: string;
    const searchRes = await doFetch(
      `${baseUri}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(experimentName)}`,
      { method: 'GET' },
    );
    if (searchRes.ok) {
      const data = await searchRes.json() as { experiment?: { experiment_id?: string } };
      experimentId = data.experiment?.experiment_id ?? '';
    } else {
      // 不存在则创建
      const createRes = await doFetch(`${baseUri}/api/2.0/mlflow/experiments/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: experimentName }),
      });
      if (!createRes.ok) throw new Error(`experiment 创建失败: HTTP ${createRes.status}`);
      const data = await createRes.json() as { experiment_id?: string };
      experimentId = data.experiment_id ?? '';
    }

    // 二、创建 run
    const runRes = await doFetch(`${baseUri}/api/2.0/mlflow/runs/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experiment_id: experimentId,
        run_name: `${benchmarkId}/${caseId}`,
        tags: [
          { key: 'sofagent.benchmark_id', value: benchmarkId },
          { key: 'sofagent.case_id', value: caseId },
          { key: 'mlflow.runName', value: `${benchmarkId}/${caseId}` },
        ],
      }),
    });
    if (!runRes.ok) throw new Error(`run 创建失败: HTTP ${runRes.status}`);
    const runData = await runRes.json() as { run?: { info?: { run_id?: string } } };
    const runId = runData.run?.info?.run_id;
    if (!runId) throw new Error('run 创建响应缺 run_id');

    // 三、log-batch 写全部指标（MLflow UI 历史趋势与多维对比的数据面）
    const metricEntries = Object.entries(metrics).map(([key, value]) => ({
      key,
      value: Number(value),
      timestamp: Date.now(),
      step: 0,
    }));
    const logRes = await doFetch(`${baseUri}/api/2.0/mlflow/runs/log-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runId, metrics: metricEntries }),
    });
    if (!logRes.ok) throw new Error(`metrics 写入失败: HTTP ${logRes.status}`);

    void evaluation; // evaluation 细节经 metrics 扁平化进 MLflow（结构化留在 evaluation-log）
    return { ok: true, runId, metrics };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      metrics,
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
