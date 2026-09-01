// ============================================================
// skillopt-trigger.ts · L2 @weekly skillopt 自动触发（v1.4.3 · P1）
// ============================================================
//
// @weekly：检查 failure-ledger 中连续 ≥3 次的失败聚类 → 自动触发 optimize()
//
// 数据流：
//   failure-ledger.jsonl → getRepeatedFailures(3) → optimize() → runSkillOpt
//
// 如果 skillopt-sleep CLI 不可用 → info（不告警）
// 如果有 ≥1 个聚类达到阈值但触发失败 → warning
// ============================================================

import type { InspectorResult } from './types';

/**
 * 检查失败模式 → 触发 skillopt 优化
 *
 * @param _projectDir 项目根目录（本 inspector 数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runSkilloptTrigger(_projectDir: string): InspectorResult {
  try {
    // 动态 import skillopt（daemon → skillopt 依赖方向合法）
    const skillopt = require('@sofagent/skillopt') as {
      getPendingTriggerCount: () => number;
      autoTriggerAll: () => Promise<
        Array<{ triggered: boolean; skillId: string; failureMode: string; skipReason?: string }>
      >;
    };

    const pendingCount = skillopt.getPendingTriggerCount();

    if (pendingCount === 0) {
      return {
        name: 'skillopt-trigger',
        triggered: false,
        message: '无连续 ≥3 次的失败聚类，跳过',
        severity: 'info',
      };
    }

    // 异步触发（不阻塞巡检——结果记录在 message 中）
    void skillopt.autoTriggerAll().then((results) => {
      const triggered = results.filter((r) => r.triggered).length;
      const failed = results.filter((r) => !r.triggered).length;
      if (triggered > 0) {
        console.log(`[skillopt-trigger] 触发 ${triggered} 个优化 · 跳过 ${failed} 个`);
      }
    });

    return {
      name: 'skillopt-trigger',
      triggered: true,
      message: `检测到 ${pendingCount} 个连续失败聚类 → 已触发 skillopt 自动优化`,
      severity: 'info',
    };
  } catch (err) {
    // skillopt 包不可用 → info（不告警）
    return {
      name: 'skillopt-trigger',
      triggered: false,
      message: `skillopt 不可用：${err instanceof Error ? err.message : String(err)}`,
      severity: 'info',
    };
  }
}
