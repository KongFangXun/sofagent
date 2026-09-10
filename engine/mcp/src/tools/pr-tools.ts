// ============================================================
// pr-tools.ts · MCP tools：PR 生命周期三 tool（G13）
// ============================================================
//
// pr_submit / pr_review / pr_merge——委托 @sofagent/audit 的 pr-store
// 状态机（open → reviewed → merged/rejected）。
// PR 元数据（贡献者/权重）供 G4 contribution_query 消费。
// ============================================================

import type { PrResult } from '@sofagent/audit';

async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}

export async function prSubmit(args: Record<string, unknown>): Promise<PrResult> {
  const { prSubmit } = await import('@sofagent/audit');
  return prSubmit(
    {
      pr_id: args.pr_id as string,
      workflow_id: args.workflow_id as string,
      title: args.title as string,
      submitter: args.submitter as string,
      ...(Array.isArray(args.contributors)
        ? { contributors: args.contributors as Array<{ contributor_id: string; weight: number }> }
        : {}),
      ...(Array.isArray(args.merge_criteria)
        ? { merge_criteria: args.merge_criteria as Array<{ kind: string; detail?: string }> }
        : {}),
      ...(args.trigger && typeof args.trigger === 'object'
        ? {
            trigger: args.trigger as {
              source: string;
              confidence: 'suggested' | 'confirmed';
            },
          }
        : {}),
    },
    await resolveDataDir(args.data_dir as string | undefined),
  );
}

export async function prReview(args: Record<string, unknown>): Promise<PrResult> {
  const { prReview } = await import('@sofagent/audit');
  return prReview(
    {
      pr_id: args.pr_id as string,
      reviewer: args.reviewer as string,
      verdict: args.verdict === 'reject' ? 'reject' : 'approve',
      ...(typeof args.note === 'string' ? { note: args.note } : {}),
    },
    await resolveDataDir(args.data_dir as string | undefined),
  );
}

export async function prMerge(args: Record<string, unknown>): Promise<PrResult> {
  const { prMerge } = await import('@sofagent/audit');
  return prMerge(
    {
      pr_id: args.pr_id as string,
      actor: args.actor as string,
      ...(args.human_confirmed === true ? { human_confirmed: true } : {}),
    },
    await resolveDataDir(args.data_dir as string | undefined),
  );
}
