// ============================================================
// judge-mode-control.ts · 挂-4 影子门 live 装载与切档（F6.5 #5 生产端）
// ------------------------------------------------------------
// 补的是什么：`bootstrapJudgeModeState` / `recordShadowReconciliation` 此前
// 只有测试调用 ⇒ 部署面「重启后对账面归零、live 切档不落账」。
// 本模块把它们接成 daemon 的真实入口：
//   · bootJudgeMode(dataDir)              —— daemon start 时装载台账
//   · switchJudgeModeLive(dataDir, mode)  —— live 切档：先落一条对账，再切档
// 纪律：台账损坏不静默归零（损坏 ≠ 没对过账），由调用方告警。
// ============================================================

import {
  bootstrapJudgeModeState,
  recordShadowReconciliation,
  setJudgeMode,
  getJudgeMode,
  getShadowLedger,
  type ShadowLedger,
} from '@sofagent/orchestrator';
import type { JudgeMode } from '@sofagent/orchestrator';

export interface BootResult {
  reconciled: number;
  mode: JudgeMode;
}

/** daemon 启动时调用一次：把持久化对账面装进进程内单例 */
export function bootJudgeMode(dataDir: string): BootResult {
  const ledger: ShadowLedger = bootstrapJudgeModeState(dataDir);
  return { reconciled: ledger.reconciled, mode: getJudgeMode() };
}

export interface SwitchInput {
  /** 目标档：shadow（影子）/ active（放行）/ off（旁路） */
  mode: JudgeMode;
  /** shadow 侧当时的判定（落账用；不给则记 unknown） */
  shadow?: string;
  /** 实际执行的动作（落账用） */
  actual?: string;
  /** 对账时点（默认当前时间） */
  ts?: string;
}

export interface SwitchResult {
  mode: JudgeMode;
  reconciled: number;
  recorded: boolean;
}

/**
 * live 切档 + 对账台账回填。
 *
 * 语义：只要显式给了 `shadow`/`actual`，就**先落一条对账**再切档——这样
 * `reconciled` 的增长与切档在同一调用内完成，不存在「切了档但台账没记」的窗口。
 * 不给对账信息时只切档（用于回退到 shadow/off，不需要对账）。
 */
export function switchJudgeModeLive(dataDir: string, input: SwitchInput): SwitchResult {
  let recorded = false;
  if (input.shadow !== undefined && input.actual !== undefined) {
    recordShadowReconciliation(dataDir, {
      ts: input.ts ?? new Date().toISOString(),
      shadow: input.shadow,
      actual: input.actual,
    });
    recorded = true;
  }
  setJudgeMode(input.mode, getShadowLedger());
  return { mode: getJudgeMode(), reconciled: getShadowLedger().reconciled, recorded };
}
