// ============================================================
// hitl/confidence-tagger.ts · HITL 置信度标注器
// v1.0.5 新增
// ≥99 🟢 / ≥80 🟡 / <80 🔒
// ============================================================

import type { ConfidenceTag, HitlStats } from './types';
import { assessRisk } from './risk-assessor';

/**
 * 对操作进行置信度标注
 * @param action 操作描述
 * @param target 操作目标
 * @param context 上下文信息
 * @returns 置信度标签和分数
 */
export function tagAction(
  action: string,
  target?: string,
  context?: Record<string, unknown>
): { tag: ConfidenceTag; score: number; details: string[] } {
  const assessment = assessRisk({ action, target, context });
  return {
    tag: assessment.tag,
    score: assessment.score,
    details: assessment.details,
  };
}

/**
 * 计算 HITL 统计信息
 * @param history 历史标注记录
 * @returns HitlStats
 */
export function calculateHitlStats(
  history: Array<{ tag: ConfidenceTag; score: number; level: string }>
): HitlStats {
  const stats: HitlStats = {
    totalActions: history.length,
    byTag: { '🟢': 0, '🟡': 0, '🔒': 0 },
    byLevel: { low: 0, medium: 0, high: 0, critical: 0 },
    forcedReviews: 0,
  };

  for (const entry of history) {
    stats.byTag[entry.tag] = (stats.byTag[entry.tag] || 0) + 1;

    const level = entry.level as keyof typeof stats.byLevel;
    if (level in stats.byLevel) {
      stats.byLevel[level]++;
    }

    if (entry.tag === '🔒') {
      stats.forcedReviews++;
    }
  }

  return stats;
}
