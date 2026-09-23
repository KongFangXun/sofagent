// governance.ts · v1.5.1 章一 · 治理 KPI 聚合层（约束层价值面板化）
//
// 定位：dashboard「治理」tab 的数据引擎——把审计/决策/HITL/数据集四路
// 只读数据源聚合成「给老板汇报的一页纸」。与 stats.ts 的分工：
//   stats.ts = v1.4.3 安全边界 KPI（history.jsonl 单源，CLI --stats 契约不变）
//   governance.ts = v1.5.1 治理全景 KPI（四源聚合，dashboard /api/governance 消费）
//
// 六卡口径（与 HANDBOOK 指标口径节同源）：
//   ① 安全边界触发率 = (WARN+FAIL)/total（复用 stats 口径——同源防漂移）
//   ② 审计覆盖率 = 有 commitSha 的 history 条目数 / 窗口内变更总数
//        （commitSha 存在 = 该次变更走过审计 hook；无此字段 = 人工补记/测试记录）
//   ③ HITL 响应时延 = resolved 文件 createdAt→resolvedAt 平均时长（中位数防长尾）
//   ④ 周环比 = 本周 daily-*.json 关键指标 vs 上周（复用 worklog 日聚合——零新采集）
//   ⑤ 任务重复执行维度 = decision-log TOOL_GATE 同 (agentId, why.tags) 出现次数分布
//        （重复执行才有可比较轨迹——数据飞轮燃料读数）
//   ⑥ trace 对账一致率 = decision-log COVERAGE 最新一条 consistencyRate
//        （章八 trace_reconcile 落盘——本卡在章一交付）
//
// 只读铁律：本模块零写入（HMAC 链完整性不受聚合影响）；唯一例外是
// formatGovernanceWeekly / buildDatasetLineageReport 生成 markdown 文本
// 返回调用方，落盘由调用方决定。
//
// 第七卡（数据集人审面）数据源：train/<enterpriseId>/datasets/versions.jsonl
// 版本台账 + decision-log 中 HITL_REVIEW 决策（人审判定入 decision-log）。

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { readHistoryEntries } from './stats';
import { collectInvalidations, filterValid, isInvalidationMarker } from './invalidation';
import type { AuditHistoryEntry } from './audit-history';
import type { DecisionLogEntry } from './decision-log';

// ════════════════════════════════════════
// 数据模型
// ════════════════════════════════════════

/** 治理 KPI 报告（/api/governance 输出 schema v1） */
export interface GovernanceKpiReport {
  schemaVersion: 'v1';
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  /** ① 安全边界触发率（stats 同源） */
  boundary: {
    triggerRate: number | null;
    blockRate: number | null;
    totalChanges: number;
    distribution: { pass: number; warn: number; fail: number };
    topRules: { rule: string; name: string; count: number; failCount: number }[];
  };
  /** ② 审计覆盖率（有 commitSha 的变更占比） */
  coverage: {
    rate: number | null;
    withSha: number;
    total: number;
  };
  /** ③ HITL 响应时延（resolved 目录 createdAt→resolvedAt 中位数） */
  hitl: {
    resolvedCount: number;
    pendingCount: number;
    medianLatencyMs: number | null;
    avgLatencyMs: number | null;
    samples: { checkpointId: string; latencyMs: number; decision: string }[];
  };
  /** ④ 周环比（worklog daily 聚合） */
  weeklyTrend: {
    thisWeek: { violations: number; taskCount: number; localOps: number } | null;
    lastWeek: { violations: number; taskCount: number; localOps: number } | null;
    delta: { violationsPct: number | null; taskCountPct: number | null; localOpsPct: number | null };
  };
  /** ⑤ 任务重复执行维度（decision-log TOOL_GATE 分布） */
  repetition: {
    totalDecisions: number;
    uniqueFingerprints: number;
    repeatedFingerprints: number;
    /** 重复执行率 = repeated/total（数据飞轮燃料读数） */
    repetitionRate: number | null;
    topRepeated: { fingerprint: string; count: number; agentId: string }[];
  };
  /** ⑥ trace 对账一致率（COVERAGE 最新一条） */
  traceReconcile: {
    latestRate: number | null;
    totalSessions: number | null;
    diffFiles: number | null;
    discrepancies: number | null;
    lastRunAt: string | null;
  };
  /** 第七卡数据集审阅面（versions.jsonl 台账抽样） */
  datasetReview: {
    totalVersions: number;
    pendingReview: number;
    reviewed: number;
    sample: DatasetVersionLite[];
  };
  /** 决策高亮（消费 v1.4.4 因果链字段——causedBy/causalType 决策可追溯） */
  decisionHighlights: DecisionHighlight[];
  generatedAt: string;
}

