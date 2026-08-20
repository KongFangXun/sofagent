// ============================================================
// worklog.test.ts · AI 工作明细数据层测试
// v1.3.9（三）：验收——按 Agent 明细 / 按 Workflow 聚合 /
// 周趋势 / 进化四维 / 落盘 worklog.json / 口径标注 /
// meta-harness 聚合数据消费（单 harness 单源消费）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorklogAggregator, isoWeekKey } from '../worklog/aggregator';

describe('isoWeekKey', () => {
  it('ISO 周编号（跨年/年初归上年末周）', () => {
    expect(isoWeekKey('2026-08-20T10:00:00Z')).toBe('2026-W34');
    expect(isoWeekKey('2026-01-01T00:00:00Z')).toBe('2026-W01');
    expect(isoWeekKey('2025-12-31T23:00:00Z')).toBe('2026-W01'); // 2025-12-31 属 2026 第 1 周
    expect(isoWeekKey('bad-ts')).toBe('unknown');
  });
});

describe('WorklogAggregator · 三源聚合', () => {
  let dataDir: string;
  let prevDataEnv: string | undefined;
  /** 动态时间戳：T0=上周（8 天前）、T1=近期（1 天前）——保证跨两个 ISO 周 + active 状态 */
  const T0 = new Date(Date.now() - 8 * 86400000).toISOString();
  const T1 = new Date(Date.now() - 1 * 86400000).toISOString();

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-worklog-'));
    // skillopt failure-ledger 的数据目录也走 SOFAGENT_DATA——一并隔离（防读到仓库真实 ledger）
    prevDataEnv = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = dataDir;
    const auditDir = path.join(dataDir, 'audit');
    const runtimeDir = path.join(auditDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });

    // ① audit history：两周审计记录（上周 1 PASS 1 FAIL，本周 2 PASS）
    const history = [
      { timestamp: T0, exitCode: 0, diffRange: 'HEAD~1..HEAD', ruleResults: [], diffFileCount: 1 },
      { timestamp: T0, exitCode: 2, diffRange: 'HEAD~1..HEAD', ruleResults: [], diffFileCount: 2 },
      { timestamp: T1, exitCode: 0, diffRange: 'HEAD~1..HEAD', ruleResults: [], diffFileCount: 1 },
      { timestamp: T1, exitCode: 0, diffRange: 'HEAD~1..HEAD', ruleResults: [], diffFileCount: 1 },
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');

    // ② decision-log：audit agent 两任务（一个 retry+escalate，一个干净）+ engineer 一任务
    const decisions = [
      { ts: T1, agentId: 'audit', sessionId: 'wf-12:node-a', kind: 'ARTIFACT_EDIT', category: 'select' },
      { ts: T1, agentId: 'audit', sessionId: 'wf-12:node-a', kind: 'ESCALATE_REPORT', category: 'escalate' },
      { ts: T1, agentId: 'audit', sessionId: 'wf-12:node-a', kind: 'ARTIFACT_EDIT', category: 'retry' },
      { ts: T1, agentId: 'audit', sessionId: 'wf-12:node-b', kind: 'ARTIFACT_EDIT', category: 'select' },
      { ts: T1, agentId: 'engineer', sessionId: 'wf-13:node-a', kind: 'ORCHESTRATION', category: 'route' },
    ];
    fs.writeFileSync(path.join(auditDir, 'decision-log.jsonl'), decisions.map((d) => JSON.stringify(d)).join('\n') + '\n');

    // ③ LLM trace：模型调用记录（durationMs + token；单价表内模型可估成本）
    const traces = [
      { ts: T1, agentId: 'audit', taskId: 'wf-12:node-a', model: 'deepseek-v4-flash', tokenInput: 1000, tokenOutput: 500, durationMs: 1200 },
      { ts: T1, agentId: 'audit', taskId: 'wf-12:node-a', model: 'deepseek-v4-flash', tokenInput: 2000, tokenOutput: 800, durationMs: 1800 },
      { ts: T1, agentId: 'audit', taskId: 'wf-12:node-b', model: 'unknown-model-x', tokenInput: 500, tokenOutput: 100, durationMs: 600 },
    ];
    fs.writeFileSync(path.join(runtimeDir, 'llm-calls.jsonl'), traces.map((t) => JSON.stringify(t)).join('\n') + '\n');
  });

  afterEach(() => {
    if (prevDataEnv === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevDataEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('按 Agent 工作明细：任务/token/耗时/成本齐全', () => {
    const agg = new WorklogAggregator({ dataDir });
    const agents = agg.aggregateByAgent('audit');
    expect(agents).toHaveLength(1);
    const a = agents[0]!;
    expect(a.agentId).toBe('audit');
    expect(a.tasks).toHaveLength(2); // wf-12:node-a + wf-12:node-b

    const nodeA = a.tasks.find((t) => t.taskId === 'wf-12:node-a')!;
    expect(nodeA.decisions).toBe(3);
    expect(nodeA.humanInterventions).toBe(1); // ESCALATE_REPORT
    expect(nodeA.retries).toBe(1);
    expect(nodeA.llmCalls).toBe(2);
    expect(nodeA.tokens).toEqual({ input: 3000, output: 1300 });
    expect(nodeA.modelCallMs).toBe(3000); // 口径①：模型调用耗时
    expect(nodeA.costUsd).not.toBeNull(); // deepseek-v4-flash 在单价表内
    // 汇总
    expect(a.totals.llmCalls).toBe(3);
    expect(a.totals.durationBasis).toBe('model-call-only'); // 无 nodeDurations 注入
  });

  it('nodeDurations 注入后节点总耗时口径生效（口径② 补采集）', () => {
    const agg = new WorklogAggregator({
      dataDir,
      nodeDurations: {
        'wf-12:node-a': { startedAt: T1, endedAt: new Date(Date.now() - 0.9 * 86400000).toISOString() }, // ~1.44M ms 后
      },
    });
    const a = agg.aggregateByAgent('audit')[0]!;
    const nodeA = a.tasks.find((t) => t.taskId === 'wf-12:node-a')!;
    expect(nodeA.nodeTotalMs).toBeGreaterThan(1_000_000); // 节点总耗时（含等待）
    expect(nodeA.modelCallMs).toBe(3000);                 // 模型调用耗时仍在
    expect(a.totals.durationBasis).toBe('node-total');    // 口径标注切换
    // 未注入的节点仍是 null
    const nodeB = a.tasks.find((t) => t.taskId === 'wf-12:node-b')!;
    expect(nodeB.nodeTotalMs).toBeNull();
  });

  it('按 Workflow 聚合：节点清单 + 人工介入记录', () => {
    const agg = new WorklogAggregator({ dataDir });
    const wfs = agg.aggregateByWorkflow();
    const wf12 = wfs.find((w) => w.workflowId === 'wf-12')!;
    expect(wf12.nodes.map((n) => n.taskId).sort()).toEqual(['wf-12:node-a', 'wf-12:node-b']);
    expect(wf12.humanInterventions).toBe(1);
    // 近期时间戳（1 天前）→ active（时间推断，不臆造）
    expect(wf12.nodes.every((n) => n.status === 'active')).toBe(true);
    // 其他 workflow
    expect(wfs.find((w) => w.workflowId === 'wf-13')).toBeDefined();
    // 过滤参数
    expect(agg.aggregateByWorkflow('wf-13')).toHaveLength(1);
  });

  it('周趋势：活跃度 / 审计成功率 / 成本', () => {
    const agg = new WorklogAggregator({ dataDir });
    const trend = agg.weeklyTrend();
    expect(trend.length).toBeGreaterThanOrEqual(2);
    const lastWeek = trend[trend.length - 1]!;
    // 本周（T1）：2 审计 PASS + 5 决策 + 3 LLM 调用 = 10 活跃
    expect(lastWeek.activity).toBe(10);
    expect(lastWeek.auditPassRate).toBe(1); // 2/2
    expect(lastWeek.costUsd).toBeGreaterThan(0);
    const prevWeek = trend[trend.length - 2]!;
    expect(prevWeek.auditPassRate).toBe(0.5); // 1/2
  });

  it('进化四维趋势：审计 PASS 率 / 错题复发率 / AB 曲线 / 首次通过率', () => {
    // 造 ab-test latest
    fs.mkdirSync(path.join(dataDir, 'ab-test'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'ab-test', 'latest.json'),
      JSON.stringify({ winner: 'candidate', consecutiveWins: 3, margin: 0.12 }));

    const agg = new WorklogAggregator({ dataDir });
    const evo = agg.evolutionTrends();
    // 一、审计 PASS 率：全量 3/4，按周 2 条
    expect(evo.auditPassRate.overall).toBe(0.75);
    expect(evo.auditPassRate.weekly).toHaveLength(2);
    // 二、错题复发率：隔离目录无 failure-ledger → null（不臆造）
    expect(evo.failureRecurrence.rate).toBeNull();
    // 三、AB 曲线：latest.json 读到
    expect(evo.abCurve).toEqual({ winner: 'candidate', consecutiveWins: 3, margin: 0.12 });
    // 四、首次通过率：3 任务中 node-a 有 retry/escalate → 2/3（round4 精度）
    expect(evo.firstPassRate.rate).toBeCloseTo(2 / 3, 4);
    expect(evo.firstPassRate.totalTasks).toBe(3);
  });

  it('聚合结果落盘 data/dashboard/worklog.json（v1.4.0 数据契约）', () => {
    const agg = new WorklogAggregator({ dataDir });
    const outPath = agg.writeWorklogJson();
    expect(outPath).toBe(path.join(dataDir, 'dashboard', 'worklog.json'));
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(payload.generatedAt).toBeTruthy();
    expect(payload.durationBasisNote).toContain('modelCallMs');
    expect(payload.durationBasisNote).toContain('nodeTotalMs'); // 口径标注清晰
    expect(payload.agents.length).toBe(2);
    expect(payload.workflows.length).toBe(2);
    expect(payload.weeklyTrend.length).toBeGreaterThanOrEqual(2);
    expect(payload.evolution.auditPassRate.overall).toBe(0.75);
  });

  it('query 数据面：agentId 过滤 + 周趋势/进化开关', () => {
    const agg = new WorklogAggregator({ dataDir });
    const r = agg.query({ agentId: 'engineer', weeklyTrend: true, evolution: true });
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.agentId).toBe('engineer');
    expect(r.weeklyTrend).toBeDefined();
    expect(r.evolution).toBeDefined();
    const minimal = agg.query({});
    expect(minimal.weeklyTrend).toBeUndefined();
    expect(minimal.evolution).toBeUndefined();
  });

  it('meta-harness 场景：注入 audit-aggregator 聚合数据（同一数据源两个消费面）', () => {
    const agg = new WorklogAggregator({
      dataDir,
      aggregateEntries: [
        { harnessId: 'meta-h-1', kind: 'decision', timestamp: T1, summary: '任务受理', agentId: 'audit' },
        { harnessId: 'meta-h-1', kind: 'tool_call', timestamp: T1, summary: 'reportDelivery' },
      ],
    });
    const agents = agg.aggregateByAgent();
    // 聚合轨迹的 agentId 归因进入 worklog（audit agent 已有痕迹被 touch）
    const audit = agents.find((a) => a.agentId === 'audit')!;
    expect(audit.tasks.some((t) => t.lastSeen >= T1)).toBe(true);
    // 无 agentId 的轨迹归到 harnessId 维度
    expect(agents.some((a) => a.agentId === 'meta-h-1')).toBe(true);
  });

  it('空数据目录不崩（各聚合返回空/零值）', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-worklog-empty-'));
    const prevEnv = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = emptyDir;
    try {
      const agg = new WorklogAggregator({ dataDir: emptyDir });
      expect(agg.aggregateByAgent()).toEqual([]);
      expect(agg.aggregateByWorkflow()).toEqual([]);
      expect(agg.weeklyTrend()).toEqual([]);
      expect(agg.evolutionTrends().auditPassRate.overall).toBeNull();
      expect(agg.evolutionTrends().firstPassRate.rate).toBeNull();
      const p = agg.writeWorklogJson();
      expect(fs.existsSync(p)).toBe(true);
    } finally {
      process.env.SOFAGENT_DATA = prevEnv;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('损坏 JSONL 行跳过不崩（daemon 并发写残行容错）', () => {
    const p = path.join(dataDir, 'audit', 'decision-log.jsonl');
    fs.appendFileSync(p, '{"broken": tru\n'); // 半行
    const agg = new WorklogAggregator({ dataDir });
    expect(agg.aggregateByAgent('audit')[0]!.tasks.length).toBeGreaterThanOrEqual(2); // 正常行仍可用
  });
});
