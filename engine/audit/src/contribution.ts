// ============================================================
// contribution.ts · 贡献度聚合（G4 绩效数据导出）
// ============================================================
//
// 人/数字员工同标准的绩效信号聚合——三数据源：
//   ① PR 元数据（pr-store：贡献者/权重/合并数）
//   ② decision-log（决策留痕量——负样本信号单独计）
//   ③ audit history（git diff 审计记录——变更规模信号）
//
// 同标准语义：contributor_id 不区分人/数字员工（userId 与
// agentId 同字段位），聚合口径一致——「数字员工绩效与人类员工
// 同一张报表」（麦肯锡数字员工绩效信号的同标准要求）。
//
// org 过滤（与 G7 联动）：orgId 经 resolveTenantDataDir 定位
// 数据分区——跨租户数据天然隔离（各租户读各自 dataDir，物理
// 分区即权限边界），不做跨租户聚合。
//
// 纯读零写入——不产生任何副作用，不挂审计（查询面）。
// ============================================================

import { loadHistory } from './audit-history';
import { loadDecisionLog } from './decision-query';
import { listPrs, type StoredPr } from './pr-store';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 单贡献者聚合行（按人维度） */
export interface ContributorRow {
  /** 贡献者标识（userId / agentId——同标准） */
  contributor_id: string;
  /** 合并 PR 数（status=merged 的 PR 中该贡献者参与的条数） */
  merged_prs: number;
  /** 权重分（该贡献者在全部 merged PR 中的权重之和） */
  weight_score: number;
  /** 决策留痕量（decision-log 中 agentId=该贡献者的条数） */
  decisions: number;
  /** 负样本量（kind=BLOCK 类留痕——训练信号） */
  negative_signals: number;
  /** 审计变更规模（audit history 中 agentId 匹配的记录 diffFileCount 之和） */
  audit_files: number;
  /** 综合贡献分 = weight_score×2 + decisions×0.1 + audit_files×0.05（merged 主导） */
  contribution_score: number;
}

/** 单 workflow 聚合行（按 workflow 维度） */
export interface WorkflowRow {
  /** workflow 标识 */
  workflow_id: string;
  /** 合并 PR 数 */
  merged_prs: number;
  /** 参与贡献者数（去重） */
  contributors: number;
  /** 权重总分 */
  weight_score: number;
  /** 综合贡献分合计 */
  contribution_score: number;
  /** 贡献者明细（contributor_id + score，降序） */
  breakdown: Array<{ contributor_id: string; contribution_score: number }>;
}

/** 聚合结果（两维度输出） */
export interface ContributionReport {
  /** 按人（降序——contribution_score 降序） */
  byContributor: ContributorRow[];
  /** 按 workflow（降序） */
  byWorkflow: WorkflowRow[];
  /** 统计窗口 */
  windowDays: number;
  /** 参与 PR 数（窗口内） */
  totalPrs: number;
  /** 合并 PR 数（窗口内） */
  mergedPrs: number;
}

// ────────────────────────────────────────────────────────────
// 聚合实现
// ────────────────────────────────────────────────────────────

/**
 * 系统簿记前缀——这些 agentId 是 pr-store / workflow-crud 等基础设施
 * 写审计留痕用的系统标识（状态迁移簿记），不是真实贡献者（人/数字员工），
 * 聚合时整体排除（decisions 与 negative_signals 均不计）。
 */
const SYSTEM_AGENT_PREFIXES = ['sofagent-pr-store-', 'sofagent-workflow-crud-'];

function isSystemAgent(agentId: string): boolean {
  return SYSTEM_AGENT_PREFIXES.some((p) => agentId.startsWith(p));
}

/** 负样本 kind 判定（对齐 DecisionKind 枚举——PR reject 留痕走 ORCHESTRATION+why 标记） */
function isNegativeSignal(e: { kind: string; why?: unknown }): boolean {
  if (e.kind === 'ESCALATE_REPORT' || e.kind === 'FALLBACK_DEGRADE') return true;
  if (e.kind === 'ORCHESTRATION' && typeof e.why === 'string' && e.why.includes('负样本')) return true;
  return false;
}

/** ISO 时间窗口过滤 */
function withinWindow(iso: string, sinceMs: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= sinceMs;
}

/**
 * 贡献度聚合主入口。
 *
 * @param dataDir 数据根目录（G7：orgId 经 resolveTenantDataDir 解析后的分区路径）
 * @param options.windowDays 统计窗口天数（缺省 30）
 */
