// ============================================================
// E7 决策质量信号（扩展层 · 能力拐杖）· v1.5.7 章八新增
// 消费 decision-log 输入源（inputs/decision-log-source.ts）的首条规则：
// FALLBACK_DEGRADE 高频出现 → WARN 决策质量劣化信号。
//
// 判定面（v1.5.3 自测 schema 对齐——正负样例见注册表 examples）：
//   · 窗口：本次审计读到的 decision-log 全集内 FALLBACK_DEGRADE 条目数
//     （INVALIDATION 标记条目按下游读数纪律排除；FALLBACK_DEGRADE 非标记类，不受影响）；
//   · 阈值：≥ 5 条降级记录 ⇒ WARN（高频 = 主判定面不稳：LLM 不可用 /
//     引擎超时 / 降级链频繁触发——审计结论此时建立在降级执行之上，
//     决策质量有系统性劣化风险）；
//   · 严重度：WARN 非 FAIL——降级是**既定的安全行为**（v1.5.6 第七章的
//     审计超时降级链本身是设计面），判 FAIL 会惩罚正确的降级；WARN 的
//     语义是「提示运维关注降级频率」，与 A6/A7 拐杖族同级的信号位。
//
// 输入通道：decision（v1.5.7 章八新增第三通道——与 result/intent 并列，
// 经 AuditContext.decisionEntries 装配；未装配时本规则 SKIPPED 不误报）。
// evidenceMode: logs（纯日志判定——decision-log 属留痕数据面，非 diff）。
// ============================================================

import type { AuditContext, RuleScan } from './types';
import type { DecisionLogEntry } from '../decision-schema';

/** 降级高频阈值（窗口内 FALLBACK_DEGRADE 条数 ≥ 此值 ⇒ WARN） */
export const E7_DEGRADE_WARN_THRESHOLD = 5;

/** 从 ctx 取 decision-log 输入（未装配 = undefined，本规则 SKIPPED——不猜测不误报） */
function decisionEntriesOf(ctx: AuditContext): DecisionLogEntry[] | undefined {
  return ctx.decisionEntries;
}

export function scanE7(ctx: AuditContext): RuleScan {
  const entries = decisionEntriesOf(ctx);
  // 输入源未装配（调用方未接 decision-log 通道）⇒ SKIPPED——通道 opt-in 纪律
  if (entries === undefined) {
    return { status: 'SKIPPED', details: ['decision-log 输入源未装配（通道 opt-in）——本规则不判定'] };
  }

  const degrades = entries.filter((e) => e.kind === 'FALLBACK_DEGRADE');

  if (degrades.length >= E7_DEGRADE_WARN_THRESHOLD) {
    // 证据细节：最近一次降级的时间与原因摘要（脱敏面已由写侧 sanitizeWhy 保证）
    const last = degrades[degrades.length - 1];
    const lastWhy =
      last !== undefined && typeof last.why === 'object' && last.why !== null && 'text' in last.why
        ? String(last.why.text).slice(0, 60)
        : '';
    const lastTs = last !== undefined ? last.ts : '';
    return {
      status: 'WARN',
      details: [
        `decision-log 记录 ${degrades.length} 次 FALLBACK_DEGRADE（≥ 阈值 ${E7_DEGRADE_WARN_THRESHOLD}）——决策质量劣化信号：主判定面频繁走降级链（LLM 不可用/引擎超时等），审计结论可能建立在降级执行之上；最近一次：${lastTs}${lastWhy !== '' ? `「${lastWhy}」` : ''}`,
      ],
    };
  }

  return { status: 'PASS', details: [`决策质量信号正常：FALLBACK_DEGRADE ${degrades.length} 次（< 阈值 ${E7_DEGRADE_WARN_THRESHOLD}）`] };
}
