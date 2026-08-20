// ============================================================
// aggregator.ts · AI 工作明细数据层（worklog）
// v1.3.9（三）：业务视角的「AI 节点这周干了什么」——零新数据，
// 聚合既有三源 + 可选注入。本版只做数据罗列层（Web 工作明细页归 v1.4.0）
//
// 数据源口径盘点（2026-08-20 实测，开发日志同步标注）：
// ① audit history.jsonl——审计级：timestamp/exitCode/ruleResults，无 duration
//    → 消费面：审计 PASS 率趋势（按周）
// ② decision-log.jsonl——决策级：ts/agentId/sessionId/kind/category
//    → 消费面：任务明细、首次通过率（category=retry/escalate）、人工介入（ESCALATE_REPORT）
// ③ LLM trace llm-calls.jsonl——模型调用级：ts/agentId/taskId/tokenInput/
//    tokenOutput/durationMs（HMAC 链）
//    → 消费面：模型调用耗时、token、成本估算
// ④ failure-ledger.jsonl（skillopt）——错题复发率
// ⑤ ab-test latest.json——AB 胜负（曲线历史有限，latest + 旧 ab-history.jsonl 兼容读）
//
// 节点耗时口径（如实标注，两种）：
// - modelCallMs：LLM 调用耗时合计（现有日志直接可得——复用）
// - nodeTotalMs：节点总耗时（含工具执行+等待+重试）——现有日志【不落盘】，
//   trajectory.ts 有任务级 startTime/endTime 但仅在运行时对象上。
//   本层经 nodeDurations 注入接口补采集（DSH 后端启用时事件流天然含节点留痕）
// ============================================================

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AuditHistoryEntry } from '@sofagent/audit';
import type { LlmCallRecord } from '@sofagent/core';

// ── 类型定义 ──────────────────────────────────────────────

/** 单个任务的 worklog 明细 */
export interface TaskWorklogEntry {
  /** 任务 ID（decision-log sessionId 或 LLM trace taskId） */
  taskId: string;
  /** 归属 workflow（taskId 冒号前缀，如 "wf-12:node-a" → "wf-12"；无前缀则同 taskId） */
  workflowId: string;
  /** 决策条数 */
  decisions: number;
  /** 人工介入（ESCALATE_REPORT / category=escalate）次数 */
  humanInterventions: number;
  /** retry 决策次数（首次通过率分母信号） */
  retries: number;
  /** LLM 调用次数 */
  llmCalls: number;
  /** token 用量 */
  tokens: { input: number; output: number };
  /** 模型调用耗时合计（ms）——口径① */
  modelCallMs: number;
  /** 节点总耗时（ms）——口径②（nodeDurations 注入才有，否则 null） */
  nodeTotalMs: number | null;
  /** 成本估算（USD；模型单价未知时 null） */
  costUsd: number | null;
  /** 首次时间（三源里该任务最早 ts） */
  firstSeen: string;
  /** 最后时间 */
  lastSeen: string;
}

/** 按 Agent 聚合的工作明细 */
export interface AgentWorklog {
  agentId: string;
  /** 该 agent 的任务明细 */
  tasks: TaskWorklogEntry[];
  /** 汇总 */
  totals: {
    tasks: number;
    llmCalls: number;
    tokens: { input: number; output: number };
    modelCallMs: number;
    /** 口径标注：node-total（注入了节点耗时）| model-call-only（只有模型调用口径） */
    durationBasis: 'node-total' | 'model-call-only';
    costUsd: number | null;
    humanInterventions: number;
  };
}

/** 按 Workflow 聚合 */
export interface WorkflowWorklog {
  workflowId: string;
  /** 节点（任务）清单 */
  nodes: Array<{ taskId: string; status: 'active' | 'done' | 'unknown'; humanInterventions: number }>;
  humanInterventions: number;
}

/** 周趋势 */
export interface WeekTrend {
  /** ISO 周（YYYY-Www） */
  week: string;
  /** 活跃度：该周事件数（审计+决策+LLM 调用） */
  activity: number;
  /** 审计成功率（exitCode=0 占比，无审计记录为 null） */
  auditPassRate: number | null;
  /** 该周 LLM 成本估算（USD，未知单价记 0） */
  costUsd: number;
}

