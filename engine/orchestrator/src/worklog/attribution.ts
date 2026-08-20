// ============================================================
// attribution.ts · ATTRIBUTION 归因引擎（P2 · v1.3.9 十）
// ============================================================
// 审计决策 → 业务指标的因果链追踪。
// 依赖：v1.3.1 跨设备审计聚合（decision-log 的 agentId 归因）+
//       本版三（worklog 工作明细数据层——归因记录可关联 worklog 任务）。
//
// 因果链数据结构：{ decision_id, business_metric, delta, confidence, timestamp }
// 语义：decision_id 指向 decisions.jsonl 的一条决策（因）；
//       business_metric + delta 描述该决策对业务指标的影响（果）；
//       confidence ∈ [0,1]——归因置信度（1=实测因果，<1=推断因果）。
// ============================================================

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

/** 因果链单条记录 */
export interface AttributionLink {
  /** 指向 decisions.jsonl 的决策标识（decision_id 或可回查的键） */
  decision_id: string;
  /** 业务指标名（如 deploy_success_rate / manual_review_hours） */
  business_metric: string;
  /** 指标变化量（正=改善，负=恶化） */
  delta: number;
  /** 归因置信度 [0,1]（1=实测因果；<1=推断） */
  confidence: number;
  /** 记录时间戳 */
  timestamp: string;
  /** 关联任务（可选——worklog taskId 关联） */
  task_id?: string;
}

/** 归因查询过滤 */
export interface AttributionQuery {
  metric?: string;
  decisionId?: string;
  agentId?: string;
}

/**
 * 归因引擎——因果链登记 + 查询 + 周报 Top 5。
 * 落盘 data/dashboard/attribution.jsonl（append-only，与 worklog.json 同目录）。
 */
export class AttributionEngine {
  private readonly dataDir: string;
  private readonly links: AttributionLink[] = [];
  /** decision_id → agentId 映射（从 decision-log 读取，查询用） */
  private readonly decisionAgents = new Map<string, string>();

  constructor(options: { dataDir?: string; decisionLog?: Array<{ id?: string; agentId?: string; decisionId?: string }> } = {}) {
    this.dataDir = options.dataDir ?? process.env.SOFAGENT_DATA ?? 'data';
    // 决策→agent 映射（注入或读 decision-log.jsonl）
    const decisions: Array<{ id?: string; agentId?: string; decisionId?: string }> =
      options.decisionLog ?? this.readDecisionLog();
    for (const d of decisions) {
      const id = d.id ?? d.decisionId;
      if (id && d.agentId) this.decisionAgents.set(id, d.agentId);
    }
    // 既有因果链回放
    for (const l of this.readLinksFile()) this.links.push(l);
  }

  /** 登记一条因果链（追加落盘 + 内存） */
  link(input: Omit<AttributionLink, 'timestamp'> & { timestamp?: string }): AttributionLink {
    if (input.confidence < 0 || input.confidence > 1) {
      throw new Error(`confidence 必须在 [0,1]：${input.confidence}`);
    }
    const entry: AttributionLink = { ...input, timestamp: input.timestamp ?? new Date().toISOString() };
    this.links.push(entry);
    const dir = join(this.dataDir, 'dashboard');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'attribution.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  }

  /** 归因查询（按 metric / decision / agentId 过滤） */
  query(filter: AttributionQuery = {}): AttributionLink[] {
    let out = this.links;
    if (filter.metric) out = out.filter((l) => l.business_metric === filter.metric);
    if (filter.decisionId) out = out.filter((l) => l.decision_id === filter.decisionId);
    if (filter.agentId) {
      out = out.filter((l) => this.decisionAgents.get(l.decision_id) === filter.agentId);
    }
    return [...out].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }

  /** 周报 Top 5 高影响决策（|delta| × confidence 排序） */
  topImpact(n = 5): AttributionLink[] {
    return [...this.links]
      .sort((a, b) => Math.abs(b.delta) * b.confidence - Math.abs(a.delta) * a.confidence)
      .slice(0, n);
  }

  /** 周报 Top 5 低效决策（delta 为负 + 低置信度优先——最值得复核的归因） */
  topInefficient(n = 5): AttributionLink[] {
    return [...this.links]
      .filter((l) => l.delta < 0)
      .sort((a, b) => a.delta * a.confidence - b.delta * b.confidence)
      .slice(0, n);
  }

  /** 决策关联查询：某 agent 的全部因果链（工作明细 × 归因的联结面） */
  byAgent(agentId: string): AttributionLink[] {
    return this.query({ agentId });
  }

  // ── 内部 ──

  private readDecisionLog(): Array<{ id?: string; agentId?: string }> {
    const p = join(this.dataDir, 'audit', 'decision-log.jsonl');
    if (!existsSync(p)) return [];
    try {
      return readFileSync(p, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id?: string; agentId?: string; decisionId?: string });
    } catch {
      return [];
    }
  }

  private readLinksFile(): AttributionLink[] {
    const p = join(this.dataDir, 'dashboard', 'attribution.jsonl');
    if (!existsSync(p)) return [];
    try {
      return readFileSync(p, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AttributionLink);
    } catch {
      return [];
    }
  }
}
