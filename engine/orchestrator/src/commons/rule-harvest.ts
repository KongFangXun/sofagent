// ============================================================
// rule-harvest.ts · 评估体系第一步：真实案例长规则（v1.3.7 交付 5）
//
// 从公地调用日志（commons_rate 累积的低分差评）+ Refine Agent 循环结果
// （反复触发同一类质量问题的 Skill）提炼质量规则候选。
//
// 复用机制（不重写）：
//   - parseFdeDeliveryReport：quality-rule-set.ts 的解析逻辑（案例文本 → 规则）
//   - rating.ts：读取低分差评（score < 阈值）
//   - invoker.ts：读取调用失败日志（反复触发的 case）
//
// 输出：QualityRule[] 候选列表（source 标为 team_feedback，待评审）
// ============================================================

import { readRatings } from './rating';
import { readInvokeLog } from './invoker';
import {
  parseFdeDeliveryReport,
  fdeFeedbacksToRules,
  type QualityRule,
} from '../refine-agent/quality-rule-set';

// ────────────────────────────────────────────────────────────
// 配置阈值
// ────────────────────────────────────────────────────────────

/** 低分差评阈值（score < 此值视为差评） */
export const LOW_SCORE_THRESHOLD = 0.4;
/** 失败调用阈值（某能力失败次数 ≥ 此值 → 反复触发 case） */
export const REPEAT_FAIL_THRESHOLD = 3;

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 提炼输入（可注入 mock 数据——单测不读真实 data/） */
export interface HarvestInput {
  /** 低分差评记录（可注入；缺省从 rating.ts 读取） */
  lowScoreRatings?: Array<{ capabilityId: string; raterId: string; score: number; comment?: string }>;
  /** Refine 反复触发 case（可注入；缺省从 invoke-log 读取失败记录） */
  repeatFailCases?: Array<{ capabilityId: string; failCount: number; lastReason?: string }>;
  /** 可选的案例文本（FDE delivery-report 格式，直接 parseFdeDeliveryReport） */
  caseTexts?: string[];
  /** 可选的数据目录覆盖（不注入 mock 时从真实 data/ 读） */
  dataDir?: string;
}

/** 提炼结果 */
export interface HarvestResult {
  /** 提炼出的规则候选列表 */
  candidates: QualityRule[];
  /** 提炼来源统计 */
  sources: {
    fromLowScore: number;
    fromRepeatFail: number;
    fromCaseText: number;
  };
  /** 低分差评样本数 */
  lowScoreCount: number;
  /** 反复失败样本数 */
  repeatFailCount: number;
}

// ────────────────────────────────────────────────────────────
// 数据采集（从 commons 日志读取，或用注入的 mock）
// ────────────────────────────────────────────────────────────

/**
 * 采集低分差评（score < LOW_SCORE_THRESHOLD）。
 *
 * @param dataDir 可选的数据目录覆盖
 * @param injected 可选的注入数据（单测用）
 */
export function collectLowScoreRatings(
  dataDir?: string,
  injected?: HarvestInput['lowScoreRatings'],
): Array<{ capabilityId: string; raterId: string; score: number; comment?: string }> {
  if (injected) return injected.filter((r) => r.score < LOW_SCORE_THRESHOLD);
  // 从真实 rating 日志读取
  const ratings = readRatings(dataDir);
  return ratings.filter((r) => r.score < LOW_SCORE_THRESHOLD).map((r) => ({
    capabilityId: r.capabilityId,
    raterId: r.raterId,
    score: r.score,
    ...(r.comment ? { comment: r.comment } : {}),
  }));
}

/**
 * 采集反复失败 case（某能力失败次数 ≥ REPEAT_FAIL_THRESHOLD）。
 *
 * @param dataDir 可选的数据目录覆盖
 * @param injected 可选的注入数据（单测用）
 */
export function collectRepeatFailCases(
  dataDir?: string,
  injected?: HarvestInput['repeatFailCases'],
): Array<{ capabilityId: string; failCount: number; lastReason?: string }> {
  if (injected) return injected.filter((c) => c.failCount >= REPEAT_FAIL_THRESHOLD);
  // 从真实 invoke-log 读取，按 capabilityId 聚合失败次数
  const logs = readInvokeLog(dataDir);
  const failMap = new Map<string, { failCount: number; lastReason?: string }>();
  for (const log of logs) {
    if (log.outcome === 'failed' || log.outcome === 'blocked') {
      const existing = failMap.get(log.capabilityId) ?? { failCount: 0 };
      existing.failCount++;
      failMap.set(log.capabilityId, existing);
    }
  }
  return Array.from(failMap.entries())
    .filter(([, v]) => v.failCount >= REPEAT_FAIL_THRESHOLD)
    .map(([capabilityId, v]) => ({ capabilityId, failCount: v.failCount, ...(v.lastReason ? { lastReason: v.lastReason } : {}) }));
}

// ────────────────────────────────────────────────────────────
// 规则提炼
// ────────────────────────────────────────────────────────────