/** 决策高亮条目（治理 tab「决策高亮」区块——因果链可追溯的决策） */
export interface DecisionHighlight {
  ts: string;
  agentId: string;
  kind: string;
  category?: string;
  moment: string;
  /** 因果边类型（caused/influenced/precedent_for） */
  causalType?: string;
  /** 引用的前序决策条数（causedBy 长度——链深读数） */
  causedByCount: number;
  /** 理由摘要（脱敏后文本截断） */
  whySummary: string;
}

/** 数据集版本精简行（dashboard 卡片用——不动 train 包类型面） */
export interface DatasetVersionLite {
  versionId: string;
  datasetId: string;
  createdAt: string;
  sampleCount?: number;
  redactionHits?: number;
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

/** 聚合选项 */
export interface GovernanceOptions {
  days?: number;
  now?: () => number;
  dataDir?: string;
  /** 抽样上限（缺省 8） */
  sampleLimit?: number;
}

// ════════════════════════════════════════
// 数据源读取（全部只读）
// ════════════════════════════════════════

/** 缺省数据目录（与 stats.ts 同源约定） */
function resolveDefaultDataDir(): string {
  const envDir = process.env.SOFAGENT_DATA;
  if (envDir && envDir.trim() !== '') return envDir;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.sofagent', 'data');
}

function governanceDataDir(options?: GovernanceOptions): string {
  return options?.dataDir ?? resolveDefaultDataDir();
}

/** decision-log.jsonl 只读（坏行容忍——聚合观测面） */
export function readDecisionEntries(dataDir?: string, limitEntries?: number): DecisionLogEntry[] {
  const base = dataDir ?? resolveDefaultDataDir();
  const filePath = join(base, 'audit', 'decision-log.jsonl');
  if (!existsSync(filePath)) return [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const entries: DecisionLogEntry[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as DecisionLogEntry);
    } catch {
      /* 坏行跳过 */
    }
  }
  if (limitEntries !== undefined && entries.length > limitEntries) {
    return entries.slice(-limitEntries);
  }
  return entries;
}

