// ============================================================
// evolve-trigger.ts · L2 @weekly evolve 自动触发（v1.7.0 · P1 / v1.7.0 接线）
// ============================================================
//
// @weekly：运行**进化循环**——v1.5.9 第 2 步把 v1.5.8 交付的七组能力面接进本链路：
//   准入/停滞检测 · 三层晋级判据 · 经验池管道 · 出题考核器 · RL 训练治理 ·
//   收益指标 · 评测集谱系
//
// 数据流（v1.7.0 起）：
//   cron(@weekly) → runEvolveTrigger → runEvolutionLoop()
//      ├─ 组①② 既有自动触发链（optimize：准入 + 成本门 + runEvolve）在环内
//      └─ 组③④⑤⑥⑦ 池管道 / 考核 / 训练治理 / 收益指标 / 评测集谱系
//
// 循环为 default-safe（读 IO 容错、写 IO 仅在确有产出时发生、零模型零命令），
// 并以 fire-and-forget 形态运行（不阻塞巡检）。
// owner 间的动态 require 复用于「evolve 面可选」的既有语义。
// ============================================================

import type { InspectorResult } from './types';

/**
 * 检查失败模式 → 触发进化循环
 *
 * @param _projectDir 项目根目录（本 inspector 数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runEvolveTrigger(_projectDir: string): InspectorResult {
  try {
    // 动态 require 保持「evolve 面可选/避免包间循环依赖加载」的既有语义
    // （daemon → evolve 依赖方向合法）。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runEvolutionLoop } = require('../evolution/loop') as typeof import('../evolution/loop');

    // 异步运行进化循环（不阻塞巡检——结果记录在 console）
    void runEvolutionLoop({})
      .then((report) => {
        const triggered = report.optimizations.filter((r) => r.triggered).length;
        if (report.pendingTriggers > 0 || triggered > 0 || report.exam.results.length > 0) {
          console.log(
            `[evolve-trigger] 进化循环：待触发失败聚类 ${report.pendingTriggers} · 实际触发 ${triggered}` +
            ` · 池导出 ${report.pool.exported} · 考核结果 ${report.exam.results.length} · 收益维度 ${report.metrics.availableDims}/4`,
          );
        }
      })
      .catch((err: unknown) => {
        console.warn(`[evolve-trigger] 进化循环执行失败：${err instanceof Error ? err.message : String(err)}`);
      });

    return {
      name: 'evolve-trigger',
      triggered: true,
      message: '进化循环已异步启动（准入/晋级/经验池/考核/训练治理/收益指标/评测集谱系）',
      severity: 'info',
    };
  } catch (err) {
    // evolve 面不可用 → info（不告警）
    return {
      name: 'evolve-trigger',
      triggered: false,
      message: `进化循环不可用：${err instanceof Error ? err.message : String(err)}`,
      severity: 'info',
    };
  }
}
