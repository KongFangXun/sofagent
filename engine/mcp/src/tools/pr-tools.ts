// ============================================================
// pr-tools.ts · MCP tools：PR 生命周期三 tool（G13）
// ============================================================
//
// pr_submit / pr_review / pr_merge——委托 @sofagent/audit 的 pr-store
// 状态机（open → reviewed → merged/rejected）。
// PR 元数据（贡献者/权重）供 G4 contribution_query 消费。
//
// pr_merge 是编排态：audit prMerge 成功后联动 orchestrator
// workflowMergeBranch（branch→trunk 写回）——branch 不存在不算失败
// （PR 不带 branch 改动）；写回失败则 prRevertToOpen 回滚 PR。
// ============================================================

import type { PrResult } from '@sofagent/audit';

async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}

export async function prSubmit(args: Record<string, unknown>): Promise<PrResult> {
  const { prSubmit } = await import('@sofagent/audit');
  const dataDir = await resolveDataDir(args.data_dir as string | undefined);

  // ── v1.5.1 章二挂载点：AI 节点产出 PR 时强制附决策解释块（引 decision-log 因果链）──
  // PR 无独立 body 字段——变更描述（title）即 PR 的人读正文载体，解释块以
  // 分隔线追加在正文末尾，保证 pr-store 记录本身自带「为什么这么做」。
  // 既有入参映射、校验、注册流程保持原样（只改 title 的组装）。
  let title = args.title as string;
  let explanationNote: string;
  const built = await buildExplanation(args, dataDir);
  if (built.ok) {
    title = built.title;
    explanationNote = `\n[sofagent] 📎 已附决策解释块（引 ${built.explanation.citedDecisions} 条相关决策 / ${built.explanation.causalChains} 条因果链）——见 PR 变更描述`;
  } else {
    // 解释块生成不可用：如实标注（不静默）——PR 仍可提交，但缺口可见
    explanationNote = `\n[sofagent] ⚠️ 决策解释块未附（生成不可用：${built.reason}）——PR 已提交，理由面留缺口`;
  }

  const result = prSubmit(
    {
      pr_id: args.pr_id as string,
      workflow_id: args.workflow_id as string,
      title,
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
    dataDir,
  );
  // 提交失败（缺参/重名等）不追加解释块指引——避免错误文本里出现「已附」
  if (result.data.isError) return result;
  return { ...result, text: `${result.text}${explanationNote}` };
}

/** 解释块生成结果（ok=false 时带降级原因——调用方据此如实标注） */
type ExplanationOutcome =
  | { ok: true; title: string; explanation: import('@sofagent/orchestrator').PrExplanation }
  | { ok: false; reason: string };

/**
 * 生成决策解释块并组装 PR 变更描述（best-effort：解释面是质量增量，
 * 不阻断 PR 提交流程）。失败原因**回传调用方**并由其在返回文本中标注
 * ——不静默吞错。
 */
async function buildExplanation(
  args: Record<string, unknown>,
  dataDir: string,
): Promise<ExplanationOutcome> {
  try {
    const { buildPrDecisionExplanation, composePrBodyWithExplanation } = await import(
      '@sofagent/orchestrator'
    );
    const explanation = buildPrDecisionExplanation({
      workflowId: (args.workflow_id as string) ?? '',
      submitter: (args.submitter as string) ?? '',
      ...(typeof args.pr_id === 'string' ? { prId: args.pr_id } : {}),
      dataDir,
    });
    return { ok: true, title: composePrBodyWithExplanation(args.title as string, explanation), explanation };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function prReview(args: Record<string, unknown>): Promise<PrResult> {
  // verdict 精确匹配 fail-fast（不宽容归一——'Approve' 等大小写变体视为用法错误）
  if (args.verdict !== 'approve' && args.verdict !== 'reject') {
    return {
      text: `[sofagent] pr_review 失败：verdict「${String(args.verdict)}」非法——合法值 'approve' | 'reject'（精确匹配，区分大小写）`,
      data: {
        isError: true,
        action: 'review',
        prId: (args.pr_id as string) ?? '',
        issues: [`verdict 须为 'approve' | 'reject'（收到 ${String(args.verdict)}）`],
        auditLogged: false,
      },
    };
  }
  const { prReview } = await import('@sofagent/audit');
  return prReview(
    {
      pr_id: args.pr_id as string,
      reviewer: args.reviewer as string,
      verdict: args.verdict,
      ...(typeof args.note === 'string' ? { note: args.note } : {}),
    },
    await resolveDataDir(args.data_dir as string | undefined),
  );
}

export async function prMerge(args: Record<string, unknown>): Promise<PrResult> {
  const dataDir = await resolveDataDir(args.data_dir as string | undefined);
  const audit = await import('@sofagent/audit');

  // 第一步：audit 状态机合并（criteria 判定 / HITL 挂起在 store 收口）
  const merged = await audit.prMerge(
    {
      pr_id: args.pr_id as string,
      actor: args.actor as string,
      ...(args.human_confirmed === true ? { human_confirmed: true } : {}),
    },
    dataDir,
  );

  // 非合并成功态（HITL 挂起/错误）直接透传——无写回联动
  if (merged.data.isError || merged.data.status !== 'merged') {
    return merged;
  }

  // 第二步：branch→trunk 写回联动（PR 的 workflow 存在 branch-{submitter} 时）
  const { listPrs } = audit;
  const pr = listPrs(dataDir).find((p) => p.id === merged.data.prId);
  if (pr === undefined) {
    // 理论不可达（刚 merged）；防御性回退不吞
    return {
      text: `[sofagent] pr_merge 失败：PR「${merged.data.prId}」合并后读取失败（存储不一致）`,
      data: { ...merged.data, isError: true, issues: ['PR 合并后读取失败（存储不一致）'] },
    };
  }

  const { workflowMergeBranch } = await import('@sofagent/orchestrator');
  let branchResult: Awaited<ReturnType<typeof workflowMergeBranch>>;
  try {
    branchResult = await workflowMergeBranch(
      {
        workflow_id: pr.workflow_id,
        branch_actor: pr.submitter,
        merge_actor: args.actor as string,
      },
      dataDir,
    );
  } catch (err) {
    // 合并失败（损坏 JSON 等 fail-loud）→ 回退 PR + 报错
    const reason = err instanceof Error ? err.message : String(err);
    await audit.prRevertToOpen(pr.id, reason, dataDir);
    return {
      text: `[sofagent] pr_merge 失败：branch→trunk 写回失败（${reason}）——PR「${pr.id}」已回退 open，请修复后重走 review→merge`,
      data: {
        isError: true,
        action: 'merge',
        prId: pr.id,
        status: 'open',
        criteriaResults: merged.data.criteriaResults,
        issues: [`branch→trunk 写回失败：${reason}`],
        auditLogged: false,
      },
    };
  }

  if (branchResult.data.isError) {
    // v1.4.8 F-21: 按 audit 侧 pr-store→workflowMergeBranch 的结构化 code 分流——
    // 此前 `includes('不存在')` 匹配自然语言文案：branch-x 不存在（良性——PR 不带
    // branch 改动）与 workflow「id」不存在（trunk 缺失，严重）文案同含「不存在」
    // 命中同一分支，trunk 丢失被误判良性、状态机假成功。
    if (branchResult.data.code === 'branch-x-missing') {
      // branch 不存在 → 不算失败（PR 不带 branch 改动场景），返回省略 mergedVersion
      return merged;
    }
    // 其他结构化错误（trunk 缺失等）→ 回退 PR + 报错
    const reason = branchResult.data.issues?.join('；') ?? branchResult.text;
    await audit.prRevertToOpen(pr.id, reason, dataDir);
    return {
      text: `[sofagent] pr_merge 失败：branch→trunk 写回失败（${reason}）——PR「${pr.id}」已回退 open，请修复后重走 review→merge`,
      data: {
        isError: true,
        action: 'merge',
        prId: pr.id,
        status: 'open',
        criteriaResults: merged.data.criteriaResults,
        issues: [`branch→trunk 写回失败：${reason}`],
        auditLogged: false,
      },
    };
  }

  // 第三步：branch 合并成功 → 回填 mergedVersion，tool 返回带新 trunk 版本
  const backfill = await audit.prRecordMergedVersion(pr.id, branchResult.data.version ?? 0, dataDir);
  const backfillNote = backfill.data.isError ? `\n[sofagent] ⚠️ mergedVersion 回填失败：${backfill.data.issues?.[0] ?? '未知原因'}（branch→trunk 写回已成功，不影响合并结果）` : '';
  return {
    text: `${merged.text}\n[sofagent] ✅ branch-${pr.submitter} → trunk 写回完成（workflow=${pr.workflow_id} 新 v${branchResult.data.version}，mergedVersion 已回填）${backfillNote}`,
    data: { ...merged.data, mergedVersion: branchResult.data.version },
  };
}
