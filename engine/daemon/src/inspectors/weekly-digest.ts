// ============================================================
// weekly-digest.ts · 理解债务周报巡检（v1.5.2 章二 · @weekly）
// ============================================================
//
// 定位：每周把「AI 节点这周干了什么 + 为什么这么做 + 出过什么异常/需要谁
// 介入」聚成一页机器可读摘要，写进 dashboard 数据目录（治理 tab 的周报
// 导出源）——补的是审计面缺的**理由与介入**视角。
//
// 🔴 增量边界（不得产出第二份内容重叠的周报——边际逐一对照）：
//   ① audit/governance.formatGovernanceWeekly（治理 KPI 周报 markdown）：
//      安全边界/覆盖率/时延/trace 对账等六卡 —— 本文件不重复任何 KPI 卡；
//   ② audit/report-generator.generateWeeklyReport（数据主权 ISO 周报）：
//      数据主权记录 —— 不同数据源，不重叠；
//   ③ inspectors/data-sovereignty-weekly（L2 @weekly）：同上，主权档；
//   ④ inspectors/commons-health（L2 @weekly）：公地库存与退役候选 —— 不重叠；
//   ⑤ inspectors/trend-aggregator（L2 @weekly，写 weekly-YYYY-WNN.json）：
//      安全边界**趋势**（违规/告警/阻断计数 + TOP5 规则 + 周环比，源自
//      daily-snapshot）—— 本文件不碰违规计数与规则榜，取的是**执行与理由面**
//      （worklog 节点执行统计 + decision-log 因果链 + HITL 介入）。
//      ⚠️ 文件名刻意**不用 `weekly-` 前缀**：dashboard 的 sustain 面板按
//      `startsWith('weekly-')` 取最近一个文件当 weeklyReport（serve-dashboard.mjs），
//      同名前缀会把它的数据面串成本文件的 schema（真实冲突，故用 digest-*）。
//   ⑥ worklog/attribution.ts 的周报 Top5：该模块零生产消费（未从包索引导出、
//      attribution.jsonl 无生产写入方），无法「调用」——本文件**参考**其
//      「按影响排序而非按时间罗列」的口径（见下），数据源改用有生产写入方的
//      decision-log，不复制它的实现。
//
// 挂载点：engine/daemon/src/inspectors/registry.ts 的 INSPECTORS 表（layer L2
// → LAYER_SCHEDULE 映射 @weekly；DEFAULT_INSPECTOR_CONFIG 由该表派生，勿手改）。
//
// 只读纪律：审计数据（decision-log / hitl）零改动；唯一写入是 dashboard
// 数据目录下的摘要文件（与 trend-aggregator / task-stats 同惯例）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { loadDecisionLog, traceDecisionChain } from '@sofagent/audit';
import type { DecisionLogEntry } from '@sofagent/audit';
import type { InspectorResult } from './types';

// ────────────────────────────────────────────────────────────
// 报告 schema
// ────────────────────────────────────────────────────────────

/** 节点（agent）执行统计行 */
export interface DigestNodeStat {
  agentId: string;
  /** 窗口内任务数 */
  tasks: number;
  /** 重试决策次数 */
  retries: number;
  /** 人工介入次数（ESCALATE_REPORT / category=escalate） */
  humanInterventions: number;
  /** 首次通过率（1 - retries/tasks；无任务为 null） */
  firstPassRate: number | null;
  /** 窗口内最后活动时间 */
  lastSeen: string;
}

/** 决策高亮行（引因果链——「为什么这么做」的周度切片） */
export interface DigestDecisionHighlight {
  ts: string;
  kind: string;
  causalType?: string;
  /** 因果链深度（链上决策条数） */
  depth: number;
  /** 链式叙事（根因 → 结果，单行截断） */
  chain: string;
}

/** 异常分类汇总（按 decision-log 的 kind 归桶——不新增 kind，只用既有值） */
export interface DigestAnomalies {
  total: number;
  /** 降级执行（FALLBACK_DEGRADE） */
  degraded: number;
  /** 升级人工（ESCALATE_REPORT） */
  escalated: number;
  /** 回滚/进化动作（EVOLUTION） */
  rollback: number;
  /** 工具门禁触发（TOOL_GATE——拦截/放行/告警） */
  blocked: number;
}