/** 进化四维趋势 */
export interface EvolutionTrends {
  /** 审计 PASS 率（全量 + 按周） */
  auditPassRate: { overall: number | null; weekly: Array<{ week: string; rate: number | null }> };
  /** 错题复发率（failure-ledger 重复 ≥threshold 的模式占比） */
  failureRecurrence: { repeatedPatterns: number; totalPatterns: number; rate: number | null };
  /** AB 胜负曲线（有记录时） */
  abCurve: { winner: string; consecutiveWins: number; margin: number } | null;
  /** 首次通过率（无 retry/escalate 的任务占比） */
  firstPassRate: { rate: number | null; retriedTasks: number; totalTasks: number };
}

/** 聚合选项 */
export interface WorklogOptions {
  /** 数据目录（缺省 data/，SOFAGENT_DATA 惯例） */
  dataDir?: string;
  /**
   * 节点耗时注入（补采集口径②）——taskId → { startedAt, endedAt }。
   * 来自 trajectory（任务级 startTime/endTime）或 DSH 事件流。
   */
  nodeDurations?: Record<string, { startedAt: string; endedAt: string }>;
  /**
   * meta-harness 场景：注入 audit-aggregator 导出的聚合轨迹（exportAll()）。
   * 单 harness 场景不注入——直接消费单源审计日志。
   */
  aggregateEntries?: Array<{ harnessId: string; kind: string; timestamp: string; summary: string; agentId?: string }>;
}

// ── 成本估算（极简单价表，USD / 1M tokens；未收录模型返回 null）──

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.07, output: 0.28 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'glm-5.2': { input: 0.5, output: 1.5 },
  'glm-4-flash': { input: 0, output: 0 },
};

function estimateCostUsd(model: string | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!model) return null;
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

// ── 周工具 ────────────────────────────────────────────────

/** ISO 周键（YYYY-Www）——跨年按 ISO 8601 周编号 */
export function isoWeekKey(tsIso: string): string {
  const d = new Date(tsIso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // 周一=0
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // 本周四
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** JSONL 安全读行（损坏行跳过——daemon 并发写可能产生残行） */
function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
      .filter((x) => x !== null);
  } catch {
    return [];
  }
}

// ── 聚合器本体 ────────────────────────────────────────────

/**
 * worklog 聚合器——三源合并，按 Agent / Workflow / 周聚合。
 * 用法：
 *   const agg = new WorklogAggregator({ dataDir });
 *   agg.aggregateByAgent('audit');
 *   agg.writeWorklogJson();  // 落盘 data/dashboard/worklog.json
 */
export class WorklogAggregator {
  private readonly dataDir: string;
  private readonly nodeDurations: WorklogOptions['nodeDurations'];
  private readonly aggregateEntries: WorklogOptions['aggregateEntries'];

  constructor(options: WorklogOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.SOFAGENT_DATA ?? 'data';
    this.nodeDurations = options.nodeDurations;
    this.aggregateEntries = options.aggregateEntries;
  }

  // ── 数据源读取（懒读 + 失败容错）──

  private readAuditHistory(): AuditHistoryEntry[] {
    return readJsonl<AuditHistoryEntry>(join(this.dataDir, 'audit', 'history.jsonl'));
  }

  private readDecisionLog(): DecisionEntryShape[] {
    return readJsonl<DecisionEntryShape>(join(this.dataDir, 'audit', 'decision-log.jsonl'));
  }

  private readLlmTrace(): LlmCallRecord[] {
    return readJsonl<LlmCallRecord>(join(this.dataDir, 'audit', 'runtime', 'llm-calls.jsonl'));
  }

  private readAbLatest(): { winner: string; consecutiveWins: number; margin: number } | null {
    const p = join(this.dataDir, 'ab-test', 'latest.json');
    if (!existsSync(p)) return null;
    try {
      const d = JSON.parse(readFileSync(p, 'utf-8')) as { winner?: string; consecutiveWins?: number; margin?: number };
      if (typeof d.winner !== 'string') return null;
      return {
        winner: d.winner,
        consecutiveWins: d.consecutiveWins ?? 0,
        margin: d.margin ?? 0,
      };
    } catch {
      return null;
    }
  }

  // ── 按 Agent 聚合 ──