/**
 * 从低分差评的 comment 文本提炼规则候选。
 *
 * 复用 parseFdeDeliveryReport：把 comment 当作 FDE delivery-report 行解析。
 * 解析失败的 comment 静默跳过（降级处理）。
 *
 * @param lowScoreRatings 低分差评列表
 * @returns QualityRule 候选（source=team_feedback）
 */
export function harvestFromLowScore(
  lowScoreRatings: Array<{ capabilityId: string; comment?: string }>,
): { rules: QualityRule[]; count: number } {
  const rules: QualityRule[] = [];
  for (const rating of lowScoreRatings) {
    if (!rating.comment) continue;
    // 复用 parseFdeDeliveryReport 解析 comment 文本
    const feedbacks = parseFdeDeliveryReport(rating.comment);
    if (feedbacks.length > 0) {
      const converted = fdeFeedbacksToRules(feedbacks).map((r) => ({
        ...r,
        source: 'team_feedback' as const,
        id: `harvest-lowscore-${rating.capabilityId}-${r.id}`,
      }));
      rules.push(...converted);
    }
  }
  return { rules, count: lowScoreRatings.length };
}

/**
 * 从反复失败 case 提炼规则候选。
 *
 * 反复触发同一类问题的 Skill → 生成一条「forbidden_pattern」或「required_keyword」候选
 * （具体规则由 case 文本决定，无文本时生成通用「max_length / forbidden_pattern」候选）。
 *
 * @param repeatFails 反复失败 case 列表
 * @returns QualityRule 候选（source=team_feedback）
 */
export function harvestFromRepeatFail(
  repeatFails: Array<{ capabilityId: string; failCount: number; lastReason?: string }>,
): { rules: QualityRule[]; count: number } {
  const rules: QualityRule[] = [];
  for (const fail of repeatFails) {
    // 反复失败 → 生成一条 forbidden_pattern 候选（模式由 lastReason 提取，缺省通用）
    const pattern = extractPatternFromReason(fail.lastReason);
    rules.push({
      id: `harvest-repeatfail-${fail.capabilityId}`,
      source: 'team_feedback',
      check: pattern ? 'forbidden_pattern' : 'max_length',
      description: `能力「${fail.capabilityId}」反复失败（${fail.failCount} 次）——提炼自动规则候选`,
      targetField: 'output',
      params: pattern
        ? { pattern }
        : { maxLength: 500 },
      severity: 'error',
    });
  }
  return { rules, count: repeatFails.length };
}

/**
 * 从案例文本（FDE delivery-report 格式）提炼规则候选。
 *
 * @param caseTexts 案例文本数组
 * @returns QualityRule 候选（source=team_feedback）
 */
export function harvestFromCaseTexts(caseTexts: string[]): { rules: QualityRule[]; count: number } {
  const rules: QualityRule[] = [];
  for (const text of caseTexts) {
    const feedbacks = parseFdeDeliveryReport(text);
    if (feedbacks.length > 0) {
      const converted = fdeFeedbacksToRules(feedbacks).map((r) => ({
        ...r,
        source: 'team_feedback' as const,
        id: `harvest-casetext-${r.id}`,
      }));
      rules.push(...converted);
    }
  }
  return { rules, count: caseTexts.length };
}

/**
 * 从失败原因文本提取正则模式（简单启发式）。
 */
function extractPatternFromReason(reason?: string): string | null {
  if (!reason) return null;
  // 常见失败模式：超时 / 崩溃 / 空输出
  if (/timeout|超时/i.test(reason)) return '(timeout|超时)';
  if (/crash|崩溃|error|异常/i.test(reason)) return '(crash|崩溃|exception)';
  if (/empty|空输出|null|undefined/i.test(reason)) return '(^\\s*$|^null$|^undefined$)';
  return null;
}

// ────────────────────────────────────────────────────────────
// 主入口：三源合并提炼
// ────────────────────────────────────────────────────────────

/**
 * 评估体系第一步——从真实案例提炼质量规则候选。
 *
 * 三源合并：
 *   1. 低分差评 comment → parseFdeDeliveryReport → 规则
 *   2. 反复失败 case → 启发式规则（forbidden_pattern / max_length）
 *   3. 案例文本（FDE delivery-report 格式）→ parseFdeDeliveryReport → 规则
 *
 * 所有候选 source 标为 team_feedback（待评审）。
 *
 * @param input 提炼输入（可注入 mock 数据）
 * @returns 提炼结果
 */
export function harvestRules(input: HarvestInput = {}): HarvestResult {
  // 1. 低分差评
  const lowScore = collectLowScoreRatings(input.dataDir, input.lowScoreRatings);
  const fromLow = harvestFromLowScore(lowScore);

  // 2. 反复失败
  const repeatFails = collectRepeatFailCases(input.dataDir, input.repeatFailCases);
  const fromFail = harvestFromRepeatFail(repeatFails);

  // 3. 案例文本
  const fromText = harvestFromCaseTexts(input.caseTexts ?? []);

  return {
    candidates: [...fromLow.rules, ...fromFail.rules, ...fromText.rules],
    sources: {
      fromLowScore: fromLow.rules.length,
      fromRepeatFail: fromFail.rules.length,
      fromCaseText: fromText.rules.length,
    },
    lowScoreCount: lowScore.length,
    repeatFailCount: repeatFails.length,
  };
}