/** HITL resolved/*.json 只读扫描 */
interface HitlResolvedFile {
  checkpointId: string;
  decision: string;
  resolvedAt: string;
  createdAt?: string;
  comment?: string;
  checkpoint?: { createdAt?: string };
}
function readHitlResolved(dataDir: string): HitlResolvedFile[] {
  const dir = join(dataDir, hitlDirName(), 'resolved');
  if (!existsSync(dir)) return [];
  const out: HitlResolvedFile[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HitlResolvedFile;
      if (d && typeof d.checkpointId === 'string' && typeof d.resolvedAt === 'string') {
        out.push(d);
      }
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out;
}

function hitlDirName(): string {
  // 与 orchestrator hitl-channel 约定一致：{dataDir}/hitl/{pending,resolved}
  return 'hitl';
}

/** HITL pending 数量 */
function countHitlPending(dataDir: string): number {
  const dir = join(dataDir, hitlDirName(), 'pending');
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

/** worklog daily-*.json 只读（dashboard/worklog.json 周报同源） */
interface DailyRecord {
  date: string;
  violations: number;
  taskCount: number;
  localOps: number;
}
function readDailyRecords(dataDir: string): DailyRecord[] {
  const dir = join(dataDir, 'dashboard');
  if (!existsSync(dir)) return [];
  const out: DailyRecord[] = [];
  for (const f of readdirSync(dir)) {
    const m = /^daily-(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (!m) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      out.push({
        date: m[1] ?? '',
        violations: Number(d.violations) || 0,
        taskCount: Number(d.taskCount) || 0,
        localOps: Number(d.localOps) || 0,
      });
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 数据集版本台账只读（train/<enterpriseId>/datasets/versions.jsonl） */
interface DatasetVersionRaw {
  /** 真实字段名是 version（train DatasetVersionRecord）；versionId/id 为宽容兼容 */
  version?: string;
  versionId?: string;
  id?: string;
  datasetId?: string;
  createdAt?: string;
  recordedAt?: string;
  sampleCount?: number;
  samples?: number;
  redactionHits?: number;
  redactedCount?: number;
  reviewStatus?: string;
  humanReview?: string;
  source?: string;
}
export function readDatasetVersionsLite(dataDir: string, limit = 8): { total: number; rows: DatasetVersionLite[] } {
  const trainDir = join(dataDir, 'train');
  if (!existsSync(trainDir)) return { total: 0, rows: [] };
  const rows: DatasetVersionLite[] = [];
  // 多企业目录扫全量（dashboard 不限定企业）
  const enterpriseDirs = readdirSync(trainDir).filter((f) => {
    try {
      return statDirectory(join(trainDir, f));
    } catch {
      return false;
    }
  });
  for (const ent of enterpriseDirs) {
    const versionsFile = join(trainDir, ent, 'datasets', 'versions.jsonl');
    if (!existsSync(versionsFile)) continue;
    try {
      const content = readFileSync(versionsFile, 'utf-8');
      for (const line of content.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const d = JSON.parse(line) as DatasetVersionRaw;
          rows.push({
            versionId: String(d.version ?? d.versionId ?? d.id ?? ''),
            datasetId: String(d.datasetId ?? ent),
            createdAt: String(d.createdAt ?? d.recordedAt ?? ''),
            sampleCount: Number(d.sampleCount ?? d.samples) || undefined,
            redactionHits: Number(d.redactionHits ?? d.redactedCount) || undefined,
            reviewStatus: normalizeReviewStatus(d.reviewStatus ?? d.humanReview),
          });
        } catch {
          /* 坏行跳过 */
        }
      }
    } catch {
      /* 读取失败跳过该企业 */
    }
  }
  // 最新在前（createdAt 倒序），抽样 limit 条
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

function statDirectory(p: string): boolean {
  // readdirSync 内嵌 try——避免 statSync 单独 import（本文件已收敛 fs 面）
  return readdirSync(p).length >= 0;
}

function normalizeReviewStatus(s: string | undefined): 'pending' | 'approved' | 'rejected' {
  if (s === 'approved' || s === 'rejected') return s;
  return 'pending';
}

// ════════════════════════════════════════
// 聚合主入口
// ════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 治理 KPI 聚合主入口：四源只读聚合 → 一份 KPI 报告。
 *
 * 空数据降级：各卡独立降级（rate null + 计数 0），不因单源缺失全页崩。
 */
export function computeGovernanceKpis(options: GovernanceOptions = {}): GovernanceKpiReport {
  const now = options.now ?? Date.now;
  const days = options.days ?? 30;
  const sampleLimit = options.sampleLimit ?? 8;
  const windowEndMs = now();
  const windowStartMs = windowEndMs - days * DAY_MS;
  const dataDir = governanceDataDir(options);

  // ── ① 安全边界（history 窗口过滤——与 stats 同源） ──
  const entries = readHistoryEntries(dataDir);
  const inWindow = entries.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return !Number.isNaN(ts) && ts >= windowStartMs && ts <= windowEndMs;
  });
  const pass = inWindow.filter((e) => e.exitCode === 0).length;
  const warn = inWindow.filter((e) => e.exitCode === 1).length;
  const fail = inWindow.filter((e) => e.exitCode === 2).length;
  const total = inWindow.length;
  const round4 = (x: number): number => Math.round(x * 10000) / 10000;
  const pctDelta = (cur: number, prev: number): number | null =>
    prev === 0 ? (cur === 0 ? 0 : null) : round4((cur - prev) / prev);

  // 高危规则 Top 5（stats 同口径——ruleResults WARN+FAIL 累计）
  const ruleCounts = new Map<string, { name: string; count: number; failCount: number }>();
  for (const entry of inWindow) {
    for (const rc of (entry.ruleResults ?? []) as { status?: string; number?: number; name?: string; id?: string }[]) {
      if (!rc || (rc.status !== 'WARN' && rc.status !== 'FAIL')) continue;
      const code = rc.id ?? `A${rc.number}`;
      const existing = ruleCounts.get(code) ?? { name: '', count: 0, failCount: 0 };
      existing.count += 1;
      if (rc.status === 'FAIL') existing.failCount += 1;
      if (existing.name === '' && typeof rc.name === 'string' && rc.name !== '') existing.name = rc.name;
      ruleCounts.set(code, existing);
    }
  }
  const topRules = [...ruleCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([rule, v]) => ({ rule, name: v.name, count: v.count, failCount: v.failCount }));

  // ── ② 审计覆盖率（有 commitSha 的变更占比） ──
  const withSha = inWindow.filter((e) => typeof e.commitSha === 'string' && (e.commitSha as string) !== '').length;
  const coverageRate = total > 0 ? round4(withSha / total) : null;

  // ── ③ HITL 响应时延 ──
  const resolved = readHitlResolved(dataDir);
  const latencies: { checkpointId: string; latencyMs: number; decision: string }[] = [];
  for (const r of resolved) {
    const created = r.checkpoint?.createdAt ?? r.createdAt;
    if (!created) continue;
    const cMs = Date.parse(created);
    const rMs = Date.parse(r.resolvedAt);
    if (Number.isNaN(cMs) || Number.isNaN(rMs) || rMs < cMs) continue;
    latencies.push({ checkpointId: r.checkpointId, latencyMs: rMs - cMs, decision: String(r.decision ?? '') });
  }
  latencies.sort((a, b) => a.latencyMs - b.latencyMs);
  const medianSample = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : undefined;
  const median = medianSample ? medianSample.latencyMs : null;
  const avg = latencies.length > 0 ? Math.round(latencies.reduce((s, x) => s + x.latencyMs, 0) / latencies.length) : null;

  // ── ④ 周环比（worklog daily 聚合） ──
  const daily = readDailyRecords(dataDir);
  const todayStr = new Date(windowEndMs).toISOString().slice(0, 10);
  const weekAgoStr = new Date(windowEndMs - 7 * DAY_MS).toISOString().slice(0, 10);
  const twoWeekAgoStr = new Date(windowEndMs - 14 * DAY_MS).toISOString().slice(0, 10);
  const sumWeek = (from: string, to: string): { violations: number; taskCount: number; localOps: number } | null => {
    const rows = daily.filter((d) => d.date >= from && d.date <= to);
    if (rows.length === 0) return null;
    return {
      violations: rows.reduce((s, r) => s + r.violations, 0),
      taskCount: rows.reduce((s, r) => s + r.taskCount, 0),
      localOps: rows.reduce((s, r) => s + r.localOps, 0),
    };
  };
  const thisWeek = sumWeek(weekAgoStr, todayStr);
  const lastWeek = sumWeek(twoWeekAgoStr, new Date(windowEndMs - 8 * DAY_MS).toISOString().slice(0, 10));
  const weeklyTrend = {
    thisWeek,
    lastWeek,
    delta: {
      violationsPct: thisWeek && lastWeek ? pctDelta(thisWeek.violations, lastWeek.violations) : null,
      taskCountPct: thisWeek && lastWeek ? pctDelta(thisWeek.taskCount, lastWeek.taskCount) : null,
      localOpsPct: thisWeek && lastWeek ? pctDelta(thisWeek.localOps, lastWeek.localOps) : null,
    },
  };

  // ── ⑤ 任务重复执行维度（decision-log TOOL_GATE 分布） ──
  // 指纹 = (agentId, why.tags join)——同 agent 反复做同类动作 = 可比较轨迹
  // v1.5.2 章四：带失效标记的结论不作 KPI 统计输入（「过期结论不当新证据用」）
  //   ——失效条目仍在日志里（原文留痕），但不再计入重复执行率 / trace 对账 /
  //   决策高亮的读数。另：失效标记条目自身是**元记录**（kind=INVALIDATION），
  //   不是 Agent 决策——一并排除，否则会给决策总数凭空 +1。
  const invalidated = collectInvalidations(dataDir);
  const decisions = filterValid(readDecisionEntries(dataDir, 5000), invalidated)
    .filter((d) => !isInvalidationMarker(d)); // 近 5000 条防超大日志
  const gateDecisions = decisions.filter((d) => d.kind === 'TOOL_GATE');
  const fp = new Map<string, { count: number; agentId: string }>();
  for (const d of gateDecisions) {
    const tags = (d.why as unknown as { tags?: string[] } | undefined)?.tags;
    const fingerprint = `${d.agentId}::${Array.isArray(tags) ? tags.join(',') : ''}`;
    const existing = fp.get(fingerprint) ?? { count:  0, agentId: d.agentId };
    existing.count += 1;
    fp.set(fingerprint, existing);
  }
  const fpEntries = [...fp.entries()];
  const repeated = fpEntries.filter(([, v]) => v.count > 1);
  const repetition = {
    totalDecisions: gateDecisions.length,
    uniqueFingerprints: fpEntries.length,
    repeatedFingerprints: repeated.length,
    repetitionRate: gateDecisions.length > 0 ? round4(repeated.length / fpEntries.length) : null,
    topRepeated: fpEntries
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([fingerprint, v]) => ({ fingerprint, count: v.count, agentId: v.agentId })),
  };

  // ── ⑥ trace 对账一致率（COVERAGE 最新一条） ──
  const coverageDecisions = decisions.filter((d) => d.kind === 'COVERAGE');
  let traceReconcile: GovernanceKpiReport['traceReconcile'] = {
    latestRate: null,
    totalSessions: null,
    diffFiles: null,
    discrepancies: null,
    lastRunAt: null,
  };
  if (coverageDecisions.length > 0) {
    const latest = coverageDecisions[coverageDecisions.length - 1];
    if (latest) {
      const whyText = String(latest.why ?? '');
      // why 是 string 或 {text}——两种形态兼容
      const text = typeof latest.why === 'string' ? whyText : String((latest.why as unknown as { text?: string })?.text ?? '');
      const rateMatch = /一致率\s*([0-9.]+)/.exec(text);
      const sessMatch = /([0-9]+)\s*session/.exec(text);
      const diffMatch = /([0-9]+)\s*diff\s*文件/.exec(text);
      const discMatch = /差异\s*([0-9]+)/.exec(text);
      traceReconcile = {
        latestRate: rateMatch ? Number(rateMatch[1]) : null,
        totalSessions: sessMatch ? Number(sessMatch[1]) : null,
        diffFiles: diffMatch ? Number(diffMatch[1]) : null,
        discrepancies: discMatch ? Number(discMatch[1]) : null,
        lastRunAt: latest.ts ?? null,
      };
    }
  }

  // ── 第七卡：数据集审阅面 ──
  const ds = readDatasetVersionsLite(dataDir, sampleLimit);
  const datasetReview = {
    totalVersions: ds.total,
    pendingReview: ds.total - ds.rows.filter((r) => r.reviewStatus !== 'pending').length,
    reviewed: 0,
    sample: ds.rows,
  };
  // reviewed 数 = 近 5000 决策里 HITL_REVIEW 动作覆盖的 versionId 数（口径：
  // decision-log 为准，versions.jsonl 只供结构）；简化：approved/rejected 状态行数
  datasetReview.reviewed = ds.rows.filter((r) => r.reviewStatus !== 'pending').length;

  // ── 决策高亮（v1.4.4 因果链消费：causedBy/causalType 决策可追溯——治理 tab 高亮） ──
  const decisionHighlights: DecisionHighlight[] = decisions
    .filter((d) => Array.isArray(d.causedBy) && (d.causedBy as string[]).length > 0)
    .slice(-20)
    .reverse()
    .map((d) => {
      const whyRaw = d.why;
      const whyStr =
        typeof whyRaw === 'string'
          ? whyRaw
          : String((whyRaw as unknown as { text?: string } | undefined)?.text ?? '');
      return {
        ts: String(d.ts ?? ''),
        agentId: String(d.agentId ?? ''),
        kind: String(d.kind ?? ''),
        category: d.category ? String(d.category) : undefined,
        moment: String(d.moment ?? ''),
        causalType: d.causalType ? String(d.causalType) : undefined,
        causedByCount: (d.causedBy as string[]).length,
        whySummary: whyStr.length > 60 ? `${whyStr.slice(0, 60)}…` : whyStr,
      };
    });

  return {
    schemaVersion: 'v1',
    windowDays: days,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    boundary: {
      triggerRate: total > 0 ? round4((warn + fail) / total) : null,
      blockRate: total > 0 ? round4(fail / total) : null,
      totalChanges: total,
      distribution: { pass, warn, fail },
      topRules,
    },
    coverage: { rate: coverageRate, withSha, total },
    hitl: {
      resolvedCount: resolved.length,
      pendingCount: countHitlPending(dataDir),
      medianLatencyMs: median,
      avgLatencyMs: avg,
      samples: latencies.slice(-5).reverse(),
    },
    weeklyTrend,
    repetition,
    traceReconcile,
    datasetReview,
    decisionHighlights,
    generatedAt: new Date(windowEndMs).toISOString(),
  };
}

// ════════════════════════════════════════
// 周报导出（markdown——对齐 worklog 导出模式）
// ════════════════════════════════════════

/**
 * 治理 KPI 周报（markdown）——dashboard 导出按钮消费。
 * 口径与 computeGovernanceKpis 完全同源（报告即聚合的文本投影）。
 */
export function formatGovernanceWeekly(report: GovernanceKpiReport): string {
  const pct = (rate: number | null): string => (rate === null ? '—' : `${(rate * 100).toFixed(2)}%`);
  const signed = (x: number | null): string => (x === null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  const ms = (x: number | null): string => {
    if (x === null) return '—';
    if (x < 60_000) return `${(x / 1000).toFixed(1)} 秒`;
    if (x < 3_600_000) return `${(x / 60_000).toFixed(1)} 分钟`;
    return `${(x / 3_600_000).toFixed(1)} 小时`;
  };
  const lines: string[] = [
    '# sofagent 治理 KPI 周报',
    '',
    `> 窗口：近 ${report.windowDays} 天（${report.windowStart.slice(0, 10)} ~ ${report.windowEnd.slice(0, 10)}）· 生成于 ${report.generatedAt}`,
    '',
    '## 六卡读数',
    '',
    '| # | 指标 | 读数 |',
    '|---|------|------|',
    `| ① | 安全边界触发率 | ${pct(report.boundary.triggerRate)}（阻断率 ${pct(report.boundary.blockRate)}，${report.boundary.totalChanges} 次变更） |`,
    `| ② | 审计覆盖率 | ${pct(report.coverage.rate)}（${report.coverage.withSha}/${report.coverage.total} 变更有 commit 锚） |`,
    `| ③ | HITL 响应时延 | 中位 ${ms(report.hitl.medianLatencyMs)} · 平均 ${ms(report.hitl.avgLatencyMs)}（已决议 ${report.hitl.resolvedCount} / 待办 ${report.hitl.pendingCount}） |`,
    `| ④ | 周环比·问题次数 | ${signed(report.weeklyTrend.delta.violationsPct)}（本周 ${report.weeklyTrend.thisWeek?.violations ?? '—'} vs 上周 ${report.weeklyTrend.lastWeek?.violations ?? '—'}） |`,
    `| ⑤ | 任务重复执行率 | ${pct(report.repetition.repetitionRate)}（${report.repetition.repeatedFingerprints}/${report.repetition.uniqueFingerprints} 类动作有重复轨迹） |`,
    `| ⑥ | trace 对账一致率 | ${report.traceReconcile.latestRate ?? '—'}${report.traceReconcile.discrepancies !== null ? `（差异 ${report.traceReconcile.discrepancies} 项）` : ''} |`,
    '',
    '## 高危规则 Top 5',
    '',
  ];
  if (report.boundary.topRules.length > 0) {
    lines.push('| 规则 | 名称 | 触发 | 其中阻断 |', '|------|------|------|----------|');
    for (const r of report.boundary.topRules) {
      lines.push(`| ${r.rule} | ${r.name || '—'} | ${r.count} | ${r.failCount} |`);
    }
  } else {
    lines.push('窗口内零触发（干净窗口）。');
  }
  lines.push('', '## 数据集审阅', '');
  if (report.datasetReview.totalVersions === 0) {
    lines.push('暂无数据集版本台账（未运行数据集管道）。');
  } else {
    lines.push(
      `版本台账 ${report.datasetReview.totalVersions} 条，抽样 ${report.datasetReview.sample.length} 条：`,
      '',
      '| 版本 | 数据集 | 创建时间 | 样本数 | 脱敏命中 | 审阅状态 |',
      '|------|--------|----------|--------|----------|----------|',
    );
    for (const s of report.datasetReview.sample) {
      lines.push(
        `| ${s.versionId || '—'} | ${s.datasetId} | ${s.createdAt ? s.createdAt.slice(0, 10) : '—'} | ${s.sampleCount ?? '—'} | ${s.redactionHits ?? '—'} | ${s.reviewStatus} |`,
      );
    }
  }
  lines.push('', '## 决策高亮（因果链可追溯）', '');
  if (!report.decisionHighlights || report.decisionHighlights.length === 0) {
    lines.push('窗口内无带因果边的决策（causedBy 为空——链路未启用或决策未引用前序）。');
  } else {
    lines.push('| 时间 | Agent | 类型 | 因果 | 链深 | 理由 |', '|------|-------|------|------|------|------|');
    for (const h of report.decisionHighlights.slice(0, 10)) {
      lines.push(
        `| ${h.ts.slice(0, 16).replace('T', ' ')} | ${h.agentId} | ${h.kind}${h.category ? `/${h.category}` : ''} | ${h.causalType ?? '—'} | ${h.causedByCount} | ${h.whySummary} |`,
      );
    }
  }
  return lines.join('\n');
}

// ════════════════════════════════════════
// 数据集 lineage 合规报告（章一 2026-09-08 排入项）
// ════════════════════════════════════════

/** lineage 报告选项 */
export interface LineageReportOptions extends GovernanceOptions {
  enterpriseId?: string;
}

/**
 * 数据集 lineage 合规报告——数据从哪来 → 过了什么闸 → 版本演进 → 审计链引用。
 *
 * 四段式（可递交给企业合规/法务的导出件）：
 *   一、六源溯源：versions.jsonl source 字段（db-upload/cloud-push/git-diff/
 *      session-summary/manual/third-party）+ 各源样本数
 *   二、双闸记录：sorting-gate 三档判定 + redactor 脱敏命中（decision-log 可查）
 *   三、版本演进：versions.jsonl 全量版本时间线（创建/审阅状态）
 *   四、审计链引用：history-chain-head 文件 + decision-log 首末条 HMAC 摘要
 */
export function buildDatasetLineageReport(options: LineageReportOptions = {}): string {
  const now = options.now ?? Date.now;
  const dataDir = governanceDataDir(options);
  const lines: string[] = [
    '# sofagent 数据集 lineage 合规报告',
    '',
    `> 生成于 ${new Date(now()).toISOString()} · 数据目录 ${dataDir}`,
    '',
  ];

  // ── 一、六源溯源 ──
  const sourceCounts = new Map<string, number>();
  const versionRows: (DatasetVersionLite & { source?: string })[] = [];
  const trainDir = join(dataDir, 'train');
  if (existsSync(trainDir)) {
    for (const ent of safeListDirs(trainDir)) {
      const versionsFile = join(trainDir, ent, 'datasets', 'versions.jsonl');
      if (!existsSync(versionsFile)) continue;
      try {
        for (const line of readFileSync(versionsFile, 'utf-8').split('\n')) {
          if (line.trim() === '') continue;
          try {
            const d = JSON.parse(line) as DatasetVersionRaw;
            const src = String(d.source ?? 'unattributed');
            sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
            versionRows.push({
              versionId: String(d.version ?? d.versionId ?? d.id ?? ''),
              datasetId: String(d.datasetId ?? ent),
              createdAt: String(d.createdAt ?? d.recordedAt ?? ''),
              sampleCount: Number(d.sampleCount ?? d.samples) || undefined,
              redactionHits: Number(d.redactionHits ?? d.redactedCount) || undefined,
              reviewStatus: normalizeReviewStatus(d.reviewStatus ?? d.humanReview),
              source: src,
            });
          } catch {
            /* 坏行跳过 */
          }
        }
      } catch {
        /* 跳过企业目录 */
      }
    }
  }
  lines.push('## 一、数据来源（六源）', '');
  if (sourceCounts.size === 0) {
    lines.push('暂无版本台账——数据集管道未运行。');
  } else {
    lines.push('| 来源 | 版本数 |', '|------|--------|');
    for (const [src, count] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${src} | ${count} |`);
    }
  }

  // ── 二、双闸记录（sorting-gate 三档 + redactor 命中） ──
  const decisions = readDecisionEntries(dataDir, 20000);
  const gateKinds = decisions.filter((d) => d.kind === 'TOOL_GATE' || d.kind === 'COVERAGE');
  const gateDecisionCount = gateKinds.length;
  const redactionHitsTotal = versionRows.reduce((s, r) => s + (r.redactionHits ?? 0), 0);
  lines.push(
    '',
    '## 二、双闸记录',
    '',
    `- 分拣闸（sorting-gate）：相关决策 ${gateDecisionCount} 条（decision-log TOOL_GATE/COVERAGE 口径）`,
    `- 脱敏闸（redactor）：累计命中 ${redactionHitsTotal} 处（versions.jsonl redactionHits 汇总）`,
  );

  // ── 三、版本演进 ──
  lines.push('', '## 三、版本演进', '');
  if (versionRows.length === 0) {
    lines.push('暂无版本记录。');
  } else {
    versionRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    lines.push('| 版本 | 数据集 | 来源 | 创建时间 | 样本数 | 脱敏命中 | 审阅 |', '|------|--------|------|----------|--------|----------|------|');
    for (const r of versionRows.slice(0, 50)) {
      lines.push(
        `| ${r.versionId || '—'} | ${r.datasetId} | ${r.source ?? '—'} | ${r.createdAt ? r.createdAt.slice(0, 10) : '—'} | ${r.sampleCount ?? '—'} | ${r.redactionHits ?? '—'} | ${r.reviewStatus} |`,
      );
    }
    if (versionRows.length > 50) {
      lines.push(`| … | 共 ${versionRows.length} 条（截断展示前 50） | | | | | |`);
    }
  }

  // ── 四、审计链引用 ──
  const chainHeadFile = join(dataDir, 'audit', 'history-chain-head');
  let chainHead = '（未找到）';
  try {
    chainHead = readFileSync(chainHeadFile, 'utf-8').trim().slice(0, 16);
  } catch {
    /* 保持未找到 */
  }
  const decisionCount = decisions.length;
  lines.push(
    '',
    '## 四、审计链引用',
    '',
    '- 审计历史链头（history-chain-head）：`' + chainHead + '`',
    `- 决策日志条目（近 ${Math.min(decisionCount, 20000)} 条）：${decisionCount} 条（每条含 HMAC 签名，可 sofagent-audit decision-query 追溯）`,
    `- 审计历史：${readHistoryEntries(dataDir).length} 条（HMAC 链式完整性可 --verify 验证）`,
  );

  return lines.join('\n');
}

/** 安全列目录（目录不存在/不可读返回空） */
function safeListDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
