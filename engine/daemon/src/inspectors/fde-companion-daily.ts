// ============================================================
// fde-companion-daily.ts · FDE 陪跑期日巡检（v1.3.5 交付 5 #1）
// ============================================================
//
// @daily：陪跑期（部署后前 2 周）每日触发 Refine 巡检。
// 实际逻辑在 companion.ts（runCompanionDaily）——本文件是 inspector
// 三步注册的第一步：导出 run 函数（InspectorFn 签名）。
//
// 非陪跑期 → triggered=false（info，不告警）。
// ============================================================

import type { InspectorResult } from './types';
import { runCompanionDaily, getCompanionState, COMPANION_DAYS } from '../companion';

/**
 * FDE 陪跑期每日巡检器（@daily）。
 *
 * InspectorFn 是同步签名——Refine 是长任务（LLM 链路），inspector 层
 * 只做「触发 + 状态上报」：异步巡检 fire-and-forget，本函数同步返回
 * 触发状态（Refine 结果由下次巡检/decision-log 呈现，与 daemon 其他
 * 长任务调度同范式）。
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 * @returns InspectorResult
 */
export function runFdeCompanionDaily(_projectDir: string): InspectorResult {
  void _projectDir;

  const state = getCompanionState();
  if (!state.active) {
    return {
      name: 'fde-companion-daily',
      triggered: false,
      message: state.deployedAt === null
        ? '部署时间未知，陪跑巡检跳过（无 companion.json / sessions/current.json）'
        : `陪跑期已结束（${state.daysSinceDeploy} 天 ≥ 14 天），巡检跳过`,
      severity: 'info',
    };
  }

  // 触发当日 Refine 巡检（异步 fire-and-forget——结果写 think.md + decision-log）
  let fired = true;
  try {
    void runCompanionDaily().catch((err) => {
      // 巡检失败留痕到 stderr（daemon 日志），不阻断其他 inspector
      process.stderr.write(`[fde-companion-daily] Refine 巡检失败: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  } catch (err) {
    fired = false;
    process.stderr.write(`[fde-companion-daily] 触发失败: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  return {
    name: 'fde-companion-daily',
    triggered: fired,
    message: `陪跑期第 ${state.daysSinceDeploy} 天（共 ${COMPANION_DAYS} 天）——Refine 巡检已触发，结果写 think.md + decision-log`,
    severity: fired ? 'info' : 'warning',
  };
}