export function aggregateContributions(
  dataDir: string,
  options?: { windowDays?: number },
): ContributionReport {
  const windowDays = options?.windowDays ?? 30;
  const sinceMs = Date.now() - windowDays * 24 * 3600 * 1000;

  // ── 数据源 ①：PR 元数据 ──
  const prs = listPrs(dataDir).filter((p) => withinWindow(p.createdAt, sinceMs));
  const merged = prs.filter((p) => p.status === 'merged');

  // ── 数据源 ②③：decision-log + audit history ──
  const decisions = loadDecisionLog(dataDir).filter((e) => withinWindow(e.ts, sinceMs));
  // 窗口=30 天（缺省）且 loadHistory 默认 100 条封顶——超出的早期条目静默截断，
  // 聚合基数可能偏小（见 devlog 章二已知局限）。
  const histories = loadHistory(undefined, dataDir).filter((e) => withinWindow(e.timestamp, sinceMs));

  // 按贡献者聚合（同标准——userId/agentId 同字段位）
  const byContributor = new Map<string, ContributorRow>();
  const ensure = (id: string): ContributorRow => {
    let row = byContributor.get(id);
    if (!row) {
      row = {
        contributor_id: id,
        merged_prs: 0,
        weight_score: 0,
        decisions: 0,
        negative_signals: 0,
        audit_files: 0,
        contribution_score: 0,
      };
      byContributor.set(id, row);
    }
    return row;
  };

  for (const pr of merged) {
    for (const c of pr.contributors) {
      const row = ensure(c.contributor_id);
      row.merged_prs += 1;
      row.weight_score += c.weight;
    }
  }
  for (const d of decisions) {
    if (isSystemAgent(d.agentId)) continue; // 系统簿记不计贡献
    const row = ensure(d.agentId);
    row.decisions += 1;
    if (isNegativeSignal(d)) row.negative_signals += 1;
  }
  for (const h of histories) {
    if (!h.agentId || isSystemAgent(h.agentId)) continue;
    const row = ensure(h.agentId);
    row.audit_files += h.diffFileCount;
  }

  // 综合分
  for (const row of byContributor.values()) {
    row.contribution_score = round2(
      row.weight_score * 2 + row.decisions * 0.1 + row.audit_files * 0.05,
    );
  }

  // 按 workflow 聚合
  const byWorkflow = new Map<string, WorkflowRow>();
  for (const pr of merged) {
    let wf = byWorkflow.get(pr.workflow_id);
    if (!wf) {
      wf = {
        workflow_id: pr.workflow_id,
        merged_prs: 0,
        contributors: 0,
        weight_score: 0,
        contribution_score: 0,
        breakdown: [],
      };
      byWorkflow.set(pr.workflow_id, wf);
    }
    wf.merged_prs += 1;
    wf.contributors += pr.contributors.length;
    wf.weight_score += pr.contributors.reduce((s, c) => s + c.weight, 0);
    for (const c of pr.contributors) {
      const row = byContributor.get(c.contributor_id);
      if (row) wf.breakdown.push({ contributor_id: c.contributor_id, contribution_score: row.contribution_score });
    }
  }
  for (const wf of byWorkflow.values()) {
    // 同贡献者跨 PR 合并分数
    const merged2 = new Map<string, number>();
    for (const b of wf.breakdown) merged2.set(b.contributor_id, (merged2.get(b.contributor_id) ?? 0) + b.contribution_score);
    wf.breakdown = [...merged2.entries()]
      .map(([contributor_id, contribution_score]) => ({ contributor_id, contribution_score: round2(contribution_score) }))
      .sort((a, b) => b.contribution_score - a.contribution_score);
    wf.contributors = wf.breakdown.length;
    wf.contribution_score = round2(wf.breakdown.reduce((s, b) => s + b.contribution_score, 0));
  }

  return {
    byContributor: [...byContributor.values()].sort((a, b) => b.contribution_score - a.contribution_score),
    byWorkflow: [...byWorkflow.values()].sort((a, b) => b.contribution_score - a.contribution_score),
    windowDays,
    totalPrs: prs.length,
    mergedPrs: merged.length,
  };
}

/** 保留两位小数（浮点显示层） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** PR 列表读取（供 MCP tool 附加明细输出） */
export function prOverview(dataDir: string): Array<Pick<StoredPr, 'id' | 'workflow_id' | 'status' | 'submitter' | 'createdAt'>> {
  return listPrs(dataDir).map((p) => ({
    id: p.id,
    workflow_id: p.workflow_id,
    status: p.status,
    submitter: p.submitter,
    createdAt: p.createdAt,
  }));
}