/** 人工介入汇总（HITL 目录口径，与 governance ③ 同源——口径不另立） */
export interface DigestInterventions {
  /** 待办（hitl/pending 文件数） */
  pending: number;
  /** 本窗口内已决议数（hitl/resolved 按 resolvedAt 过滤） */
  resolvedThisWeek: number;
  resolved: Array<{ checkpointId: string; decision: string; resolvedAt: string }>;
}

/** 周报摘要（写入 {dataDir}/dashboard/digest-<week>.json） */
export interface WeeklyDigestReport {
  schemaVersion: 'v1';
  /** 周标识（ISO 周，如 2026-W38；orchestrator 不可用时回退日期） */
  weekId: string;
  window: { start: string; end: string; days: number };
  nodeStats: {
    agents: DigestNodeStat[];
    totalTasks: number;
    totalAgents: number;
  };
  decisionHighlights: DigestDecisionHighlight[];
  /** 窗口内决策按 kind 计数（读数面——非高亮） */
  decisionKinds: Array<{ kind: string; count: number }>;
  anomalies: DigestAnomalies;
  interventions: DigestInterventions;
  /** 降级说明（数据源不可用等——如实标注，不静默） */
  notes: string[];
  generatedAt: string;
}

// ────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** 窗口内节点统计取样上限 */
const NODE_SAMPLE = 10;
/** 决策高亮条数上限 */
const HIGHLIGHT_LIMIT = 5;
/** 链式叙事截断 */
const CHAIN_MAX = 200;