  /** 按 Agent 查工作明细（缺省全量 agent） */
  aggregateByAgent(agentId?: string): AgentWorklog[] {
    const decisions = this.readDecisionLog();
    const traces = this.readLlmTrace();
    const aggEntries = this.aggregateEntries ?? [];

    // agent → taskId 集合（decision-log 与 trace 双源并集；聚合轨迹兜底）
    const agentTasks = new Map<string, Map<string, TaskAgg>>();
    const ensure = (aid: string, tid: string): TaskAgg => {
      let tasks = agentTasks.get(aid);
      if (!tasks) { tasks = new Map(); agentTasks.set(aid, tasks); }
      let agg = tasks.get(tid);
      if (!agg) {
        agg = {
          decisions: 0, humanInterventions: 0, retries: 0,
          llmCalls: 0, tokens: { input: 0, output: 0 },
          modelCallMs: 0, costAccum: { known: false, value: 0 },
          firstSeen: '', lastSeen: '',
        };
        tasks.set(tid, agg);
      }
      return agg;
    };

    const touch = (agg: TaskAgg, ts: string): void => {
      if (!agg.firstSeen || ts < agg.firstSeen) agg.firstSeen = ts;
      if (!agg.lastSeen || ts > agg.lastSeen) agg.lastSeen = ts;
    };

    for (const d of decisions) {
      const aid = d.agentId ?? 'unknown';
      const tid = d.sessionId ?? 'unknown';
      const agg = ensure(aid, tid);
      agg.decisions += 1;
      if (d.kind === 'ESCALATE_REPORT' || d.category === 'escalate') agg.humanInterventions += 1;
      if (d.category === 'retry') agg.retries += 1;
      touch(agg, d.ts ?? '');
    }

    for (const t of traces) {
      const aid = t.agentId ?? 'unknown';
      const tid = t.taskId ?? 'unknown';
      const agg = ensure(aid, tid);
      agg.llmCalls += 1;
      agg.tokens.input += t.tokenInput ?? 0;
      agg.tokens.output += t.tokenOutput ?? 0;
      agg.modelCallMs += t.durationMs ?? 0;
      const cost = estimateCostUsd(t.model, t.tokenInput ?? 0, t.tokenOutput ?? 0);
      if (cost !== null) { agg.costAccum.known = true; agg.costAccum.value += cost; }
      touch(agg, t.ts ?? '');
    }

    // meta-harness 注入的聚合轨迹（跨 harness 审计面）——记为该 harness 的任务痕迹
    for (const e of aggEntries) {
      const aid = e.agentId ?? e.harnessId;
      const agg = ensure(aid, e.harnessId);
      touch(agg, e.timestamp);
    }

    // 组装输出
    const out: AgentWorklog[] = [];
    for (const [aid, tasks] of agentTasks) {
      if (agentId && aid !== agentId) continue;
      const entries: TaskWorklogEntry[] = [];
      let totTokens = { input: 0, output: 0 };
      let totCalls = 0; let totMs = 0; let totInterv = 0;
      let anyNodeDuration = false; let costKnown = false; let costValue = 0;
      for (const [tid, agg] of tasks) {
        const nodeDur = this.nodeDurations?.[tid];
        const nodeTotalMs = nodeDur
          ? Math.max(0, new Date(nodeDur.endedAt).getTime() - new Date(nodeDur.startedAt).getTime())
          : null;
        if (nodeTotalMs !== null) anyNodeDuration = true;
        if (agg.costAccum.known) { costKnown = true; costValue += agg.costAccum.value; }
        totTokens = { input: totTokens.input + agg.tokens.input, output: totTokens.output + agg.tokens.output };
        totCalls += agg.llmCalls;
        totMs += agg.modelCallMs;
        totInterv += agg.humanInterventions;
        entries.push({
          taskId: tid,
          workflowId: tid.includes(':') ? tid.split(':')[0]! : tid,
          decisions: agg.decisions,
          humanInterventions: agg.humanInterventions,
          retries: agg.retries,
          llmCalls: agg.llmCalls,
          tokens: agg.tokens,
          modelCallMs: agg.modelCallMs,
          nodeTotalMs,
          costUsd: agg.costAccum.known ? round4(agg.costAccum.value) : null,
          firstSeen: agg.firstSeen,
          lastSeen: agg.lastSeen,
        });
      }
      entries.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
      out.push({
        agentId: aid,
        tasks: entries,
        totals: {
          tasks: entries.length,
          llmCalls: totCalls,
          tokens: totTokens,
          modelCallMs: totMs,
          durationBasis: anyNodeDuration ? 'node-total' : 'model-call-only',
          costUsd: costKnown ? round4(costValue) : null,
          humanInterventions: totInterv,
        },
      });
    }
    out.sort((a, b) => (a.agentId < b.agentId ? -1 : 1));
    return out;
  }

