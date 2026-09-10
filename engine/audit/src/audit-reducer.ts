// ============================================================
// audit-reducer.ts · 审计留痕规约层 + PROV-O 导出（章十）
// ============================================================
//
// 双层留痕架构的读侧扩展（写路径 append-only 不动）：
//   规约层：按 agent / 时间 / 规则三维聚合 audit history——
//           大规模记录收敛为可查询的统计视图
//   导出层：PROV-O（W3C provenance ontology）薄出口——
//           Turtle / JSON-LD 两种格式
//
// 设计约束：
//   - 纯读零写入——只消费 loadHistory() 既有读路径
//   - 薄出口——PROV-O 只映射核心实体（Activity/Agent/Entity），
//     不追求全本体覆盖；不破坏主链（history.jsonl 不动）
//   - audit_query 查询面（MCP tool 消费——三维过滤）
// ============================================================

import { loadHistory } from './audit-history';

// ────────────────────────────────────────────────────────────
// 规约层：三维聚合
// ────────────────────────────────────────────────────────────

/** 查询过滤条件（三维：agent / 时间 / 规则） */
export interface AuditQueryFilter {
  /** agent 维度过滤（agentId 精确匹配） */
  agentId?: string;
  /** 起始时间（ISO 8601，含） */
  since?: string;
  /** 结束时间（ISO 8601，含） */
  until?: string;
  /** 规则维度过滤（规则名精确匹配——命中条目内任一 ruleResult） */
  ruleName?: string;
  /** 读入上限（缺省 1000——loadHistory 单次上限） */
  limit?: number;
  /** 数据目录（缺省走 getHistoryFilePath 解析链） */
  dataDir?: string;
}

/** 单 agent 聚合行 */
export interface AgentRollupRow {
  agentId: string;
  /** 记录条数 */
  records: number;
  /** PASS 条数（exitCode=0） */
  passes: number;
  /** WARN 条数（exitCode=1） */
  warns: number;
  /** FAIL 条数（exitCode=2） */
  fails: number;
  /** 涉及文件变更总数（diffFileCount 求和） */
  filesChanged: number;
}

/** 规则命中聚合行 */
export interface RuleRollupRow {
  ruleName: string;
  /** 命中总次数（跨记录） */
  hits: number;
  /** FAIL 次数 */
  fails: number;
  /** WARN 次数 */
  warns: number;
}

/** 规约结果（两维度 + 明细引用） */
export interface AuditReducedReport {
  /** 过滤条件回显（不含 dataDir） */
  filter: Omit<AuditQueryFilter, 'dataDir'>;
  /** 命中记录数 */
  matched: number;
  /** 按 agent 聚合（records 降序） */
  byAgent: AgentRollupRow[];
  /** 按规则聚合（hits 降序） */
  byRule: RuleRollupRow[];
  /** 命中记录的引用清单（timestamp + exitCode——供追溯原记录） */
  refs: Array<{ timestamp: string; exitCode: number }>;
}

/**
 * audit_query 查询面——三维过滤 + 双维度聚合。
 *
 * 语义：agentId/ruleName 精确匹配、since/until 闭区间、
 * 多条件 AND。零命中返回空报表（不报错）。
 */
