// ============================================================
// durable/wal-recovery.ts · WAL 崩溃恢复器（Durable L3）
// v1.3.8 交付三 新增
//
// 崩溃恢复协议（changelog v1.4.0 §三）：
//   1. scan(walPath)：扫描 wal.jsonl → 按 taskId 聚合成三态清单
//        committed   begin + commit（可能含未确认的外部副作用）
//        aborted     begin + abort（失败收尾——回滚已发生的部分副作用）
//        incomplete  只有 begin（崩溃点——按幂等策略重跑或跳过告警）
//   2. recover({entries, reExecute, onWarn, undoRegistry})：
//        aborted / committed-but-unconfirmed → 有 undo 调 undo（rolled-back）
//        incomplete → expectedSideEffects 全部 idempotent===true 才走
//                     reExecute 回调重跑；否则跳过 + onWarn 告警
//
// 与 L1/L2 联动（workflow 级灾难恢复）：恢复器只管工具调用事务；
// graph 中断节点定位由 L1 checkpoint 负责，两侧在调用方汇合。
//
// 零 npm 依赖——Node 内建 fs。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import type { SideEffectSpec, WalRecord } from './wal-writer';
import type { UndoRegistry, UndoResult } from './undo-registry';
import { createUndoRegistry } from './undo-registry';

/** 事务终态三分类 */
export type WalTrxState = 'committed' | 'aborted' | 'incomplete';

/** 按 taskId 聚合的单个事务视图 */
export interface WalTrx {
  /** 事务标识 */
  taskId: string;
  /** 终态 */
  state: WalTrxState;
  /** 工具名（begin 携带） */
  tool?: string;
  /** begin 时间戳 */
  beganAt?: string;
  /** 终态时间戳（commit/abort 的 ts） */
  endedAt?: string;
  /** begin 声明的预期副作用 */
  expectedSideEffects: SideEffectSpec[];
  /** begin 携带的调用参数（reExecute 输入） */
  params?: Record<string, unknown>;
  /** commit 记录的实际副作用（committed 才有） */
  actualSideEffects?: SideEffectSpec[];
  /** abort 原因（aborted 才有） */
  abortReason?: string;
}

/** scan 出口：三态清单（按 begin 出现顺序——回放忠实于时序） */
export interface WalScanResult {
  committed: WalTrx[];
  aborted: WalTrx[];
  incomplete: WalTrx[];
}

/** 恢复期重跑回调——调用方提供工具执行器（网关/编排层接线） */
export type ReExecuteFn = (trx: WalTrx) => Promise<unknown> | unknown;

/** 恢复期告警回调（不可逆跳过 / 回滚失败 / 非 '[' 幂等标记缺失） */
export type RecoverWarnFn = (warning: { taskId: string; tool?: string; state: WalTrxState; message: string }) => void;

/** recover 出口：处置结果清单 */
export interface WalRecoveryResult {
  /** 已回滚的事务（undo 已执行） */
  rolledBack: UndoResult[];
  /** 已重跑的事务（reExecute 已执行） */
  reExecuted: { taskId: string; tool?: string }[];
  /** 跳过未处置的事务（不可逆 / 非幂等 / 无 undo 注册） */
  skipped: { taskId: string; tool?: string; reason: string }[];
  /** 回滚失败（需人工介入——恢复不中止，继续处理后续事务） */
  rollbackFailures: { taskId: string; tool?: string; reason: string }[];
}

/**
 * 扫描 WAL 文件 → 三态事务清单（纯读——不做任何恢复动作）。
 *
 * 聚合规则：按 begin 的出现顺序建事务；commit/abort 归属同 taskId 的
 * 事务；有 begin 无终态 = incomplete。begin 重复（同 taskId 二次 begin）
 * 以首次为准（防重放干扰）；孤儿 commit/abort（无 begin）忽略。
 */
