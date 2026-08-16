// ============================================================
// instinct/scorer.ts · 置信度评分器（v1.3.5 交付 3）
// ============================================================
//
// 每条 instinct 带置信度 = 出现次数 × 通过率（归一化到 [0,1]）：
//   coverage   = min(1, occurrences / OCCURRENCE_SATURATION)
//                ——出现次数饱和曲线：3 次即视为充分复现（饱和=1）
//   passRate   = passCount / max(1, passCount + failCount)
//                ——无 PASS/FAIL 结局（纯 decision 来源）时按 0.5 中性处理
//   confidence = coverage × passRate
//
// ≥ 阈值（默认 0.7）的 instinct 才注入下次 context（selectForInjection）。
//
// 负样本加权在 extractor 侧完成（错题本 fail ×2），scorer 只做纯计算——
// 两个职责分离让评分逻辑可独立单测。
// ============================================================

import type { InstinctItem } from './extractor';

/** 注入阈值默认值（dev-prompt 交付 3：默认 0.7） */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** 出现次数饱和值：≥3 次视为充分复现 */
export const OCCURRENCE_SATURATION = 3;

/** 评分后的 instinct */
export interface ScoredInstinct extends InstinctItem {
  /** 置信度 [0,1] */
  confidence: number;
  /** 出现次数覆盖度 [0,1] */
  coverage: number;
  /** 通过率 [0,1]（无结局数据时 0.5 中性） */
  passRate: number;
}

/**
 * 计算单条 instinct 的置信度。
 *
 * @param item 提取出的 instinct
 * @returns 评分结果
 */
export function scoreInstinct(item: InstinctItem): ScoredInstinct {
  const coverage = Math.min(1, item.occurrences / OCCURRENCE_SATURATION);
  const totalOutcomes = item.passCount + item.failCount;
  const passRate = totalOutcomes > 0 ? item.passCount / totalOutcomes : 0.5;
  return {
    ...item,
    coverage,
    passRate,
    confidence: coverage * passRate,
  };
}

/**
 * 批量评分。
 *
 * @param items 提取出的 instinct 列表
 * @returns 按置信度降序排列的评分结果
 */
export function scoreInstincts(items: InstinctItem[]): ScoredInstinct[] {
  return items.map(scoreInstinct).sort((a, b) => b.confidence - a.confidence);
}

/**
 * 选择可注入下次 context 的 instinct（confidence ≥ 阈值）。
 *
 * @param items 提取出的 instinct 列表
 * @param threshold 置信度阈值（默认 0.7）
 * @param maxInject 最多注入条数（防 context 膨胀，默认 8）
 * @returns 达标 instinct（置信度降序）
 */
export function selectForInjection(
  items: InstinctItem[],
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  maxInject: number = 8,
): ScoredInstinct[] {
  return scoreInstincts(items)
    .filter((s) => s.confidence >= threshold)
    .slice(0, maxInject);
}

/**
 * 渲染注入文本——拼进下次 context 的 instinct 段。
 *
 * @param selected 达标 instinct 列表
 * @returns Markdown 文本（空列表返回空串）
 */
export function renderInjectionBlock(selected: ScoredInstinct[]): string {
  if (selected.length === 0) return '';
  const lines: string[] = ['## Instinct（自动习得的判断模式）'];
  for (const s of selected) {
    const pct = Math.round(s.confidence * 100);
    lines.push(`- [${pct}%] ${s.pattern}（出现 ${s.occurrences} 次 · 通过率 ${Math.round(s.passRate * 100)}%）`);
  }
  return lines.join('\n');
}
