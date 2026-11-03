// ============================================================
// shadow-ledger-store.test.ts · 挂-4 影子门 live 台账（来源 + 写入路径）
// ------------------------------------------------------------
// 断言四件事：
//   ① 写入后读回条数递增（reconciled 有真实来源，不再是内存常量 0）
//   ② 三要素缺一 ⇒ 拒写（缺证据的对账不算对账）
//   ③ 坏行 ⇒ 拒读（损坏与「没对过账」必须可区分）
//   ④ 装到 judge-mode 上 ⇒ active 门从拒绝翻转为允许（联动实证）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  appendShadowReconciliation,
  loadShadowLedger,
  shadowLedgerPath,
} from '../shadow-ledger-store';
import {
  bootstrapJudgeModeState,
  getShadowLedger,
  recordShadowReconciliation,
  resetJudgeModeForTest,
  setJudgeMode,
  ShadowGateError,
} from '../judge-mode';
import { applyWithShadowGate } from '../judge-state';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shadow-ledger-')); resetJudgeModeForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('挂-4 · 台账写入路径与来源', () => {
  it('无台账 ⇒ reconciled=0（active 门照旧拒绝）', () => {
    expect(loadShadowLedger(dir)).toEqual({ reconciled: 0 });
    expect(() => setJudgeMode('active')).not.toThrow(); // setter 不校验，门在 applyWithShadowGate
    expect(() => applyWithShadowGate('active', getShadowLedger(), { grade: 'a', target: 't' }, { grade: 'b', target: 't' }))
      .toThrow(ShadowGateError);
  });

  it('追加两条 ⇒ reconciled=2，且逐条可读回（agreed 缺省按 shadow==actual 推导）', () => {
    const p1 = appendShadowReconciliation(dir, { ts: '2026-11-04T00:00:00Z', shadow: 'ALLOW', actual: 'ASK', questionId: 'q1' });
    expect(p1).toBe(1);
    const p2 = appendShadowReconciliation(dir, { ts: '2026-11-04T00:01:00Z', shadow: 'DENY', actual: 'DENY' });
    expect(p2).toBe(2);
    expect(loadShadowLedger(dir).reconciled).toBe(2);
  });

  it('三要素缺一 ⇒ 拒写（并指出缺哪个）', () => {
    expect(() => appendShadowReconciliation(dir, { ts: '', shadow: 'ALLOW', actual: 'ALLOW' }))
      .toThrow(/缺三要素（ts）/);
    expect(() => appendShadowReconciliation(dir, { ts: 'x', shadow: 'ALLOW' } as never))
      .toThrow(/actual/);
  });

  it('坏行 ⇒ 拒读（不把损坏台账当 0 处理）', () => {
    const path = shadowLedgerPath(dir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ts: 'x', shadow: 'A', actual: 'A' })}\n{不是json}\n`);
    expect(() => loadShadowLedger(dir)).toThrow(/第 2 行不是合法 JSON/);
  });
});

describe('挂-4 · 装到 judge-mode（live 切档联动）', () => {
  it('recordShadowReconciliation 写入后 getShadowLedger().reconciled 同步', () => {
    recordShadowReconciliation(dir, { ts: '2026-11-04T00:00:00Z', shadow: 'ALLOW', actual: 'ASK' });
    expect(getShadowLedger().reconciled).toBe(1);
  });

  it('bootstrapJudgeModeState 从磁盘装载 ⇒ active 门放行（reconciled>0）', () => {
    appendShadowReconciliation(dir, { ts: '2026-11-04T00:00:00Z', shadow: 'ALLOW', actual: 'ASK' });
    expect(bootstrapJudgeModeState(dir)).toEqual({ reconciled: 1 });
    const r = applyWithShadowGate('active', getShadowLedger(), { grade: 'ALLOW', target: 'decision-model' }, { grade: 'ASK', target: 'decision-model' });
    expect(r.applied).toBe(true);
    expect(r.effective.grade).toBe('ALLOW');
  });

  it('空 dataDir 引导 ⇒ 0，门仍拒（没有对账不许上线）', () => {
    expect(bootstrapJudgeModeState(dir)).toEqual({ reconciled: 0 });
    expect(() => applyWithShadowGate('active', getShadowLedger(), { grade: 'a', target: 't' }, { grade: 'a', target: 't' }))
      .toThrow(ShadowGateError);
  });
});
