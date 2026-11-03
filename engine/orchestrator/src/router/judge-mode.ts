// ============================================================
// judge-mode.ts · v1.8.0 §一 judgeMode 单例（唯一状态源）
// ------------------------------------------------------------
// P1-3 修复：此前 plan-node 与 engineer-decide 各持一份模块级
// judgeMode + shadowLedger + setJudgeMode——plan 侧切 off 而 engineer
// 侧仍是 shadow，off 语义被静默破坏。本模块是两 loop 共享的唯一状态：
// 模块级单例（ESM 模块缓存天然单例），setter 校验 active 须过对账。
// ============================================================
import { type JudgeMode, type ShadowLedger, ShadowGateError } from './judge-state';
import {
  appendShadowReconciliation,
  loadShadowLedger,
  type ShadowReconciliationEntry,
} from './shadow-ledger-store';

let judgeMode: JudgeMode = 'shadow';
const shadowLedger: ShadowLedger = { reconciled: 0 };

/** 读当前判定档（唯一读口） */
export function getJudgeMode(): JudgeMode {
  return judgeMode;
}

/** 读影子期对账台账（唯一读口） */
export function getShadowLedger(): ShadowLedger {
  return shadowLedger;
}

/** 切换判定运行档（唯一写口——active 需先过影子期对账，ShadowGateError 拒绝；off 生效位置在 model-router.route()） */
export function setJudgeMode(mode: JudgeMode, ledger?: ShadowLedger): void {
  judgeMode = mode;
  if (ledger) shadowLedger.reconciled = ledger.reconciled;
}

/** 测试复位（仅测试用——还原缺省 shadow / 对账 0） */
export function resetJudgeModeForTest(): void {
  judgeMode = 'shadow';
  shadowLedger.reconciled = 0;
}

/**
 * 从持久台账装载对账面（部署面唯一来源——挂-4）。
 *
 * daemon 启动时调用一次：`reconciled` 不再只活在进程内存里，
 * 重启后仍能回答「影子期到底对过账没有」。台账缺失 ⇒ 0（active 门照旧拒绝）；
 * 台账损坏 ⇒ 抛错由调用方告警（**不静默归零**——损坏与没对过账是两件事）。
 */
export function bootstrapJudgeModeState(dataDir: string): ShadowLedger {
  const ledger = loadShadowLedger(dataDir);
  shadowLedger.reconciled = ledger.reconciled;
  return { reconciled: ledger.reconciled };
}

/**
 * 记一条影子期对账（写入路径透传——调用方不必知道台账路径口径）。
 * @returns 追加后的 `reconciled`
 */
export function recordShadowReconciliation(dataDir: string, entry: ShadowReconciliationEntry): number {
  const n = appendShadowReconciliation(dataDir, entry);
  shadowLedger.reconciled = n;
  return n;
}

export { ShadowGateError };
