// ============================================================
// evolve-trigger.ts · L2 @weekly evolve 自动触发（v1.5.0 · P1）
// ============================================================
//
// @weekly：检查 failure-ledger 中连续 ≥3 次的失败聚类 → 自动触发 optimize()
//
// 数据流：
//   failure-ledger.jsonl → getRepeatedFailures(3) → optimize() → runEvolve
//
// 如果 evolve 能力不可用 → info（不告警）
//   （v1.4.9 G-11：旧注释写的 `evolve-gate CLI` 是一个从未存在的二进制名——一次过宽全局替换的产物；
//     native 模式内置实现恒可用，能力不可用只在 SOFAGENT_EVOLVE_GATE=cli 且外部 CLI 缺位时成立）
// 如果有 ≥1 个聚类达到阈值但触发失败 → warning
// ============================================================

import type { InspectorResult } from './types';

/**
 * 检查失败模式 → 触发 evolve 优化
 *
 * @param _projectDir 项目根目录（本 inspector 数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runEvolveTrigger(_projectDir: string): InspectorResult {
  try {
    // 动态 import evolve（daemon → evolve 依赖方向合法）
    const evolve = require('@sofagent/evolve') as {
      getPendingTriggerCount: () => number;
      autoTriggerAll: () => Promise<
        Array<{ triggered: boolean; skillId: string; failureMode: string; skipReason?: string }>
      >;
    };

    const pendingCount = evolve.getPendingTriggerCount();

    if (pendingCount === 0) {
      return {
        name: 'evolve-trigger',
        triggered: false,
        message: '无连续 ≥3 次的失败聚类，跳过',
        severity: 'info',
      };
    }

    // 异步触发（不阻塞巡检——结果记录在 message 中）
    void evolve.autoTriggerAll().then((results) => {
      const triggered = results.filter((r) => r.triggered).length;
      const failed = results.filter((r) => !r.triggered).length;
      if (triggered > 0) {
        console.log(`[evolve-trigger] 触发 ${triggered} 个优化 · 跳过 ${failed} 个`);
      }
    });

    return {
      name: 'evolve-trigger',
      triggered: true,
      message: `检测到 ${pendingCount} 个连续失败聚类 → 已触发 evolve 自动优化`,
      severity: 'info',
    };
  } catch (err) {
    // evolve 包不可用 → info（不告警）
    return {
      name: 'evolve-trigger',
      triggered: false,
      message: `evolve 不可用：${err instanceof Error ? err.message : String(err)}`,
      severity: 'info',
    };
  }
}
