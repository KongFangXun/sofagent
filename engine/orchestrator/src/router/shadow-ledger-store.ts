// ============================================================
// shadow-ledger-store.ts · 影子期对账台账的持久来源与写入路径（挂-4）
// ------------------------------------------------------------
// 问题：`ShadowLedger.reconciled` 此前只活在模块内存里（缺省 0），
// 没有任何落盘来源 ⇒ 「active 档须先过影子期对账」这道门在部署面上
// 永远拿不到 reconciled>0（重启即归零，且无法审计「谁对过账」）。
//
// 本模块补两件事：
//   ① **写入路径**：每次影子期「判定 vs 真实处置」逐条比对后追加一行
//      NDJSON 到 `<dataDir>/judge/shadow-ledger.ndjson`
//   ② **来源**：`reconciled` = 台账内**合法条目数**（读时逐行校验，坏行即
//      fail-closed 抛错——静默跳过坏行会让门在坏台账上前进）
//
// 条目三要素（缺一即拒，与写面留痕三要素同纪律）：ts / shadow / actual。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { ShadowLedger } from './judge-state';

/** 影子期对账条目（逐条差异——判定的 grade/target vs 真实处置） */
export interface ShadowReconciliationEntry {
  /** 对账时点（ISO） */
  ts: string;
  /** 影子期判定给出的 grade */
  shadow: string;
  /** 真实处置的 grade（人工/确定性规则的最终结果） */
  actual: string;
  /** 两次是否一致（差异条目同样入台账——只记一致等于看不见问题） */
  agreed?: boolean;
  /** 问句 / 判定点标识（可追溯是哪一判据的对账） */
  questionId?: string;
  /** 备注（差异原因等，人可读） */
  note?: string;
}

/** 台账文件路径（单一口径，写入与读取共用） */
export function shadowLedgerPath(dataDir: string): string {
  return join(dataDir, 'judge', 'shadow-ledger.ndjson');
}

/** 校验一条对账条目（fail-closed：三要素缺一即拒） */
function assertEntry(entry: Partial<ShadowReconciliationEntry>): void {
  const missing = (['ts', 'shadow', 'actual'] as const).filter(
    (k) => typeof entry[k] !== 'string' || String(entry[k]).trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(`对账条目缺三要素（${missing.join('/')}）——拒写台账（缺证据的对账不算对账）`);
  }
}

/**
 * 追加一条对账记录（写入路径唯一入口）。
 * @returns 追加后的台账条数（即新的 `reconciled`）
 */
export function appendShadowReconciliation(dataDir: string, entry: ShadowReconciliationEntry): number {
  assertEntry(entry);
  const path = shadowLedgerPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify({
    ts: entry.ts,
    shadow: entry.shadow,
    actual: entry.actual,
    agreed: entry.agreed ?? entry.shadow === entry.actual,
    ...(entry.questionId ? { questionId: entry.questionId } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  });
  appendFileSync(path, `${line}\n`, 'utf-8');
  return loadShadowLedger(dataDir).reconciled;
}

/**
 * 读台账 → ShadowLedger（来源唯一口径）。
 *
 * 坏行（非 JSON / 缺要素）即抛错：台账坏了却返回 0 会让 `active` 门在
 * 「看起来没对过账」与「台账已损坏」之间失去区分。
 */
export function loadShadowLedger(dataDir: string): ShadowLedger {
  const path = shadowLedgerPath(dataDir);
  if (!existsSync(path)) return { reconciled: 0 };
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() !== '');
  let count = 0;
  lines.forEach((line, idx) => {
    let parsed: Partial<ShadowReconciliationEntry>;
    try {
      parsed = JSON.parse(line) as Partial<ShadowReconciliationEntry>;
    } catch {
      throw new Error(`台账第 ${idx + 1} 行不是合法 JSON——拒读（坏台账不放行 active 档）`);
    }
    assertEntry(parsed);
    count += 1;
  });
  return { reconciled: count };
}