export function reduceAuditHistory(filter: AuditQueryFilter = {}): AuditReducedReport {
  const limit = filter.limit ?? 1000;
  const all = loadHistory(limit, filter.dataDir);

  const matched = all.filter((e) => {
    if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
    if (filter.since !== undefined && e.timestamp < filter.since) return false;
    if (filter.until !== undefined && e.timestamp > filter.until) return false;
    if (
      filter.ruleName !== undefined &&
      !e.ruleResults.some((r) => r.name === filter.ruleName)
    ) {
      return false;
    }
    return true;
  });

  // 按 agent 聚合
  const agentMap = new Map<string, AgentRollupRow>();
  for (const e of matched) {
    const id = e.agentId ?? '(未标注)';
    let row = agentMap.get(id);
    if (!row) {
      row = { agentId: id, records: 0, passes: 0, warns: 0, fails: 0, filesChanged: 0 };
      agentMap.set(id, row);
    }
    row.records += 1;
    if (e.exitCode === 0) row.passes += 1;
    else if (e.exitCode === 1) row.warns += 1;
    else if (e.exitCode === 2) row.fails += 1;
    row.filesChanged += e.diffFileCount;
  }

  // 按规则聚合
  const ruleMap = new Map<string, RuleRollupRow>();
  for (const e of matched) {
    for (const r of e.ruleResults) {
      if (filter.ruleName !== undefined && r.name !== filter.ruleName) continue;
      let row = ruleMap.get(r.name);
      if (!row) {
        row = { ruleName: r.name, hits: 0, fails: 0, warns: 0 };
        ruleMap.set(r.name, row);
      }
      row.hits += 1;
      if (r.status === 'FAIL') row.fails += 1;
      else if (r.status === 'WARN') row.warns += 1;
    }
  }

  const { dataDir: _omit, ...filterEcho } = filter;
  return {
    filter: filterEcho,
    matched: matched.length,
    byAgent: [...agentMap.values()].sort((a, b) => b.records - a.records),
    byRule: [...ruleMap.values()].sort((a, b) => b.hits - a.hits),
    refs: matched.map((e) => ({ timestamp: e.timestamp, exitCode: e.exitCode })),
  };
}

// ────────────────────────────────────────────────────────────
// PROV-O 导出层（薄出口）
// ────────────────────────────────────────────────────────────

/** PROV-O 前缀绑定（Turtle 格式用） */
const PROV_PREFIXES =
  '@prefix prov: <http://www.w3.org/ns/prov#> .\n' +
  '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n' +
  '@prefix sofagent: <https://sofagent.dev/ns/> .\n';

/** 单条记录的 PROV-O 本地 IRI 生成（timestamp 做去重后缀） */
function provIri(prefix: string, key: string, ts?: string): string {
  const safe = key.replace(/[^A-Za-z0-9_-]/g, '_');
  return ts ? `${prefix}_${safe}_${ts.replace(/[^0-9]/g, '')}` : `${prefix}_${safe}`;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * PROV-O Turtle 导出（薄出口）。
 *
 * 映射：audit 记录 → prov:Activity；agentId → prov:Agent（经
 * prov:wasAssociatedWith）；commitSha/diffRange → prov:Entity
 * （经 prov:used / prov:generates 的简化——只挂 used）。
 */
export function exportProvTurtle(
  filter: AuditQueryFilter = {},
): string {
  const report = reduceAuditHistory(filter);
  const lines: string[] = [PROV_PREFIXES];

  for (const row of report.byAgent) {
    lines.push(`sofagent:${provIri('agent', row.agentId)} a prov:Agent ;`);
    lines.push(`    sofagent:agentId "${esc(row.agentId)}" .`);
  }

  for (const ref of report.refs) {
    const act = provIri('audit', String(ref.exitCode), ref.timestamp);
    lines.push(`sofagent:${act} a prov:Activity ;`);
    lines.push(`    prov:startedAtTime "${ref.timestamp}"^^xsd:dateTime .`);
  }

  if (report.matched === 0) {
    lines.push('# （过滤条件下零命中——空导出）');
  }
  return lines.join('\n') + '\n';
}

/**
 * PROV-O JSON-LD 导出（薄出口）。
 *
 * 与 Turtle 同源（同一规约结果），context 固定 prov 命名空间。
 */
export function exportProvJsonLd(filter: AuditQueryFilter = {}): string {
  const report = reduceAuditHistory(filter);
  const doc = {
    '@context': {
      prov: 'http://www.w3.org/ns/prov#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      sofagent: 'https://sofagent.dev/ns/',
    },
    '@graph': [
      ...report.byAgent.map((row) => ({
        '@id': `sofagent:${provIri('agent', row.agentId)}`,
        '@type': 'prov:Agent',
        'sofagent:agentId': row.agentId,
        'sofagent:records': row.records,
        'sofagent:fails': row.fails,
      })),
      ...report.refs.map((ref) => ({
        '@id': `sofagent:${provIri('audit', String(ref.exitCode), ref.timestamp)}`,
        '@type': 'prov:Activity',
        'prov:startedAtTime': { '@value': ref.timestamp, '@type': 'xsd:dateTime' },
      })),
    ],
  };
  return JSON.stringify(doc, null, 2);
}
