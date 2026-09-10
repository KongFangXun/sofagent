// contribution-query.ts · MCP tool：contribution_query（G4 绩效数据导出）
// 人/数字员工同标准贡献度查询——委托 @sofagent/audit 的 aggregateContributions

export interface ContributionQueryResult {
  text: string;
  data: {
    isError: boolean;
    /** 按人聚合（降序） */
    byContributor: Array<{
      contributor_id: string;
      merged_prs: number;
      weight_score: number;
      decisions: number;
      negative_signals: number;
      audit_files: number;
      contribution_score: number;
    }>;
    /** 按 workflow 聚合（降序） */
    byWorkflow: Array<{
      workflow_id: string;
      merged_prs: number;
      contributors: number;
      weight_score: number;
      contribution_score: number;
      breakdown: Array<{ contributor_id: string; contribution_score: number }>;
    }>;
    windowDays: number;
    totalPrs: number;
    mergedPrs: number;
    orgId?: string;
  };
}

export async function contributionQuery(args: Record<string, unknown>): Promise<ContributionQueryResult> {
  const explicit = typeof args.data_dir === 'string' ? args.data_dir : undefined;
  const orgId = typeof args.org_id === 'string' ? args.org_id : undefined;
  const windowDays = typeof args.window_days === 'number' ? args.window_days : undefined;

  // G7 联动：orgId 经 resolveTenantDataDir 定位租户分区（跨租户物理隔离）
  let dataDir: string;
  if (explicit) {
    dataDir = explicit;
  } else {
    const { resolveTenantDataDir } = await import('@sofagent/core');
    dataDir = resolveTenantDataDir(orgId);
  }

  const { aggregateContributions } = await import('@sofagent/audit');
  const report = aggregateContributions(dataDir, windowDays !== undefined ? { windowDays } : undefined);

  const lines: string[] = [];
  lines.push(`[sofagent] 📊 贡献度报表（窗口 ${report.windowDays} 天 · PR ${report.totalPrs} 条 / merged ${report.mergedPrs} 条${orgId ? ` · org=${orgId}` : ''}）`);
  if (report.byContributor.length === 0) {
    lines.push('（窗口内无贡献记录——需先经 pr_submit/pr_merge 产生 PR 数据）');
  } else {
    lines.push('按贡献者（人/数字员工同标准）：');
    for (const r of report.byContributor) {
      lines.push(`  ${r.contributor_id} · merged=${r.merged_prs} · 权重分=${r.weight_score} · 决策=${r.decisions} · 负样本=${r.negative_signals} · 审计文件=${r.audit_files} → 综合分 ${r.contribution_score}`);
    }
    lines.push('按 workflow：');
    for (const w of report.byWorkflow) {
      lines.push(`  ${w.workflow_id} · merged=${w.merged_prs} · 贡献者=${w.contributors} → 总分 ${w.contribution_score}`);
    }
  }

  return {
    text: lines.join('\n'),
    data: { isError: false, ...report, orgId },
  };
}
