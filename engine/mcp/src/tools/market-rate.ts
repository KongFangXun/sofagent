// ============================================================
// market-rate.ts · MCP tool: market_rate（v1.3.5 交付 2）
//
// 能力评价——调用后累积评分，加权排序让高频高价值能力自然上浮。
// 防刷：同一 owner 对同一能力仅一票（后评覆盖前评）。
//
// 复用 @sofagent/orchestrator 的 market/rating.ts。
// ============================================================

// ============================================================
// 类型定义
// ============================================================

export interface MarketRateArgs {
  /** 能力 ID（必填） */
  capability_id: string;
  /** 评价者 agentId（必填——对接身份码） */
  rater_id: string;
  /** 评分 0.0~1.0（必填） */
  score: number;
  /** 能力 owner agentId（必填——用于更新 trust） */
  owner_agent_id: string;
  /** 可选评论 */
  comment?: string;
}

export interface MarketRateResult {
  text: string;
  data: {
    ok: boolean;
    capabilityId?: string;
    averageScore?: number;
    count?: number;
    rankScore?: number;
    trust?: number;
    coldStart?: boolean;
    error?: string;
  };
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 提交一条能力评价（防刷：同 rater 同能力仅一票，后评覆盖前评）。
 *
 * 评价回流同时更新 owner trust（好评上调 / 差评下调）。
 *
 * @param args 入参
 * @returns 评价后的聚合评分
 */
export async function marketRate(args: MarketRateArgs): Promise<MarketRateResult> {
  if (!args.capability_id || !args.rater_id || !args.owner_agent_id) {
    return {
      text: '[sofagent] market_rate 错误: capability_id、rater_id、owner_agent_id 必填',
      data: { ok: false, error: 'capability_id、rater_id、owner_agent_id 必填' },
      isError: true,
    };
  }

  if (typeof args.score !== 'number' || args.score < 0 || args.score > 1) {
    return {
      text: '[sofagent] market_rate 错误: score 必须在 [0.0, 1.0] 范围内',
      data: { ok: false, error: 'score 必须在 [0.0, 1.0] 范围内' },
      isError: true,
    };
  }

  try {
    const mod = require('@sofagent/orchestrator') as {
      addRating: (rec: { capabilityId: string; raterId: string; score: number; ratedAt?: string; comment?: string }, dataDir?: string) => unknown;
      aggregateRating: (capabilityId: string, ownerAgentId: string, dataDir?: string) => { averageScore: number; count: number; rankScore: number; trust: number; coldStart: boolean };
      updateTrustOnRating: (ownerId: string, score: number, dataDir?: string) => number;
    };

    // 写入评价（防刷：同 rater 同能力后评覆盖前评）
    mod.addRating(
      {
        capabilityId: args.capability_id,
        raterId: args.rater_id,
        score: args.score,
        ratedAt: new Date().toISOString(),
        ...(args.comment ? { comment: args.comment } : {}),
      },
    );

    // 评价回流更新 owner trust
    const trust = mod.updateTrustOnRating(args.owner_agent_id, args.score);

    // 聚合评分
    const agg = mod.aggregateRating(args.capability_id, args.owner_agent_id);

    return {
      text: `[sofagent] 能力「${args.capability_id}」评分已记录（${args.score}）→ 平均 ${agg.averageScore.toFixed(2)}（${agg.count} 票），排序分 ${agg.rankScore}，owner trust ${trust.toFixed(2)}`,
      data: {
        ok: true,
        capabilityId: args.capability_id,
        averageScore: agg.averageScore,
        count: agg.count,
        rankScore: agg.rankScore,
        trust,
        coldStart: agg.coldStart,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] market_rate 失败: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}
