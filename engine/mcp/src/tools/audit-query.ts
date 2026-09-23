// ============================================================
// audit-query.ts · MCP tool：审计数据只读查询（v1.5.2 章一）
// ============================================================
//
// audit_query —— 审计数据面（history.jsonl）与决策因果链面
// （decision-log.jsonl）的统一【只读】查询口。
//
// 能力：
//   · history 面：按 时间（since/until）/ 规则（rule）/ exitCode 过滤条目
//   · decision 面：按 时间 过滤 + 按 causedBy（因果上游 ts）查后继决策
//     （消费 v1.4.4 因果边字段），并复用 traceDecisionChain 输出上溯链叙事
//
// ── 与既有 tool 的边界（勿混用）──────────────────────────────
//   · audit_trail（tools/audit-trail.ts）：按 agentId 聚合【跨设备轨迹】
//     （peer 合并 + trust 裁决）——维度是「谁」，本 tool 维度是
//     「时间 / 规则 / exitCode」+「决策因果链」。
//   · worklog_query：工作效能指标（token / 成本 / 人工介入）。
//   · run_audit：跑规则并写 think.md（写侧）；本 tool 纯读、不跑规则。
//   · ruleset_export：规则面导出；本 tool 查数据面。
//
// ── 硬性约束 ────────────────────────────────────────────────
//   · 严格只读：全程不得出现 appendHistory / emitDecision / appendChained
//     等任何链写入原语——查询前后 history.jsonl 必须字节级一致。
//   · 不以任何方式触碰 history.jsonl / decision-log.jsonl 的写路径。
//
// 复用（不重造）：
//   · loadHistory   （@sofagent/audit）——history.jsonl 读原语
//   · loadDecisionLog（@sofagent/audit）——decision-log.jsonl 读原语
//   · traceDecisionChain（@sofagent/audit）——因果链上溯（复用 v1.4.4 实现）
// ============================================================

import { loadHistory, loadDecisionLog, traceDecisionChain } from '@sofagent/audit';
import type { AuditHistoryEntry, DecisionLogEntry } from '@sofagent/audit';

// ============================================================
// 注册用 description（供另一任务在 tool-registry 注册时直接引用）
// ============================================================

/**
 * audit_query 的注册用描述——显式声明与 audit_trail / worklog_query /
 * run_audit / ruleset_export 的边界，防读者混用。
 */
export const AUDIT_QUERY_DESCRIPTION =
  '审计数据只读查询——按时间/规则/exitCode 过滤读 history.jsonl，按 ts 查 decision-log 因果链（消费 causedBy）。'
  + '严格只读，不写任何审计链。'
  + '边界：audit_trail 按 agentId 查跨设备轨迹 / worklog_query 查工作效能指标 / '
  + 'run_audit 跑规则写 think.md（写侧）/ ruleset_export 导出规则面——本 tool 只查「时间·规则·exitCode·因果链」维度，勿混用。';

// ============================================================
// 类型定义
// ============================================================

/** 查询源：history 面 / decision 面 / 两面 */
export type AuditQuerySource = 'history' | 'decision' | 'both';

/** audit_query 入参 */
export interface AuditQueryArgs {
  /** 起始时间（ISO 8601，闭区间，含）——history 面与 decision 面通用 */
  since?: string;
  /** 结束时间（ISO 8601，闭区间，含）——history 面与 decision 面通用 */
  until?: string;
  /** 规则 id（如 'A1' / 'E1'）——匹配 history 条目的 ruleResults（id / name） */
  rule?: string;
  /** 审计退出码：0=PASS / 1=WARN / 2=FAIL */
  exitCode?: 0 | 1 | 2;
  /** 返回条数上限（默认 100，时间倒序取最新） */
  limit?: number;
  /** decision 面：查以该 ts 为【因果上游】的后继决策条目（消费 causedBy 字段） */
  causedBy?: string;
  /** 查询源（缺省按是否有 causedBy 推断：有 → decision，无 → history） */
  source?: AuditQuerySource;
  /** 数据目录覆盖（测试注入用；缺省走 SOFAGENT_DATA > data/ 解析链） */
  dataDir?: string;
}

/** audit_query 返回（text 首行必带 [sofagent] 前缀） */
export interface AuditQueryResult {
  text: string;
  data: Record<string, unknown>;
}

