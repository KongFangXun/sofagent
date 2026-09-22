// ============================================================
// cost/quota-gate.ts · 成本 quota 事前门禁（v1.5.1 第六章）
// ============================================================
// 成本管控从「事后记账」（v1.4.0 cost_query WARN only）前移为「事前问路」：
//   任务执行前查当前周期配额余量——超额按策略处理：
//     WARN 模式：放行但留警告（单机默认渐进启用形态）
//     HARD 模式：拦截（fail-closed，企业配）
//   验证回写语义：只有验证过的执行结果才记 spend（失败/重试不重复计）。
//
// 纯函数 + 注入式状态（core 零跨包 import）——FORGE driver 的 run 级
// token 闸门（usage.jsonl 计量 + 软熔断）由 FORGE 侧消费同款判定。
// ============================================================

/** 配额周期 */
export type QuotaPeriod = 'daily' | 'weekly' | 'monthly';

export interface QuotaConfig {
  /** 周期（默认 daily） */
  period?: QuotaPeriod;
  /** 周期内最大 token 总量（输入+输出） */
  maxTokens: number;
  /** 超额处理：WARN（放行+警告，缺省）| HARD（拦截，企业配） */
  mode?: 'WARN' | 'HARD';
}

/** 配额用量状态（由调用方从计量源聚合后注入——本层不读文件） */
export interface QuotaUsage {
  /** 当前周期已消耗 token */
  usedTokens: number;
  /** 当前周期起算时间（ISO） */
  periodStart: string;
}

/** 门禁判定结果 */
export type QuotaVerdict =
  | { action: 'allow'; usedTokens: number; maxTokens: number; remaining: number; period: QuotaPeriod }
  | { action: 'allow-with-warning'; usedTokens: number; maxTokens: number; remaining: number; period: QuotaPeriod; warning: string }
  | { action: 'block'; usedTokens: number; maxTokens: number; remaining: number; period: QuotaPeriod; reason: string };

/**
 * 事前配额检查（纯函数）。
 * 未配置 quota → allow 零开销直通（单机不破坏）。
 */
export function checkQuota(config: QuotaConfig | null | undefined, usage: QuotaUsage): QuotaVerdict {
  if (!config || typeof config.maxTokens !== 'number' || config.maxTokens <= 0) {
    return {
      action: 'allow',
      usedTokens: usage.usedTokens,
      maxTokens: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      period: config?.period ?? 'daily',
    };
  }
  const period = config.period ?? 'daily';
  const mode = config.mode ?? 'WARN';
  const remaining = Math.max(0, config.maxTokens - usage.usedTokens);

  if (usage.usedTokens >= config.maxTokens) {
    const over = usage.usedTokens - config.maxTokens;
    if (mode === 'HARD') {
      return {
        action: 'block',
        usedTokens: usage.usedTokens,
        maxTokens: config.maxTokens,
        remaining: 0,
        period,
        reason: `周期（${period}）配额已超 ${over} tokens（上限 ${config.maxTokens}）——HARD 模式拦截（fail-closed）`,
      };
    }
    return {
      action: 'allow-with-warning',
      usedTokens: usage.usedTokens,
      maxTokens: config.maxTokens,
      remaining: 0,
      period,
      warning: `周期（${period}）配额已超 ${over} tokens（上限 ${config.maxTokens}）——WARN 模式放行，建议尽快扩额或收敛任务`,
    };
  }
  return { action: 'allow', usedTokens: usage.usedTokens, maxTokens: config.maxTokens, remaining, period };
}

/**
 * 验证回写判定——只有验证过（verified=true）的执行结果才记 spend。
 * 失败/重试的重复消耗不重复计（调用方按本判定落账）。
 */
export function shouldRecordSpend(verified: boolean, alreadyRecorded: boolean): { record: boolean; reason: string } {
  if (alreadyRecorded) {
    return { record: false, reason: '本轮已记账（防重复）' };
  }
  if (!verified) {
    return { record: false, reason: '执行结果未验证（失败/重试不重复计）' };
  }
  return { record: true, reason: '验证通过，记 spend' };
}