  // ── 按 Workflow 聚合 ──

  /** 按 Workflow 聚合（taskId 冒号前缀为 workflowId；节点状态以时间推断） */
  aggregateByWorkflow(workflowId?: string): WorkflowWorklog[] {
    const agents = this.aggregateByAgent();
    const byWf = new Map<string, Array<{ taskId: string; humanInterventions: number; lastSeen: string }>>();
    for (const a of agents) {
      for (const t of a.tasks) {
        let list = byWf.get(t.workflowId);
        if (!list) { list = []; byWf.set(t.workflowId, list); }
        list.push({ taskId: t.taskId, humanInterventions: t.humanInterventions, lastSeen: t.lastSeen });
      }
    }
    const out: WorkflowWorklog[] = [];
    for (const [wf, nodes] of byWf) {
      if (workflowId && wf !== workflowId) continue;
      out.push({
        workflowId: wf,
        nodes: nodes
          .sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : 1))
          .map((n) => ({
            taskId: n.taskId,
            // 状态推断：最近一周内活跃=active，更早=done，无时间=unknown（如实标注，不臆造）
            status: inferNodeStatus(n.lastSeen),
            humanInterventions: n.humanInterventions,
          })),
        humanInterventions: nodes.reduce((s, n) => s + n.humanInterventions, 0),
      });
    }
    return out;
  }

  // ── 周趋势 ──

  /** 按周趋势（活跃度/审计成功率/成本） */
  weeklyTrend(weeks = 8): WeekTrend[] {
    const history = this.readAuditHistory();
    const decisions = this.readDecisionLog();
    const traces = this.readLlmTrace();

    const buckets = new Map<string, { activity: number; audits: number; auditPass: number; cost: number }>();
    const bump = (week: string): Bucket => {
      let b = buckets.get(week);
      if (!b) { b = { activity: 0, audits: 0, auditPass: 0, cost: 0 }; buckets.set(week, b); }
      return b;
    };

    for (const h of history) {
      const b = bump(isoWeekKey(h.timestamp ?? ''));
      b.activity += 1;
      b.audits += 1;
      if (h.exitCode === 0) b.auditPass += 1;
    }
    for (const d of decisions) bump(isoWeekKey(d.ts ?? '')).activity += 1;
    for (const t of traces) {
      const b = bump(isoWeekKey(t.ts ?? ''));
      b.activity += 1;
      const cost = estimateCostUsd(t.model, t.tokenInput ?? 0, t.tokenOutput ?? 0);
      if (cost !== null) b.cost += cost;
    }

    return [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-weeks)
      .map(([week, b]) => ({
        week,
        activity: b.activity,
        auditPassRate: b.audits > 0 ? round4(b.auditPass / b.audits) : null,
        costUsd: round4(b.cost),
      }));
  }

  // ── 进化四维趋势 ──

  /** 进化四维趋势（审计 PASS 率 / 错题复发率 / AB 胜负曲线 / 首次通过率） */
  evolutionTrends(): EvolutionTrends {
    const history = this.readAuditHistory();
    const agents = this.aggregateByAgent();

    // 一、审计 PASS 率（全量 + 按周）
    const overall = history.length > 0
      ? round4(history.filter((h) => h.exitCode === 0).length / history.length)
      : null;
    const weekBuckets = new Map<string, { n: number; pass: number }>();
    for (const h of history) {
      const wk = isoWeekKey(h.timestamp ?? '');
      const b = weekBuckets.get(wk) ?? { n: 0, pass: 0 };
      b.n += 1;
      if (h.exitCode === 0) b.pass += 1;
      weekBuckets.set(wk, b);
    }
    const weekly = [...weekBuckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([week, b]) => ({ week, rate: b.n > 0 ? round4(b.pass / b.n) : null }));

    // 二、错题复发率（failure-ledger；getRepeatedFailures 阈值=3）
    let repeatedPatterns = 0;
    let totalPatterns = 0;
    try {
      // 动态 require 避免包间循环依赖（orchestrator 不依赖 skillopt）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const skillopt = require('@sofagent/skillopt') as {
        getFailurePatterns?: () => Array<{ occurrenceCount?: number }>;
      };
      const patterns = skillopt.getFailurePatterns?.() ?? [];
      totalPatterns = patterns.length;
      repeatedPatterns = patterns.filter((p) => (p.occurrenceCount ?? 0) >= 3).length;
    } catch {
      // skillopt 不可用（数据目录缺失等）——复发率 null，不臆造
    }

    // 三、AB 胜负曲线（latest.json）
    const abCurve = this.readAbLatest();

    // 四、首次通过率（无 retry/escalate 的任务占比）
    let totalTasks = 0;
    let retriedTasks = 0;
    for (const a of agents) {
      for (const t of a.tasks) {
        totalTasks += 1;
        if (t.retries > 0 || t.humanInterventions > 0) retriedTasks += 1;
      }
    }

    return {
      auditPassRate: { overall, weekly },
      failureRecurrence: {
        repeatedPatterns,
        totalPatterns,
        rate: totalPatterns > 0 ? round4(repeatedPatterns / totalPatterns) : null,
      },
      abCurve,
      firstPassRate: {
        rate: totalTasks > 0 ? round4((totalTasks - retriedTasks) / totalTasks) : null,
        retriedTasks,
        totalTasks,
      },
    };
  }

  // ── 落盘 ──

  /** 全量聚合落盘 data/dashboard/worklog.json（v1.4.0 Web 工作明细页的数据契约） */
  writeWorklogJson(): string {
    const payload = {
      generatedAt: new Date().toISOString(),
      /** 口径标注（验收：节点耗时口径标注清晰） */
      durationBasisNote:
        'modelCallMs=模型调用耗时合计（LLM trace durationMs 复用）；nodeTotalMs=节点总耗时' +
        '（nodeDurations 注入补采集——含工具执行+等待+重试；null 表示本批无该口径数据）',
      agents: this.aggregateByAgent(),
      workflows: this.aggregateByWorkflow(),
      weeklyTrend: this.weeklyTrend(),
      evolution: this.evolutionTrends(),
    };
    const outDir = join(this.dataDir, 'dashboard');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'worklog.json');
    writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    return outPath;
  }

  /** 汇总查询（MCP worklog_query 的数据面） */
  query(params: {
    agentId?: string;
    workflowId?: string;
    weeklyTrend?: boolean;
    evolution?: boolean;
  } = {}): {
    agents: AgentWorklog[];
    workflows: WorkflowWorklog[];
    weeklyTrend?: WeekTrend[];
    evolution?: EvolutionTrends;
  } {
    const result: ReturnType<WorklogAggregator['query']> = {
      agents: this.aggregateByAgent(params.agentId),
      workflows: this.aggregateByWorkflow(params.workflowId),
    };
    if (params.weeklyTrend) result.weeklyTrend = this.weeklyTrend();
    if (params.evolution) result.evolution = this.evolutionTrends();
    return result;
  }
}

// ── 内部类型与工具 ────────────────────────────────────────

interface DecisionEntryShape {
  ts?: string;
  agentId?: string;
  sessionId?: string;
  kind?: string;
  category?: string;
}

interface TaskAgg {
  decisions: number;
  humanInterventions: number;
  retries: number;
  llmCalls: number;
  tokens: { input: number; output: number };
  modelCallMs: number;
  costAccum: { known: boolean; value: number };
  firstSeen: string;
  lastSeen: string;
}

interface Bucket {
  activity: number;
  audits: number;
  auditPass: number;
  cost: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 节点状态推断（7 天内活跃=active；更早=done；无时间=unknown） */
function inferNodeStatus(lastSeen: string): 'active' | 'done' | 'unknown' {
  if (!lastSeen) return 'unknown';
  const age = Date.now() - new Date(lastSeen).getTime();
  if (Number.isNaN(age)) return 'unknown';
  return age < 7 * 86400000 ? 'active' : 'done';
}
