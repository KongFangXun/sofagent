// ============================================================
// mlflow-exporter.test.ts · MLflow 集成测试（fetch 全 stub，零联网）
// v1.3.9（六）：验收——指标映射 ≥10 / LLM-as-Judge / tracking 写入 / 降级容错
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildMetrics, llmAsJudge, logBenchmarkToMlflow } from '../benchmark/mlflow-exporter';
import type { CaseEvaluation } from '../benchmark/case-evaluator';

function makeEvaluation(score: number, durationMs = 1200): CaseEvaluation {
  return {
    benchmarkId: 'bench-001',
    caseId: 'CASE-001-smoke',
    revision: 1,
    score,
    failureCode: null,
    details: ['ok'],
    workspace: '/tmp/iso-ws',
    durationMs,
  };
}

describe('buildMetrics · 标准指标映射', () => {
  it('映射 ≥10 个标准指标（验收下限）', () => {
    const m = buildMetrics(makeEvaluation(85), {
      toolCallCount: 12, auditPassCount: 20, auditFailCount: 2, auditWarnCount: 3,
      llmCallCount: 5, tokenInput: 8000, tokenOutput: 2000, modelCallDurationMs: 9500,
      judgeScore: 78,
    });
    const keys = Object.keys(m);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    // 关键指标语义抽查
    expect(m.score).toBe(85);
    expect(m.passed).toBe(1); // ≥60
    expect(m.tool_call_count).toBe(12);
    expect(m.audit_pass_rate).toBe(0.8); // 20/25
    expect(m.token_input_total).toBe(8000);
    expect(m.judge_score).toBe(78);
  });

  it('未过线分数 passed=0；无附注时零值占位', () => {
    const m = buildMetrics(makeEvaluation(40));
    expect(m.passed).toBe(0);
    expect(m.tool_call_count).toBe(0);
    expect(m.audit_pass_rate).toBe(0);
    expect(m.judge_score).toBe(-1); // 无 judge 占位
  });
});

describe('llmAsJudge · 主观维度评分', () => {
  it('回答质量维度：prompt 含 rubric 与输出格式约束，解析分数与理由', async () => {
    const prompts: string[] = [];
    const verdict = await llmAsJudge(
      { output: '答案是 42，推导如下…', rubric: '需给出推导过程与最终数值', dimension: 'answer_quality', statement: '计算 x' },
      async (prompt) => {
        prompts.push(prompt);
        return 'SCORE: 82\nRATIONALE: 推导完整且结论正确';
      },
    );
    expect(prompts[0]).toContain('回答质量');
    expect(prompts[0]).toContain('需给出推导过程与最终数值'); // rubric 进 prompt
    expect(prompts[0]).toContain('SCORE:'); // 输出格式约束
    expect(verdict.score).toBe(82);
    expect(verdict.rationale).toContain('推导完整');
  });

  it('方案合理性维度 + 分数钳位（越界钳到 0..100）与坏输出兜底', async () => {
    const over = await llmAsJudge(
      { output: 'x', rubric: 'r', dimension: 'solution_soundness' },
      async () => 'SCORE: 150\nRATIONALE: 越界',
    );
    expect(over.score).toBe(100);
    const bad = await llmAsJudge(
      { output: 'x', rubric: 'r', dimension: 'answer_quality' },
      async () => '完全不合格式的输出',
    );
    expect(bad.score).toBe(0);
    expect(bad.rationale).toContain('judge 未给出理由');
  });
});

describe('logBenchmarkToMlflow · tracking 写入（fetch stub）', () => {
  /** 构造多段 fetch stub：experiment 查找→建 run→写 metrics */
  function makeFetchStub(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
    let call = 0;
    const calls: Array<{ url: string; body?: unknown }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = responses[Math.min(call, responses.length - 1)]!;
      call++;
      return {
        ok: r.ok,
        status: r.status ?? 200,
        json: async () => r.body,
      } as Response;
    }) as typeof fetch;
    return { impl, calls };
  }

  it('experiment 已存在 → 建 run → log-batch 全量指标', async () => {
    const { impl, calls } = makeFetchStub([
      { ok: true, body: { experiment: { experiment_id: 'exp-7' } } },
      { ok: true, body: { run: { info: { run_id: 'run-42' } } } },
      { ok: true, body: {} },
    ]);
    const metrics = buildMetrics(makeEvaluation(90), { toolCallCount: 3, judgeScore: 88 });
    const result = await logBenchmarkToMlflow({
      evaluation: makeEvaluation(90),
      benchmarkId: 'bench-001',
      caseId: 'CASE-001-smoke',
      metrics,
      config: { trackingUri: 'http://mlflow.test', fetchImpl: impl },
    });
    expect(result.ok).toBe(true);
    expect(result.runId).toBe('run-42');
    // 三次调用：get-by-name → runs/create → log-batch
    expect(calls[0]?.url).toContain('/experiments/get-by-name');
    expect(calls[1]?.url).toContain('/runs/create');
    expect((calls[1]?.body as { tags?: Array<{ key: string }> }).tags)
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: 'sofagent.benchmark_id' })]));
    expect(calls[2]?.url).toContain('/runs/log-batch');
    const logged = (calls[2]?.body as { metrics: Array<{ key: string; value: number }> }).metrics;
    expect(logged.length).toBeGreaterThanOrEqual(10); // 全量指标进 MLflow
    expect(logged.some((m) => m.key === 'judge_score' && m.value === 88)).toBe(true);
  });

  it('experiment 不存在 → 自动创建', async () => {
    const { impl, calls } = makeFetchStub([
      { ok: false, status: 404, body: {} },
      { ok: true, body: { experiment_id: 'exp-new' } },
      { ok: true, body: { run: { info: { run_id: 'run-9' } } } },
      { ok: true, body: {} },
    ]);
    const result = await logBenchmarkToMlflow({
      evaluation: makeEvaluation(70),
      benchmarkId: 'b', caseId: 'c',
      metrics: buildMetrics(makeEvaluation(70)),
      config: { fetchImpl: impl },
    });
    expect(result.ok).toBe(true);
    expect(calls[1]?.url).toContain('/experiments/create');
  });

  it('tracking server 不可达 → 降级 ok=false 不抛（本地评测不丢）', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const result = await logBenchmarkToMlflow({
      evaluation: makeEvaluation(70),
      benchmarkId: 'b', caseId: 'c',
      metrics: buildMetrics(makeEvaluation(70)),
      config: { fetchImpl: impl },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.metrics.score).toBe(70); // 指标仍带回（审计留痕）
  });
});