export function scanWAL(walPath: string): WalScanResult {
  const result: WalScanResult = { committed: [], aborted: [], incomplete: [] };
  if (!existsSync(walPath)) return result;

  const order: string[] = [];                       // begin 出现顺序
  const trxs = new Map<string, WalTrx>();

  for (const rec of readWalRecords(walPath)) {
    if (rec.type === 'begin') {
      if (trxs.has(rec.taskId)) continue;           // 重复 begin 首次为准
      const trx: WalTrx = {
        taskId: rec.taskId,
        state: 'incomplete',
        tool: rec.tool,
        beganAt: rec.ts,
        expectedSideEffects: rec.expectedSideEffects ?? [],
        params: rec.params,
      };
      trxs.set(rec.taskId, trx);
      order.push(rec.taskId);
      continue;
    }
    const trx = trxs.get(rec.taskId);
    if (!trx) continue;                             // 孤儿终态——忽略
    if (trx.state !== 'incomplete') continue;       // 已终态——后续记录忽略
    if (rec.type === 'commit') {
      trx.state = 'committed';
      trx.endedAt = rec.ts;
      trx.actualSideEffects = rec.actualSideEffects ?? [];
    } else if (rec.type === 'abort') {
      trx.state = 'aborted';
      trx.endedAt = rec.ts;
      trx.abortReason = rec.reason;
    }
  }

  for (const id of order) {
    const trx = trxs.get(id);
    if (!trx) continue;
    result[trx.state].push(trx);
  }
  return result;
}

/** 读 WAL 全部合法记录（坏行跳过——崩溃可能写半行） */
function readWalRecords(walPath: string): WalRecord[] {
  const out: WalRecord[] = [];
  for (const line of readFileSync(walPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as WalRecord;
      if (rec && typeof rec.taskId === 'string' && typeof rec.type === 'string') {
        out.push(rec);
      }
    } catch {
      // 半行跳过
    }
  }
  return out;
}

/**
 * WAL 崩溃恢复。
 *
 * 处置矩阵：
 *   ┌──────────────┬──────────────────────────────────────┐
 *   │ aborted      │ 对 begin 声明的 expectedSideEffects   │
 *   │              │ 逐个调 undo（可能已部分发生）→ rolled-back │
 *   ├──────────────┼──────────────────────────────────────┤
 *   │ committed    │ 未确认事务——对 commit 的              │
 *   │ (未确认)     │ actualSideEffects 调 undo → rolled-back │
 *   ├──────────────┼──────────────────────────────────────┤
 *   │ incomplete   │ expectedSideEffects 全部               │
 *   │              │ idempotent===true → reExecute 重跑；   │
 *   │              │ 否则跳过 + onWarn（默认告警策略：非幂等 │
 *   │              │ 半程事务重跑有双副作用风险）            │
 *   └──────────────┴──────────────────────────────────────┘
 *
 * 不可逆副作用（undoRegistry.isReversible === 'irreversible'）：
 * 不回滚——已发生的事实不篡改（changelog §三策略），记 skipped。
 *
 * @param options.entries scan 出口的三态清单（scanWAL 结果）
 * @param options.reExecute incomplete 重跑回调（不提供 = 全部按跳过处理）
 * @param options.onWarn 告警回调（不提供 = console.warn）
 * @param options.undoRegistry undo 注册表（不提供 = 内置默认注册表）
 */
