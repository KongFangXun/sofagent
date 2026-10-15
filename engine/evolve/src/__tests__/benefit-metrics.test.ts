// benefit-metrics.test.ts · 四指标从既有台账取数单测（v1.5.8 章二补强——缺口C）
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  passRateTrendFromAbHistory,
  recurrenceRateFromFailureLedger,
  skillReuseRateFromImpactLedger,
  interventionRateFromDecisionLog,
  collectBenefitMetrics,
} from '../benefit-metrics';

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'sofagent-benefit-'));
}
function write(dir: string, rel: string, lines: unknown[]): void {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

describe('章二 · 四指标取数（既有台账——零新数据源）', () => {
  it('① 通过率趋势：ab-history.jsonl 窗口首尾斜率（后段高于前段 → 正值）', () => {
    const d = makeDataDir();
    write(d, 'ab-history.jsonl', [
      { plan: 'A', passed: 5, failed: 5, qualityScore: 50 },
      { plan: 'A', passed: 6, failed: 4, qualityScore: 60 },
      { plan: 'B', passed: 8, failed: 2, qualityScore: 80 },
      { plan: 'B', passed: 9, failed: 1, qualityScore: 90 },
    ]);
    const trend = passRateTrendFromAbHistory(d);
    expect(trend).not.toBeNull();
    expect(trend!).toBeGreaterThan(0); // 变强
    rmSync(d, { recursive: true, force: true });
  });

  it('② 复发率：failure-ledger.jsonl 重复模式占比（生产 schema——FailureRecord 字段，禁自造字段）', () => {
    const d = makeDataDir();
    // 生产写入方 failure-ledger.ts 的 FailureRecord：timestamp/skillId/failureMode/reason/source
    // （correctApproach/ruleTriggered 可选）——无 pattern/id/occurrences 字段（历史缺陷：测试自造
    //  pattern 字段导致恒绿、生产恒 null，2026-10-15 修复并锁生产 schema）
    const rec = (skillId: string, failureMode: string, reason: string) => ({
      timestamp: '2026-10-15T00:00:00.000Z',
      skillId,
      failureMode,
      reason,
      source: 'orchestrator-checker',
    });
    write(d, join('evolve', 'failure-ledger.jsonl'), [
      rec('skill-a', 'format-mismatch', '产出格式不符'),
      rec('skill-a', 'format-mismatch', '同模式再犯'), // 同 failureMode 复发
      rec('skill-b', 'empty-output', '产出为空'),
    ]);
    const r = recurrenceRateFromFailureLedger(d);
    expect(r).toBeCloseTo(0.5); // 2 模式之一复发
    rmSync(d, { recursive: true, force: true });
  });

  it('③ skill 复用率：skill-impact.jsonl accepted 占比（无 invocation 字段口径）', () => {
    const d = makeDataDir();
    write(d, join('skill-evolution', 'skill-impact.jsonl'), [
      { skillPath: 's1', verdict: 'accepted' },
      { skillPath: 's2', verdict: 'rejected' },
      { skillPath: 's3', verdict: 'accepted' },
      { skillPath: 's4', verdict: 'accepted' },
    ]);
    expect(skillReuseRateFromImpactLedger(d)).toBeCloseTo(0.75);
    rmSync(d, { recursive: true, force: true });
  });

  it('④ 介入率：decision-log.jsonl ESCALATE_REPORT 占比', () => {
    const d = makeDataDir();
    write(d, join('audit', 'decision-log.jsonl'), [
      { kind: 'ARTIFACT_EDIT' },
      { kind: 'ESCALATE_REPORT' },
      { kind: 'ARTIFACT_EDIT' },
      { kind: 'ARTIFACT_EDIT' },
      { kind: 'ARTIFACT_EDIT' },
    ]);
    expect(interventionRateFromDecisionLog(d)).toBeCloseTo(0.2);
    rmSync(d, { recursive: true, force: true });
  });

  it('四维聚合：全缺抛错（宁缺勿假）；部分缺则缺维归 0 且 availableDims 如实', () => {
    const empty = makeDataDir();
    expect(() => collectBenefitMetrics(empty)).toThrow(/宁缺勿假/);
    write(empty, 'ab-history.jsonl', [
      { passed: 1, failed: 1 }, { passed: 2, failed: 0 },
    ]);
    const agg = collectBenefitMetrics(empty);
    expect(agg.raw.availableDims).toBe(1);
    rmSync(empty, { recursive: true, force: true });
  });
});