/** why 文本抽取（schema 是 {text}，简化写入可能是裸 string——两种兼容） */
function whyTextOf(entry: DecisionLogEntry): string {
  const raw = entry.why as unknown;
  if (typeof raw === 'string') return raw;
  const text = (raw as { text?: string } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

/** 异常桶归类（只读既有 kind 值，不新增 kind、不改判定逻辑） */
function classifyAnomaly(kind: string): keyof Omit<DigestAnomalies, 'total'> | null {
  switch (kind) {
    case 'FALLBACK_DEGRADE':
      return 'degraded';
    case 'ESCALATE_REPORT':
      return 'escalated';
    case 'EVOLUTION':
      return 'rollback';
    case 'TOOL_GATE':
      return 'blocked';
    default:
      return null;
  }
}

/** HITL resolved 文件最小读面（与 governance 同目录约定：{dataDir}/hitl/{pending,resolved}） */
interface HitlResolvedFile {
  checkpointId?: string;
  decision?: string;
  resolvedAt?: string;
}

/**
 * worklog 聚合模块的**结构面**（延迟 require 的形状声明——沿用本目录既有
 * 惯例 commons-health / commons-catalog-daily：避免 daemon→orchestrator
 * 的编译期依赖，故不 import 其类型）。
 */
interface WorklogTaskLite {
  lastSeen: string;
  retries: number;
  humanInterventions: number;
}
interface WorklogAgentLite {
  agentId: string;
  tasks: WorklogTaskLite[];
}
interface WorklogModule {
  WorklogAggregator: new (options: { dataDir: string }) => { aggregateByAgent: () => WorklogAgentLite[] };
  isoWeekKey: (tsIso: string) => string;
}

/** 加载 worklog 聚合模块（不可用返回 null 并留痕——降级不静默） */
function loadWorklogModule(notes: string[]): WorklogModule | null {
  try {
    return require('@sofagent/orchestrator/worklog') as WorklogModule;
  } catch (err) {
    notes.push(
      `worklog 聚合不可用（@sofagent/orchestrator/worklog 未构建）：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * 节点执行统计（复用 orchestrator 的 WorklogAggregator——不自造聚合）。
 */
function collectNodeStats(
  mod: WorklogModule | null,
  dataDir: string,
  windowStartMs: number,
  notes: string[],
): { agents: DigestNodeStat[]; totalTasks: number; totalAgents: number } {
  if (mod === null) {
    notes.push('节点执行统计降级为空');
    return { agents: [], totalTasks: 0, totalAgents: 0 };
  }
  const aggregator = new mod.WorklogAggregator({ dataDir });

  const rows: DigestNodeStat[] = [];
  let totalTasks = 0;
  const windowStartIso = new Date(windowStartMs).toISOString();
  for (const agent of aggregator.aggregateByAgent()) {
    const inWindow = agent.tasks.filter((t) => t.lastSeen >= windowStartIso);
    if (inWindow.length === 0) continue;
    const tasks = inWindow.length;
    const retries = inWindow.reduce((s, t) => s + t.retries, 0);
    const humanInterventions = inWindow.reduce((s, t) => s + t.humanInterventions, 0);
    const lastSeen = inWindow.map((t) => t.lastSeen).sort().slice(-1)[0] ?? '';
    totalTasks += tasks;
    rows.push({
      agentId: agent.agentId,
      tasks,
      retries,
      humanInterventions,
      // F-36：clamp + 空态语义。原式无界——retries 归属口径与 tasks 不同时可产出
      // 负值/超界值（实测 -18617%）；tasks=0 是无数据（null），不是 0%。
      // 两侧口径（本处按 0-1 小数；ab-scheduler 的 qualityScore 按 0-100）在
      // 各自量纲内 clamp，等价性见 worklog-view 渲染与 extractMetrics 消费。
      firstPassRate:
        tasks > 0
          ? Math.min(1, Math.max(0, Math.round(((tasks - retries) / tasks) * 1000) / 1000))
          : null,
      lastSeen,
    });
  }
  rows.sort((a, b) => b.tasks - a.tasks);
  return { agents: rows.slice(0, NODE_SAMPLE), totalTasks, totalAgents: rows.length };
}

/** HITL 介入汇总（只读目录扫描——与 governance 同源口径） */
function collectInterventions(
  dataDir: string,
  windowStartMs: number,
  notes: string[],
): DigestInterventions {
  const hitlDir = join(dataDir, 'hitl');
  const pendingDir = join(hitlDir, 'pending');
  const resolvedDir = join(hitlDir, 'resolved');

  let pending = 0;
  if (existsSync(pendingDir)) {
    try {
      pending = readdirSync(pendingDir).filter((f) => f.endsWith('.json')).length;
    } catch {
      pending = 0;
    }
  }

  const resolved: DigestInterventions['resolved'] = [];
  if (existsSync(resolvedDir)) {
    let files: string[] = [];
    try {
      files = readdirSync(resolvedDir).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    let badFiles = 0;
    for (const f of files) {
      try {
        const d = JSON.parse(readFileSync(join(resolvedDir, f), 'utf-8')) as HitlResolvedFile;
        const resolvedAt = typeof d.resolvedAt === 'string' ? d.resolvedAt : '';
        const ts = Date.parse(resolvedAt);
        if (Number.isNaN(ts) || ts < windowStartMs) continue;
        resolved.push({
          checkpointId: d.checkpointId ?? f.replace(/\.json$/, ''),
          decision: d.decision ?? '',
          resolvedAt,
        });
      } catch {
        // 坏文件跳过（聚合观测面不因单文件崩——与 governance 同语义）——但跳过数留痕
        badFiles++;
      }
    }
    // 降级可见（静默吞错门禁 check-silent-catch 的合规形态）：跳过多少文件必须留痕，
    // 一次汇总一行（不逐文件刷屏），随 notes 落进报告与巡检 message
    if (badFiles > 0) {
      notes.push(`HITL resolved 目录有 ${badFiles} 个文件无法解析（已跳过，不影响其余汇总）`);
    }
  }
  resolved.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
  return { pending, resolvedThisWeek: resolved.length, resolved: resolved.slice(0, 5) };
}

// ────────────────────────────────────────────────────────────
// 巡检主入口
// ────────────────────────────────────────────────────────────

/**
 * @weekly 周报巡检（节点执行统计 + 决策高亮 + 异常与介入汇总）。
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT——与同目录
 *                    既有 inspector 一致；签名保留仅为 InspectorFn 兼容）
 */
export function runWeeklyDigest(_projectDir: string): InspectorResult {
  void _projectDir;
  const env = loadEnvConfig();
  const dataDir = env.dataDir;
  const dashboardDir = join(dataDir, 'dashboard');
  const notes: string[] = [];

  const nowMs = Date.now();
  const windowDays = 7;
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const windowStart = new Date(windowStartMs).toISOString();
  const windowEnd = new Date(nowMs).toISOString();

  // 周标识（复用 orchestrator 的 ISO 周键；不可用时回退日期口径并留痕）
  let weekId = windowEnd.slice(0, 10);
  const worklogMod = loadWorklogModule(notes);
  if (worklogMod !== null) {
    weekId = worklogMod.isoWeekKey(windowEnd);
  } else {
    notes.push('周标识回退为日期口径（ISO 周键不可用）');
  }

  // ── ① 节点执行统计 ──
  const nodeStats = collectNodeStats(worklogMod, dataDir, windowStartMs, notes);

  // ── ② 决策高亮（引因果链）+ 异常归桶 ──
  let decisions: DecisionLogEntry[] = [];
  try {
    decisions = loadDecisionLog(dataDir);
  } catch (err) {
    notes.push(`decision-log 读取失败：${err instanceof Error ? err.message : String(err)}——决策面降级为空`);
  }
  const inWindow = decisions.filter((d) => {
    const ts = Date.parse(d.ts);
    return !Number.isNaN(ts) && ts >= windowStartMs;
  });

  const kindCounts = new Map<string, number>();
  const anomalies: DigestAnomalies = { total: 0, degraded: 0, escalated: 0, rollback: 0, blocked: 0 };
  for (const d of inWindow) {
    kindCounts.set(d.kind, (kindCounts.get(d.kind) ?? 0) + 1);
    const bucket = classifyAnomaly(d.kind);
    if (bucket !== null) {
      anomalies[bucket] += 1;
      anomalies.total += 1;
    }
  }

  // 高亮口径：带因果边者优先、链深者优先（「越深越值得理解」——参考
  // attribution 的「按影响排序而非按时间罗列」，不自造第二套排序逻辑）
  const chained = inWindow.filter((d) => Array.isArray(d.causedBy) && d.causedBy.length > 0);
  const decisionHighlights: DigestDecisionHighlight[] = chained
    .map((d) => {
      const trace = traceDecisionChain(d.ts, dataDir);
      const chain = trace === undefined ? '' : trace.narrative.replace(/\n/g, ' ').trim();
      return {
        ts: d.ts,
        kind: d.kind,
        ...(d.causalType ? { causalType: d.causalType } : {}),
        depth: trace?.chain.length ?? 1,
        chain: chain.length > CHAIN_MAX ? `${chain.slice(0, CHAIN_MAX)}…` : chain,
      };
    })
    .sort((a, b) => (b.depth - a.depth !== 0 ? b.depth - a.depth : b.ts.localeCompare(a.ts)))
    .slice(0, HIGHLIGHT_LIMIT);

  // ── ③ 人工介入汇总 ──
  const interventions = collectInterventions(dataDir, windowStartMs, notes);

  const report: WeeklyDigestReport = {
    schemaVersion: 'v1',
    weekId,
    window: { start: windowStart, end: windowEnd, days: windowDays },
    nodeStats,
    decisionHighlights,
    decisionKinds: [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ kind, count })),
    anomalies,
    interventions,
    notes,
    generatedAt: windowEnd,
  };

  // ── 写入 dashboard 周报导出源（仅数据面，不改 dashboard 前端）──
  const reportPath = join(dashboardDir, `digest-${weekId}.json`);
  try {
    const dir = dirname(reportPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  } catch (err) {
    return {
      name: 'weekly-digest',
      triggered: false,
      message: `周报摘要写入失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }

  const hasActivity = nodeStats.totalTasks > 0 || inWindow.length > 0;
  const severity: InspectorResult['severity'] =
    anomalies.total > 0 || interventions.pending > 0 ? 'warning' : 'info';
  const noteSuffix = notes.length > 0 ? ` · 降级 ${notes.length} 项` : '';

  return {
    name: 'weekly-digest',
    triggered: hasActivity,
    message:
      `digest-${weekId}.json 已生成：节点 ${nodeStats.totalAgents} 个（执行 ${nodeStats.totalTasks} 次） · ` +
      `决策 ${inWindow.length} 条（高亮 ${decisionHighlights.length}） · ` +
      `异常 ${anomalies.total} · 介入 待办 ${interventions.pending} / 已决 ${interventions.resolvedThisWeek}${noteSuffix}`,
    severity,
  };
}