export async function recoverWAL(options: {
  entries: WalScanResult;
  reExecute?: ReExecuteFn;
  onWarn?: RecoverWarnFn;
  undoRegistry?: UndoRegistry;
}): Promise<WalRecoveryResult> {
  const registry = options.undoRegistry ?? createUndoRegistry();
  const onWarn: RecoverWarnFn = options.onWarn ?? ((w) => console.warn(`[wal-recovery] ${w.message}`));
  const out: WalRecoveryResult = { rolledBack: [], reExecuted: [], skipped: [], rollbackFailures: [] };

  // ── aborted：回滚 begin 声明的预期副作用（可能已部分发生）──
  for (const trx of options.entries.aborted) {
    rollbackTrx(trx, trx.expectedSideEffects, registry, onWarn, out);
  }

  // ── committed 未确认：回滚 commit 记录的实际副作用 ──
  for (const trx of options.entries.committed) {
    const effects = trx.actualSideEffects ?? [];
    if (effects.length === 0) {
      // 无副作用事务（纯读类）——无需回滚也无需告警，直接跳过
      out.skipped.push({ taskId: trx.taskId, tool: trx.tool, reason: 'committed 且无副作用——无需回滚' });
      continue;
    }
    rollbackTrx(trx, effects, registry, onWarn, out);
  }

  // ── incomplete：幂等才重跑，否则跳过 + 告警 ──
  for (const trx of options.entries.incomplete) {
    const effects = trx.expectedSideEffects;
    const allIdempotent = effects.length > 0 && effects.every((e) => e.idempotent === true);
    if (allIdempotent && options.reExecute) {
      try {
        await options.reExecute(trx);
        out.reExecuted.push({ taskId: trx.taskId, tool: trx.tool });
      } catch (err) {
        const reason = `reExecute 抛错（跳过该事务）: ${err instanceof Error ? err.message : String(err)}`;
        out.skipped.push({ taskId: trx.taskId, tool: trx.tool, reason });
        onWarn({ taskId: trx.taskId, tool: trx.tool, state: 'incomplete', message: reason });
      }
      continue;
    }
    const reason = allIdempotent
      ? '幂等事务但未提供 reExecute 回调——无法重跑'
      : effects.length === 0
        ? '未声明预期副作用——无法判定重跑安全性'
        : '存在非幂等副作用——重跑有双副作用风险，跳过并告警';
    out.skipped.push({ taskId: trx.taskId, tool: trx.tool, reason });
    onWarn({ taskId: trx.taskId, tool: trx.tool, state: 'incomplete', message: `半程事务 ${trx.taskId}（${trx.tool ?? '未知工具'}）跳过: ${reason}` });
  }

  return out;
}

/** 单事务回滚：逐副作用查 undo——可逆执行、不可逆跳过、无注册跳过 */
function rollbackTrx(
  trx: WalTrx,
  effects: SideEffectSpec[],
  registry: UndoRegistry,
  onWarn: RecoverWarnFn,
  out: WalRecoveryResult,
): void {
  if (effects.length === 0) {
    out.skipped.push({ taskId: trx.taskId, tool: trx.tool, reason: '无副作用声明——无需回滚' });
    return;
  }
  for (const effect of effects) {
    const undoFn = registry.getUndo(effect.action);
    const tier = registry.isReversible(effect.action);
    if (!undoFn || tier === 'irreversible') {
      const reason = `副作用 ${effect.action} 不可逆（${undoFn ? 'tier=irreversible' : '未注册 undo'}）——已发生的事实不篡改`;
      out.skipped.push({ taskId: trx.taskId, tool: trx.tool, reason });
      onWarn({ taskId: trx.taskId, tool: trx.tool, state: trx.state, message: `${trx.taskId} 回滚跳过: ${reason}` });
      continue;
    }
    try {
      const result = undoFn({ taskId: trx.taskId, action: effect.action, target: effect.target, detail: effect.detail });
      if (result.status === 'failed') {
        out.rollbackFailures.push({ taskId: trx.taskId, tool: trx.tool, reason: result.detail ?? 'undo 返回 failed' });
        onWarn({ taskId: trx.taskId, tool: trx.tool, state: trx.state, message: `${trx.taskId} 回滚失败（${effect.action}）: ${result.detail ?? ''}` });
      } else {
        out.rolledBack.push(result);
      }
    } catch (err) {
      const reason = `undo 抛错: ${err instanceof Error ? err.message : String(err)}`;
      out.rollbackFailures.push({ taskId: trx.taskId, tool: trx.tool, reason });
      onWarn({ taskId: trx.taskId, tool: trx.tool, state: trx.state, message: `${trx.taskId} 回滚异常（${effect.action}）: ${reason}` });
    }
  }
}