/** history 面单条记录（可序列化子集） */
interface HistoryRecord {
  timestamp: string;
  diffRange: string;
  exitCode: number;
  agentId?: string;
  commitSha?: string;
  diffFileCount: number;
  rules: Array<{ id?: string; name: string; number: number; status: string }>;
}

/** decision 面单条记录（可序列化子集） */
interface DecisionRecord {
  ts: string;
  agentId: string;
  sessionId: string;
  kind: string;
  moment: string;
  category?: string;
  causalType?: string;
  causedBy?: string[];
  why: { text: string; tags?: string[] };
}

// ============================================================
// 常量
// ============================================================

const VALID_SOURCES: readonly AuditQuerySource[] = ['history', 'decision', 'both'];
const VALID_EXIT_CODES: readonly number[] = [0, 1, 2];
const DEFAULT_LIMIT = 100;
/** 读取上限（= 全量读取；loadHistory 以 limit 作为读侧 slice 上限） */
const READ_ALL = Number.MAX_SAFE_INTEGER;

// ============================================================
// 辅助函数
// ============================================================

/** 目标条目是否为合法 ISO 8601 时间串 */
function isIso8601(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

/** 规则匹配：命中条目内任一 ruleResult 的 id 或 name（兼容旧条目无 id——按名称前缀） */
function ruleMatches(rule: { id?: string; name: string }, wanted: string): boolean {
  if (rule.id !== undefined && rule.id === wanted) return true;
  if (rule.name === wanted) return true;
  // 旧路径条目无 id：名称形如 "A1 不碰敏感"——按首段前缀兜底匹配
  return rule.name.startsWith(`${wanted} `);
}

/** history 条目的可序列化投影 */
function toHistoryRecord(e: AuditHistoryEntry): HistoryRecord {
  return {
    timestamp: e.timestamp,
    diffRange: e.diffRange,
    exitCode: e.exitCode,
    ...(e.agentId !== undefined ? { agentId: e.agentId } : {}),
    ...(e.commitSha !== undefined ? { commitSha: e.commitSha } : {}),
    diffFileCount: e.diffFileCount,
    rules: e.ruleResults.map((r) => ({
      ...(r.id !== undefined ? { id: r.id } : {}),
      name: r.name,
      number: r.number,
      status: r.status,
    })),
  };
}

/** decision 条目的可序列化投影 */
function toDecisionRecord(e: DecisionLogEntry): DecisionRecord {
  return {
    ts: e.ts,
    agentId: e.agentId,
    sessionId: e.sessionId,
    kind: e.kind,
    moment: e.moment,
    ...(e.category !== undefined ? { category: e.category } : {}),
    ...(e.causalType !== undefined ? { causalType: e.causalType } : {}),
    ...(e.causedBy !== undefined ? { causedBy: e.causedBy } : {}),
    why: { text: e.why.text, ...(e.why.tags !== undefined ? { tags: e.why.tags } : {}) },
  };
}

/** 过滤条件的人类可读描述 */
function describeFilter(args: AuditQueryArgs, limit: number): string {
  const parts: string[] = [];
  if (args.since !== undefined) parts.push(`since=${args.since}`);
  if (args.until !== undefined) parts.push(`until=${args.until}`);
  if (args.rule !== undefined) parts.push(`rule=${args.rule}`);
  if (args.exitCode !== undefined) parts.push(`exitCode=${args.exitCode}`);
  if (args.causedBy !== undefined) parts.push(`causedBy=${args.causedBy}`);
  parts.push(`limit=${limit}`);
  return parts.join(' · ');
}

/**
 * 参数校验——返回错误描述（无错时返回 null）。
 *
 * 非法时间格式 / 非法 exitCode / 非法 source / 非法 limit / 非法组合
 * 一律给出明确错误，由主函数转成结构化错误返回（不抛未捕获异常）。
 */
function validateArgs(args: AuditQueryArgs): string | null {
  if (args.since !== undefined && !isIso8601(args.since)) {
    return `非法 since「${String(args.since)}」——须为 ISO 8601 时间串（如 2026-09-20T00:00:00.000Z）`;
  }
  if (args.until !== undefined && !isIso8601(args.until)) {
    return `非法 until「${String(args.until)}」——须为 ISO 8601 时间串`;
  }
  if (args.since !== undefined && args.until !== undefined && args.since > args.until) {
    return `非法时间区间——since（${args.since}）晚于 until（${args.until}）`;
  }
  if (args.exitCode !== undefined && !VALID_EXIT_CODES.includes(args.exitCode)) {
    return `非法 exitCode「${String(args.exitCode)}」——仅支持 0（PASS）/ 1（WARN）/ 2（FAIL）`;
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    return `非法 limit「${String(args.limit)}」——须为正整数`;
  }
  if (args.source !== undefined && !VALID_SOURCES.includes(args.source)) {
    return `非法 source「${String(args.source)}」——仅支持 history / decision / both`;
  }
  if (args.rule !== undefined && (typeof args.rule !== 'string' || args.rule.trim() === '')) {
    return '非法 rule——须为非空字符串（规则 id，如 A1 / E1）';
  }
  if (args.causedBy !== undefined && (typeof args.causedBy !== 'string' || args.causedBy.trim() === '')) {
    return '非法 causedBy——须为非空字符串（因果上游条目的 ts）';
  }
  if (args.source === 'history' && args.causedBy !== undefined) {
    return 'source=history 与 causedBy 冲突——causedBy 仅适用于 decision / both 源';
  }
  return null;
}

// ============================================================
// history 面查询
// ============================================================

interface HistoryQueryResult {
  matched: number;
  returned: number;
  records: HistoryRecord[];
}

/**
 * history 面：读 history.jsonl（只读原语 loadHistory）并按
 * 时间 / 规则 / exitCode 三维过滤。
 *
 * 说明：底层已 @public 的 reduceAuditHistory 承载「时间 + 规则 + 聚合」，
 * 但**不含 exitCode 维度**且会读侧 slice(limit)——无法直接承载本
 * 验收要求的 exitCode 过滤；本任务不改 audit 包（边界纪律），故此处
 * 复用其同一读原语 loadHistory，叠加 exitCode 维后自行过滤。
 */
function queryHistory(args: AuditQueryArgs, limit: number): HistoryQueryResult {
  const entries = loadHistory(READ_ALL, args.dataDir);
  const matched = entries.filter((e) => {
    if (args.since !== undefined && e.timestamp < args.since) return false;
    if (args.until !== undefined && e.timestamp > args.until) return false;
    if (args.exitCode !== undefined && e.exitCode !== args.exitCode) return false;
    if (args.rule !== undefined && !e.ruleResults.some((r) => ruleMatches(r, args.rule as string))) return false;
    return true;
  });
  // loadHistory 已按时间倒序——取最新 limit 条
  const returned = matched.slice(0, limit);
  return { matched: matched.length, returned: returned.length, records: returned.map(toHistoryRecord) };
}

// ============================================================
// decision 面查询（含因果链）
// ============================================================

interface DecisionQueryResult {
  matched: number;
  returned: number;
  records: DecisionRecord[];
  chain?: { root: string; length: number; narrative: string; brokenAt?: string };
}

/**
 * decision 面：读 decision-log.jsonl（只读原语 loadDecisionLog）并按
 * 时间 / causedBy（因果上游）过滤；causedBy 存在时复用 traceDecisionChain
 * 输出以该 ts 为起点的上溯链叙事。
 */
function queryDecision(args: AuditQueryArgs, limit: number): DecisionQueryResult {
  const entries = loadDecisionLog(args.dataDir);
  const matched = entries
    .filter((e) => {
      if (args.since !== undefined && e.ts < args.since) return false;
      if (args.until !== undefined && e.ts > args.until) return false;
      if (args.causedBy !== undefined && !(e.causedBy ?? []).includes(args.causedBy)) return false;
      return true;
    })
    .sort((a, b) => b.ts.localeCompare(a.ts)); // 时间倒序
  const returned = matched.slice(0, limit);

  let chain: DecisionQueryResult['chain'];
  if (args.causedBy !== undefined) {
    const traced = traceDecisionChain(args.causedBy, args.dataDir);
    if (traced) {
      chain = {
        root: args.causedBy,
        length: traced.chain.length,
        narrative: traced.narrative,
        ...(traced.brokenAt !== undefined ? { brokenAt: traced.brokenAt } : {}),
      };
    }
  }

  return {
    matched: matched.length,
    returned: returned.length,
    records: returned.map(toDecisionRecord),
    ...(chain !== undefined ? { chain } : {}),
  };
}

// ============================================================
// 文本视图
// ============================================================

function renderHistoryLines(h: HistoryQueryResult): string[] {
  const lines: string[] = [];
  if (h.matched === 0) {
    lines.push('（history 无匹配记录——可放宽 since/until/rule/exitCode 条件后重试）');
    return lines;
  }
  lines.push(`history 命中 ${h.matched} 条（时间倒序，返回前 ${h.returned} 条）:`);
  for (const r of h.records) {
    const rules = r.rules.map((x) => `${x.id ?? x.name}:${x.status}`).join(',');
    lines.push(
      `  - [${r.timestamp}] ${r.diffRange} exit=${r.exitCode} files=${r.diffFileCount}`
      + `${r.agentId !== undefined ? ` agent=${r.agentId}` : ''}`
      + `${rules !== '' ? ` 规则=${rules}` : ''}`,
    );
  }
  return lines;
}

function renderDecisionLines(d: DecisionQueryResult): string[] {
  const lines: string[] = [];
  if (d.matched === 0) {
    lines.push('（decision 无匹配条目——可放宽 since/until/causedBy 条件后重试）');
  } else {
    lines.push(`decision 命中 ${d.matched} 条（时间倒序，返回前 ${d.returned} 条）:`);
    for (const r of d.records) {
      const edge = r.causalType !== undefined ? `（${r.causalType}）` : '';
      const up = r.causedBy !== undefined && r.causedBy.length > 0 ? `  ← causedBy ${r.causedBy.join(',')}` : '';
      lines.push(`  - [${r.ts}] ${r.kind}/${r.moment}${edge}：${r.why.text}${up}`);
    }
  }
  if (d.chain !== undefined) {
    lines.push(`因果链（上溯起点 ${d.chain.root}，共 ${d.chain.length} 节点）:`);
    lines.push(d.chain.narrative);
    if (d.chain.brokenAt !== undefined) lines.push(`  ⚠ ${d.chain.brokenAt}`);
  }
  return lines;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 审计数据只读查询（MCP audit_query 业务实现）。
 *
 * 严格只读：全程只调用 loadHistory / loadDecisionLog / traceDecisionChain
 * 三个读原语，不出现任何链写入调用。
 *
 * @param args 查询参数（缺省 = source 推断为 history、limit 100）
 * @returns { text, data }——text 首行带 [sofagent] 前缀；错误走 data.isError
 */
export async function auditQuery(
  args: AuditQueryArgs = {},
): Promise<{ text: string; data: Record<string, unknown> }> {
  // ── 参数校验（先于任何 IO）──
  const invalid = validateArgs(args);
  if (invalid !== null) {
    return {
      text: `[sofagent] audit_query 参数错误：${invalid}`,
      data: { isError: true, error: invalid },
    };
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  // 缺省源推断：带 causedBy → decision 面；否则 → history 面
  const source: AuditQuerySource = args.source ?? (args.causedBy !== undefined ? 'decision' : 'history');

  try {
    const data: Record<string, unknown> = {
      source,
      filter: {
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(args.until !== undefined ? { until: args.until } : {}),
        ...(args.rule !== undefined ? { rule: args.rule } : {}),
        ...(args.exitCode !== undefined ? { exitCode: args.exitCode } : {}),
        ...(args.causedBy !== undefined ? { causedBy: args.causedBy } : {}),
        limit,
      },
      isError: false,
    };
    const lines: string[] = [
      `[sofagent] audit_query（source=${source}）过滤：${describeFilter(args, limit)}`,
    ];

    if (source === 'history' || source === 'both') {
      const h = queryHistory(args, limit);
      data.history = h;
      lines.push(...renderHistoryLines(h));
    }

    if (source === 'decision' || source === 'both') {
      const d = queryDecision(args, limit);
      data.decision = d;
      lines.push(...renderDecisionLines(d));
    }

    return { text: lines.join('\n'), data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] audit_query 查询失败：${msg}`,
      data: { isError: true, error: msg },
    };
  }
}
