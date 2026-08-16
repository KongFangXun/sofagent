// ============================================================
// commons-harvest-rule.ts · MCP tool: commons_harvest_rule（v1.3.6 交付 5）
//
// 评估体系三步编排——触发第一步提炼（harvest），可选连跑第二步（jury）+ 第三步（promote）。
//
// 复用 @sofagent/orchestrator 的 commons/rule-harvest + rule-jury + rule-promote。
// ============================================================

// ============================================================
// 类型定义
// ============================================================

export interface CommonsHarvestRuleArgs {
  /** 操作：harvest=提炼规则候选 / full=三步全跑（提炼→评审→晋升） */
  action?: 'harvest' | 'full';
  /** 可选：注入的案例文本（FDE delivery-report 格式） */
  case_texts?: string[];
}

export interface CommonsHarvestRuleResult {
  text: string;
  data: {
    ok: boolean;
    step?: string;
    candidates?: number;
    recommended?: number;
    promoted?: number;
    rules?: Array<{ id: string; check: string; description: string; source: string }>;
    error?: string;
  };
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 触发评估体系三步——提炼规则候选（harvest），或全跑（full）。
 *
 * @param args 入参
 * @returns 结果
 */
export async function commonsHarvestRule(args: CommonsHarvestRuleArgs): Promise<CommonsHarvestRuleResult> {
  const action = args.action ?? 'harvest';

  try {
    const mod = require('@sofagent/orchestrator') as {
      harvestRules: (input: { caseTexts?: string[] }) => { candidates: Array<{ id: string; check: string; description: string; source: string }>; sources: { fromLowScore: number; fromRepeatFail: number; fromCaseText: number } };
      juryRules: (input: { candidates: unknown[] }) => { recommended: Array<{ rule: { id: string; check: string; description: string } }>; rejected: unknown[]; approvals: unknown[] };
      promoteRules: (input: { approvedRules: unknown[]; benchmarks: unknown[]; approvals: unknown[] }) => { promoted: Array<{ id: string; check: string; description: string; source: string }>; loggedCount: number };
    };

    // 第一步：提炼
    const harvest = mod.harvestRules({
      ...(args.case_texts ? { caseTexts: args.case_texts } : {}),
    });

    if (action === 'harvest' || harvest.candidates.length === 0) {
      const lines = [`[sofagent] 规则提炼完成：${harvest.candidates.length} 条候选`];
      lines.push(`  来源：低分差评 ${harvest.sources.fromLowScore} / 反复失败 ${harvest.sources.fromRepeatFail} / 案例文本 ${harvest.sources.fromCaseText}`);
      return {
        text: lines.join('\n'),
        data: {
          ok: true,
          step: 'harvest',
          candidates: harvest.candidates.length,
          rules: harvest.candidates,
        },
      };
    }

    // full：第二步 + 第三步
    const jury = mod.juryRules({ candidates: harvest.candidates });
    const lines = [`[sofagent] 规则评审完成：推荐 ${jury.recommended.length} / 拒绝 ${jury.rejected.length}`];

    if (jury.recommended.length === 0) {
      return {
        text: lines.join('\n'),
        data: {
          ok: true,
          step: 'jury',
          candidates: harvest.candidates.length,
          recommended: 0,
        },
      };
    }

    // 第三步：晋升
    const approvedRules = jury.recommended.map((r) => r.rule);
    const promote = mod.promoteRules({
      approvedRules,
      benchmarks: jury.recommended.map((r) => ({ ruleId: (r.rule as { id: string }).id, benchmarkHash: 'auto', scoreDelta: 0 })),
      approvals: jury.approvals as unknown[],
    });

    lines.push(`  晋升：${promote.promoted.length} 条规则进入 builtin（记 ${promote.loggedCount} 条 decision-log）`);
    return {
      text: lines.join('\n'),
      data: {
        ok: true,
        step: 'promote',
        candidates: harvest.candidates.length,
        recommended: jury.recommended.length,
        promoted: promote.promoted.length,
        rules: promote.promoted,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] commons_harvest_rule 失败: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}
